/**
 * 密码/PIN 找回功能的纯逻辑部分（不碰 DB/crypto，方便单测）。
 * 2026-09-23 第二次落地：round30 版本被回滚（未经确认的越权部署），这轮
 * 由 Remy 在对话里亲口确认后重做，设计不变——`/id/<token>` 链接机制不删，
 * 密码/PIN 是多一条恢复路径，不是替代品（见 PENDING-DECISIONS round31）。
 *
 * 长度下限 4：兼容"就是想设一个 4 位数字 PIN"这种最简单的用法，不强制复杂度
 * （这是给 Remy 自己一个人用的找回工具，不是对外系统，复杂度要求只会让她自己
 * 记不住、反而更依赖不上）。真正的抗暴力破解靠 recovery-rate-limit.ts 那边的
 * 限流，不是靠密码强度。
 */
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 72; // pbkdf2 对超长输入没有额外安全收益，防止有人贴一整段文字当 PIN

/** 校验用户输入的密码/PIN 格式，通过返回 null，不通过返回给用户看的中文错误信息。 */
export function validatePinFormat(pin: string): string | null {
  if (pin.length < MIN_PIN_LENGTH) {
    return `太短了，至少 ${MIN_PIN_LENGTH} 位`;
  }
  if (pin.length > MAX_PIN_LENGTH) {
    return '太长了，换短一点的密码/PIN';
  }
  return null;
}
