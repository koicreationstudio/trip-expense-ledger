import { NextResponse } from 'next/server';
import type { SplitShare } from '../domain/split';

/**
 * 校验客户端传来的自定义 splits：参与者必须都在这个 trip 里、不能重复、
 * 总和必须严格等于这笔消费的 amountBaseCurrency，否则净额结算会悄悄对不上。
 * 通过返回 null，不通过返回现成的 400 NextResponse，路由直接 return。
 */
export function validateSplits(
  splits: SplitShare[],
  amountBaseCurrency: number,
  validParticipantIds: Set<string>
): NextResponse | null {
  const seen = new Set<string>();
  for (const split of splits) {
    if (seen.has(split.participantId)) {
      return NextResponse.json({ error: 'duplicate_split_participant' }, { status: 400 });
    }
    seen.add(split.participantId);

    if (!validParticipantIds.has(split.participantId)) {
      return NextResponse.json({ error: 'invalid_split_participant' }, { status: 400 });
    }
  }

  const sum = splits.reduce((total, s) => total + s.shareAmountBaseCurrency, 0);
  if (sum !== amountBaseCurrency) {
    return NextResponse.json({ error: 'splits_do_not_sum_to_total' }, { status: 400 });
  }

  return null;
}
