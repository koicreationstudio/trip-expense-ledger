/**
 * 密码/PIN 找回口令的哈希。不用明文存（这条跟 identityToken/invite.code 不是
 * 同一类东西——那两个是"不可猜测的随机凭证本身就是权限"，这个是"人自己想出来的
 * 密码"，人脑想出来的东西熵低、还可能跟其它地方重复用，必须按"密码"对待，哈希存。
 *
 * 算法选 PBKDF2-SHA256（NIST SP 800-132 认可的密码哈希 KDF），不是常见的
 * bcrypt/scrypt 库，原因是运行环境：这个 Worker 跑在 Cloudflare Workers/
 * opennextjs-cloudflare，bcrypt/scrypt 的主流 npm 实现要嘛依赖原生二进制
 * 绑定（Workers 不支持），要嘛依赖 Node `crypto.scryptSync` 这类重量级原生
 * 实现在 workerd 的 nodejs_compat polyfill 里支持程度不确定。PBKDF2 走
 * Web Crypto 标准 API（`crypto.subtle`），是 Cloudflare Workers 官方文档
 * 认证支持的原生能力，不依赖任何 polyfill，本地 vitest（Node 18+ 内建
 * Web Crypto）跟生产 Workers 运行时行为完全一致，不会出现"测试过但生产环境
 * 跑不动"的坑。安全属性同一类：加盐、迭代拖慢、不可逆，PBKDF2-SHA256 满足
 * "不能明文存、要用慢哈希"这条要求的实质，不是偷工减料。
 *
 * 迭代次数 100,000（不是 OWASP 2023 建议的 210,000）：Cloudflare Workers 的
 * `crypto.subtle` PBKDF2 实现有硬上限，实测生产环境传 210,000 直接抛
 * `NotSupportedError: iteration counts above 100000 are not supported`——
 * 这是 workerd 运行时的平台限制，不是我选的安全性权衡。100,000 仍是
 * NIST SP 800-132 认可的 PBKDF2-SHA256 最低门槛，不是明显不够。
 */

const ALGORITHM_TAG = 'pbkdf2-sha256';
const ITERATIONS = 100_000; // Cloudflare Workers crypto.subtle 的 PBKDF2 迭代次数上限
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function deriveBits(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

/** 生成新哈希，存进 users.recoveryPinHash。格式自描述，以后要换算法/迭代次数不破坏旧数据。 */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveBits(pin, salt, ITERATIONS);
  return `${ALGORITHM_TAG}$${ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

/** 常量时间比较，防止逐字节比较的时序侧信道泄露哈希内容。 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** 校验用户输入的 PIN/密码是否匹配存储的哈希。格式不对/算法不认识一律返回 false，不抛异常。 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGORITHM_TAG) return false;
  const [, iterationsPart, saltPart, hashPart] = parts;
  const iterations = Number(iterationsPart);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  try {
    const salt = fromBase64(saltPart ?? '');
    const expected = fromBase64(hashPart ?? '');
    const actual = await deriveBits(pin, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
