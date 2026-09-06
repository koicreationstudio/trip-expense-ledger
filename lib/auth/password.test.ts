import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password 哈希 roundtrip', () => {
  it('正确密码验证通过', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', stored)).toBe(true);
  });

  it('密码错拒绝', () => {
    const stored = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('wrong-password', stored)).toBe(false);
  });

  it('同一个密码两次哈希结果不同（salt 生效）', () => {
    const first = hashPassword('same-password');
    const second = hashPassword('same-password');
    expect(first).not.toBe(second);
    // 但两个哈希各自都能验证通过同一个明文密码
    expect(verifyPassword('same-password', first)).toBe(true);
    expect(verifyPassword('same-password', second)).toBe(true);
  });

  it('形状不对的 stored 值（不是 salt:hash）当验证失败处理，不抛异常', () => {
    expect(verifyPassword('anything', 'not-a-valid-stored-hash')).toBe(false);
    expect(verifyPassword('anything', '')).toBe(false);
  });
});
