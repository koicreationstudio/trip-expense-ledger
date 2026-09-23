import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin-hash';

describe('hashPin / verifyPin', () => {
  it('正确密码验证通过', () => {
    const stored = hashPin('1234');
    expect(verifyPin('1234', stored)).toBe(true);
  });

  it('错误密码验证不通过', () => {
    const stored = hashPin('1234');
    expect(verifyPin('4321', stored)).toBe(false);
  });

  it('不是明文存储——hash 结果不包含原始密码', () => {
    const stored = hashPin('mySecretPin1234');
    expect(stored).not.toContain('mySecretPin1234');
  });

  it('同一个密码两次 hash 结果不同（不同 salt），但都能验证通过', () => {
    const a = hashPin('1234');
    const b = hashPin('1234');
    expect(a).not.toBe(b);
    expect(verifyPin('1234', a)).toBe(true);
    expect(verifyPin('1234', b)).toBe(true);
  });

  it('损坏/格式不对的存储串不抛异常，当不匹配处理', () => {
    expect(verifyPin('1234', 'not-a-valid-format')).toBe(false);
    expect(verifyPin('1234', 'pbkdf2-sha256$abc$salt$hash')).toBe(false);
    expect(verifyPin('1234', '')).toBe(false);
  });
});
