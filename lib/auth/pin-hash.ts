import crypto from 'node:crypto';

/**
 * 密码/PIN 找回：hash 存储（不能明文，这是 Remy 明确要求的安全底线，跟
 * identityToken 那条明文存储的链接不是同一类东西——identityToken 本身就是
 * 凭证、丢了就重铸一条新的即可，而密码/PIN 是"记在脑子里可复用"的东西，
 * 明文存一旦 DB 泄露就等于泄露了 Remy 脑子里其它地方也在用的密码习惯）。
 *
 * 算法选 pbkdf2-sha256（node:crypto 内建，Cloudflare Workers nodejs_compat
 * 下已验证可用——lib/auth/identity.ts / user-session.ts 的 randomBytes/
 * createHash 就是同一个 node:crypto 模块）。没选 bcrypt/argon2：那两个都
 * 需要原生编译或额外的 wasm 依赖，Workers 运行时装不上；pbkdf2 是标准库
 * 自带、经过 round30 那版实测过（10 万次迭代在 Workers 请求 CPU 时限内跑得完），
 * 对"一个人自己用的找回 PIN"这个威胁模型（不是对外系统防海量撞库）已经够。
 *
 * 存储格式：pbkdf2-sha256$<iterations>$<saltBase64url>$<hashBase64url>，
 * 迭代次数写进字符串里，以后想调高强度不用改历史数据的验证逻辑。
 */
const ALGO_TAG = 'pbkdf2-sha256';
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.pbkdf2Sync(pin, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  return `${ALGO_TAG}$${ITERATIONS}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * 验证明文 PIN 跟某一条存储 hash 是否匹配，常数时间比较（timingSafeEqual），
 * 防止用响应耗时差异侧信道推断出"密码前几位对不对"。
 * 存储串格式不对（理论上不该发生，防御性处理）一律当不匹配，不抛异常——
 * 调用方（recover-pin 逐个用户比对）不该因为某一行脏数据整个请求 500。
 */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== ALGO_TAG) return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2]!, 'base64url');
    expected = Buffer.from(parts[3]!, 'base64url');
  } catch {
    return false;
  }

  const actual = crypto.pbkdf2Sync(pin, salt, iterations, expected.length, 'sha256');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
