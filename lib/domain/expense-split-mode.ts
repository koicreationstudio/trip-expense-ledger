/**
 * 判断一笔消费的 `expense_split` 明细形状是不是"只分给了付款人自己"——这次
 * 命名纠正任务（2026-09-26）新定案的"计分摊/不计分摊"概念，专指这件事，跟
 * `expenses.excludeFromSplit`（那个字段现在改叫"业务成本"）是两个完全独立的
 * 维度，不要混用。
 *
 * 不需要新增数据库字段：`expense-form.tsx`「仅我自己」模式下 `splits =
 * equalSplit(amountBaseCurrency, [payerParticipantId])` 产生的形状本身就是
 * "只有 1 行，且这一行的 participantId 就是这笔消费的 payerParticipantId"——
 * 不管原始录入时选的是"仅我自己"模式，还是"平分"/"自定义"模式但凑巧只选了
 * 付款人自己一个人，形状一样就归为同一类，不记录原始 UI 选的是哪个模式。
 */
export function isOnlyMeSplit(splitParticipantIds: string[], payerParticipantId: string): boolean {
  return splitParticipantIds.length === 1 && splitParticipantIds[0] === payerParticipantId;
}
