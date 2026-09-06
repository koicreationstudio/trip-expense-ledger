/**
 * 一笔消费默认怎么分摊：全体参与者等分。
 * 整数分运算，除不尽的余数按参与者顺序前几个各多分 1 分，保证总和严格等于原始金额，
 * 不能用四舍五入各自独立算，那样总和会跟 amountBaseCurrency 对不上。
 */
export interface SplitShare {
  participantId: string;
  shareAmountBaseCurrency: number;
}

export function equalSplit(totalAmountBaseCurrency: number, participantIds: string[]): SplitShare[] {
  if (participantIds.length === 0) {
    throw new Error('equalSplit 需要至少一个参与者');
  }

  const base = Math.floor(totalAmountBaseCurrency / participantIds.length);
  const remainder = totalAmountBaseCurrency - base * participantIds.length;

  return participantIds.map((participantId, index) => ({
    participantId,
    shareAmountBaseCurrency: base + (index < remainder ? 1 : 0),
  }));
}
