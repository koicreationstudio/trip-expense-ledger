import { describe, expect, it } from 'vitest';
import { MIN_RECOVERY_PIN_LENGTH, validateRecoveryPin } from './recovery-pin';

describe('recovery-pin：密码/PIN 找回口令校验规则', () => {
  it('太短拒绝', () => {
    const result = validateRecoveryPin('12345');
    expect(result.ok).toBe(false);
  });

  it('刚好达到最短长度通过', () => {
    const pin = '1'.repeat(MIN_RECOVERY_PIN_LENGTH);
    expect(validateRecoveryPin(pin)).toEqual({ ok: true });
  });

  it('纯数字/字母混合都允许，只卡长度不卡字符种类', () => {
    expect(validateRecoveryPin('abcdef').ok).toBe(true);
    expect(validateRecoveryPin('123456').ok).toBe(true);
    expect(validateRecoveryPin('aB3!xy').ok).toBe(true);
  });
});
