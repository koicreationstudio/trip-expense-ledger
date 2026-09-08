import crypto from 'node:crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * 密码哈希用 Node 内置 scrypt，不装 bcrypt/argon2 这类原生依赖。
 * Cloudflare Workers 的 nodejs_compat 原生支持 node:crypto 的 scryptSync，
 * 装原生模块在 Workers 运行时里根本装不上，内置这条路线本来就是唯一选项。
 */

/** 存成 `salt:hash` 十六进制字符串，salt 每次随机生成，同密码两次哈希结果不同。 */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto.scryptSync(plain, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 重新用同一个 salt 跑一次 scrypt，再用 timingSafeEqual 比较，防时序攻击。
 * stored 形状不对（不是 `salt:hash`）一律当验证失败，不抛异常。
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const hashBuffer = Buffer.from(hash, 'hex');
  const candidateBuffer = crypto.scryptSync(plain, salt, hashBuffer.length);

  if (hashBuffer.length !== candidateBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, candidateBuffer);
}
