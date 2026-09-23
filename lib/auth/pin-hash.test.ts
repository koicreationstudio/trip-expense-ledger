import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin-hash';

describe('pin-hash：密码/PIN 找回口令哈希', () => {
  it('正确密码验证通过', async () => {
    const hash = await hashPin('correct-horse-battery');
    expect(await verifyPin('correct-horse-battery', hash)).toBe(true);
  });

  it('错误密码验证不通过', async () => {
    const hash = await hashPin('correct-horse-battery');
    expect(await verifyPin('wrong-password', hash)).toBe(false);
  });

  it('不明文存储——哈希结果里找不到原文', async () => {
    const hash = await hashPin('mySecretPin123');
    expect(hash).not.toContain('mySecretPin123');
  });

  it('同样的密码两次哈希结果不同（随机 salt）', async () => {
    const hashA = await hashPin('sameSamePin');
    const hashB = await hashPin('sameSamePin');
    expect(hashA).not.toBe(hashB);
    expect(await verifyPin('sameSamePin', hashA)).toBe(true);
    expect(await verifyPin('sameSamePin', hashB)).toBe(true);
  });

  it('哈希格式带算法标签+迭代次数，自描述', async () => {
    const hash = await hashPin('anyPin123');
    const parts = hash.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2-sha256');
    expect(Number(parts[1])).toBeGreaterThanOrEqual(100_000);
  });

  it('损坏/不认识的哈希格式验证时返回 false 不抛异常', async () => {
    expect(await verifyPin('anything', 'not-a-real-hash')).toBe(false);
    expect(await verifyPin('anything', 'bcrypt$10$xxx$yyy')).toBe(false);
  });
});
