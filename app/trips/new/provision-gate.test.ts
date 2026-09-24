import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const gate = readFileSync(join(__dirname, 'provision-gate.tsx'), 'utf-8');
const setPin = readFileSync(join(__dirname, '../../account/set-pin-form.tsx'), 'utf-8');

function pinRecoverHandler(src: string): string {
  const start = src.indexOf('async function handlePinRecoverSubmit');
  return src.slice(start, src.indexOf('\n  }\n', start));
}

function stepBlock(src: string, step: string): string {
  const start = src.indexOf(`if (step === '${step}')`);
  return src.slice(start, src.indexOf('\n  }\n', start));
}

describe('PIN / 身份链接找回表单回归（2026-09-24 主会话实测抓到）', () => {
  it('PIN 找回成功后整页跳首页，不停在 /trips/new 的建行程表单', () => {
    const h = pinRecoverHandler(gate);
    expect(h).toContain("window.location.href = '/'");
    expect(h).not.toContain('router.refresh()');
  });

  it('PIN 找回和身份链接找回都包在 <form onSubmit> 里，按回车能提交', () => {
    for (const step of ['pin-recover', 'recover']) {
      const block = stepBlock(gate, step);
      expect(block, step).toContain('<form');
      expect(block, step).toContain('onSubmit');
      expect(block, step).toContain('type="submit"');
    }
  });

  it('密码/PIN 输入框不锁数字键盘（允许设带字母的短密码）', () => {
    for (const [name, src] of [['provision-gate', gate], ['set-pin-form', setPin]] as const) {
      const passwordInputs = src.split('type="password"').slice(1).map((s) => s.slice(0, 200));
      expect(passwordInputs.length, name).toBeGreaterThan(0);
      for (const tail of passwordInputs) expect(tail, name).not.toContain('inputMode="numeric"');
    }
  });
});
