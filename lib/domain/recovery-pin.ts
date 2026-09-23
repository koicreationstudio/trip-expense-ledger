/**
 * 密码/PIN 找回口令的校验规则，前端（表单即时提示）+ 后端（权威校验）共用
 * 同一份，不各自写一套容易漂移。
 *
 * 最短 6 位：纯 4 位数字 PIN 只有 1 万种组合，这个接口没有账号名做二次限定
 * （见 recovery-rate-limit.ts 的说明），单靠限流不够，长度门槛是另一道防线。
 * 不强制要求字母+数字混合——对 Remy 这种非工程师用户，强规则复杂度要求
 * 反而会逼她把密码写在便利贴上，权衡后选"只卡长度，不卡字符种类"。
 */
export const MIN_RECOVERY_PIN_LENGTH = 6;

export function validateRecoveryPin(pin: string): { ok: true } | { ok: false; message: string } {
  if (pin.length < MIN_RECOVERY_PIN_LENGTH) {
    return { ok: false, message: `至少要 ${MIN_RECOVERY_PIN_LENGTH} 位，纯数字或混合字母都可以` };
  }
  return { ok: true };
}
