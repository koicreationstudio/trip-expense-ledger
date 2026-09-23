import { describe, expect, it } from 'vitest';
import { validatePinFormat, MIN_PIN_LENGTH, MAX_PIN_LENGTH } from './recovery-pin';

describe('validatePinFormat', () => {
  it('太短拒绝', () => {
    expect(validatePinFormat('a'.repeat(MIN_PIN_LENGTH - 1))).not.toBeNull();
  });

  it('刚好最短长度通过', () => {
    expect(validatePinFormat('a'.repeat(MIN_PIN_LENGTH))).toBeNull();
  });

  it('太长拒绝', () => {
    expect(validatePinFormat('a'.repeat(MAX_PIN_LENGTH + 1))).not.toBeNull();
  });

  it('刚好最长长度通过', () => {
    expect(validatePinFormat('a'.repeat(MAX_PIN_LENGTH))).toBeNull();
  });

  it('4 位数字 PIN 通过', () => {
    expect(validatePinFormat('1234')).toBeNull();
  });
});
