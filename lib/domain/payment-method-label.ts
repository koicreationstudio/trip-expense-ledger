/**
 * 2026-09-24 Remy 真实反馈的真 bug：汇率比价卡片同时出现两行「现金」——她真实
 * 名下确实有「现金」settlement_currency=HKD 和「现金」settlement_currency=USD
 * 两个支付方式（这趟"🇭🇰2026香港"行程她在支付方式页各自起的名字都叫"现金"，
 * 没有额外备注），任何要展示"一组支付方式列表"的界面（汇率比价卡片、"记一笔
 * 消费"表单的支付方式下拉）都分不清是哪一个。
 *
 * 这个 chokepoint 只做一件事：给定一组 {id, label, settlementCurrency}，只有
 * 「label 在这组里确实重复出现」的那几个才追加币种后缀消歧义（"现金" →
 * "现金（HKD）"/"现金（USD）"），label 本来就唯一的（比如 "Wise"/"HSBC 大马
 * Visa Signature"）保持原样，不额外加视觉噪音。
 *
 * 消歧义范围是"调用方传进来的这一组"，不是全局唯一——这是有意的：调用方各自
 * 从数据库查出自己需要的子集（fx-recommendation 路由查全部 is_active 的，
 * "记一笔消费"表单只查这趟行程"启用"的那几个），如果同一个 label 在数据库里
 * 全局重复、但这次列表只展示了其中一个，不需要显得跟谁重名。
 *
 * 不处理的场景（如实记录，不是漏做）：`payment-methods-manager.tsx`（支付方式
 * 设置页本身）已经自带 `{label}（{kind} · {settlementCurrency}）` 的展示格式
 * （round 15 落地，见该文件），不存在这个歧义问题，这个 helper 不需要覆盖它。
 */
export interface DisambiguationInput {
  id: string;
  label: string;
  settlementCurrency: string;
}

/** 返回 id → 消歧义后展示文字 的映射；label 唯一的原样返回，不修改。 */
export function disambiguatePaymentMethodLabels<T extends DisambiguationInput>(methods: T[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const m of methods) {
    counts.set(m.label, (counts.get(m.label) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const m of methods) {
    const isDuplicate = (counts.get(m.label) ?? 0) > 1;
    result.set(m.id, isDuplicate ? `${m.label}（${m.settlementCurrency}）` : m.label);
  }
  return result;
}
