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

export interface NativeCurrencyShare {
  participantId: string;
  amountNativeCents: number;
}

/**
 * 自定义分摊：用户按消费原本的币种给每个人分好金额（总和等于这笔消费的原始金额），
 * 这里按比例换算成本位币金额（有汇率时金额会变，比如泰铢换成人民币）。
 * 用"最大余数法"分配换算后的零头，不能每人各自四舍五入，那样总和会跟
 * amountBaseCurrency 对不上，后端 validateSplits 会直接拒收。
 */
export function rescaleSplitToBaseCurrency(
  nativeShares: NativeCurrencyShare[],
  amountBaseCurrency: number
): SplitShare[] {
  if (nativeShares.length === 0) {
    throw new Error('rescaleSplitToBaseCurrency 需要至少一个参与者');
  }

  const totalNative = nativeShares.reduce((sum, s) => sum + s.amountNativeCents, 0);
  if (totalNative <= 0) {
    throw new Error('rescaleSplitToBaseCurrency 需要分摊总额大于 0');
  }

  const totalNativeBig = BigInt(totalNative);
  const totalBaseBig = BigInt(amountBaseCurrency);

  const entries = nativeShares.map((share, index) => {
    const numerator = BigInt(share.amountNativeCents) * totalBaseBig;
    return {
      index,
      participantId: share.participantId,
      base: Number(numerator / totalNativeBig),
      remainder: numerator % totalNativeBig,
    };
  });

  const allocated = entries.reduce((sum, e) => sum + e.base, 0);
  let leftover = amountBaseCurrency - allocated;

  const byRemainderDesc = [...entries].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const entry of byRemainderDesc) {
    if (leftover <= 0) break;
    entry.base += 1;
    leftover -= 1;
  }

  return entries
    .sort((a, b) => a.index - b.index)
    .map((e) => ({ participantId: e.participantId, shareAmountBaseCurrency: e.base }));
}

export interface OriginalCurrencyShare {
  participantId: string;
  shareAmountOriginal: number;
}

/**
 * 从已经算好的本位币分摊份额（shareAmountBaseCurrency，总和严格等于
 * amountBaseCurrency），反推每一份对应的原始币种金额，用最大余数法保证总和
 * 精确等于这笔消费的原始币种总额（amountOriginal），不会有一分钱分不出去
 * 悬空——不管这份本位币份额本身是从 equalSplit 等分来的、还是用户自定义分的，
 * 这里都不关心怎么来的，只要"总和 = amountBaseCurrency"这个前提成立就能精确
 * 换算。跟 rescaleSplitToBaseCurrency 是同一套最大余数法，方向反过来（那边是
 * 原始币种份额→本位币份额，这里是本位币份额→原始币种份额），供"结算按币种拆开
 * 显示"这个功能新记录落库时用（historical 记录改用简单比例公式一次性回填，
 * 见 scripts/backfill-expense-split-original-currency.ts，那边不要求总和一分不差，
 * 是已知接受的近似）。
 */
export function deriveOriginalCurrencyShares(
  splits: { participantId: string; shareAmountBaseCurrency: number }[],
  amountBaseCurrency: number,
  amountOriginal: number
): OriginalCurrencyShare[] {
  if (splits.length === 0) {
    throw new Error('deriveOriginalCurrencyShares 需要至少一个参与者');
  }
  if (amountBaseCurrency <= 0) {
    throw new Error('deriveOriginalCurrencyShares 需要 amountBaseCurrency 大于 0');
  }

  const totalWeightBig = BigInt(amountBaseCurrency);
  const totalOriginalBig = BigInt(amountOriginal);

  const entries = splits.map((split, index) => {
    const numerator = BigInt(split.shareAmountBaseCurrency) * totalOriginalBig;
    return {
      index,
      participantId: split.participantId,
      base: Number(numerator / totalWeightBig),
      remainder: numerator % totalWeightBig,
    };
  });

  const allocated = entries.reduce((sum, e) => sum + e.base, 0);
  let leftover = amountOriginal - allocated;

  const byRemainderDesc = [...entries].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const entry of byRemainderDesc) {
    if (leftover <= 0) break;
    entry.base += 1;
    leftover -= 1;
  }

  return entries
    .sort((a, b) => a.index - b.index)
    .map((e) => ({ participantId: e.participantId, shareAmountOriginal: e.base }));
}
