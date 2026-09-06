import crypto from 'node:crypto';

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

/**
 * 密码哈希用 Node 内置 scrypt，不装 bcrypt/argon2 这类原生依赖。
 * better-sqlite3 已经是这个项目唯一的原生依赖，Dockerfile 注释里明写了它让
 * 编译工具链和 `output: standalone` 踩过坑，再装一个原生模块等于重新踩一遍。
 * scryptSync 是内置的，够用。
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
