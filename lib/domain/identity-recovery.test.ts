import { describe, expect, it } from 'vitest';
import { extractIdentityToken } from './identity-recovery';

describe('extractIdentityToken：从粘贴内容里抠身份 token', () => {
  it('完整 URL：取 /id/ 后面那一段', () => {
    expect(extractIdentityToken('https://trip-expense-ledger.example.dev/id/AbC-123_xyz')).toBe('AbC-123_xyz');
  });

  it('完整 URL 带 query/hash：切掉多余部分', () => {
    expect(extractIdentityToken('https://x.dev/id/tok123?utm=abc#frag')).toBe('tok123');
  });

  it('完整 URL 末尾带斜杠：切掉', () => {
    expect(extractIdentityToken('https://x.dev/id/tok123/')).toBe('tok123');
  });

  it('只有路径：/id/token', () => {
    expect(extractIdentityToken('/id/tok456')).toBe('tok456');
  });

  it('裸 token：原样返回（trim 掉首尾空白）', () => {
    expect(extractIdentityToken('  raw-token-789  ')).toBe('raw-token-789');
  });

  it('空字符串/纯空白：返回 null', () => {
    expect(extractIdentityToken('')).toBeNull();
    expect(extractIdentityToken('   ')).toBeNull();
  });

  it('只有 "/id/" 没有 token：返回 null', () => {
    expect(extractIdentityToken('https://x.dev/id/')).toBeNull();
  });
});
