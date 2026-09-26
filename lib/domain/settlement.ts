/**
 * 净额结算：把「谁代垫了多少、该由谁分摊多少」化简成最少笔数的转账清单。
 *
 * 纯函数，不碰数据库/时间，调用方负责把 expense + expense_split 查询结果
 * 转成这里要的输入形状，方便离开真实数据库也能单测。
 *
 * 金额一律用最小货币单位（分）的整数表示，避免浮点误差累积。
 */

export interface SettlementExpenseInput {
  payerParticipantId: string;
  amountBaseCurrency: number;
  splits: { participantId: string; shareAmountBaseCurrency: number }[];
}

export interface Transfer {
  fromParticipantId: string;
  toParticipantId: string;
  amountBaseCurrency: number;
}

/**
 * 每个参与者的净值 = 代垫总额 - 应分摊总额。
 * 正数代表「该收到钱」，负数代表「该付钱」，理论上全部相加应为 0。
 */
export function computeNetBalances(expenses: SettlementExpenseInput[]): Map<string, number> {
  const net = new Map<string, number>();
  const add = (participantId: string, amount: number) => {
    net.set(participantId, (net.get(participantId) ?? 0) + amount);
  };

  for (const expense of expenses) {
    add(expense.payerParticipantId, expense.amountBaseCurrency);
    for (const split of expense.splits) {
      add(split.participantId, -split.shareAmountBaseCurrency);
    }
  }

  return net;
}

/**
 * 最少转账笔数简化：贪心「最大债权人配最大债务人」。
 *
 * 这不是数学最优解（真正的最优解等价于 NP-hard 的分区问题），但对 v0.1
 * 典型的 2~15 人小团体场景，贪心法给出的笔数已经等于或接近最优，
 * 换来的是 O(n log n) 级别、容易验证正确性的实现，这是明确的取舍，
 * 不为了理论最优去引入 DP/回溯的复杂度。
 */
export function simplifyDebts(netBalances: Map<string, number>): Transfer[] {
  let creditors = [...netBalances]
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount }));
  let debtors = [...netBalances]
    .filter(([, amount]) => amount < 0)
    .map(([id, amount]) => ({ id, amount: -amount }));

  const transfers: Transfer[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.amount, debtor.amount);

    transfers.push({
      fromParticipantId: debtor.id,
      toParticipantId: creditor.id,
      amountBaseCurrency: amount,
    });

    creditor.amount -= amount;
    debtor.amount -= amount;

    creditors = creditors.filter((c) => c.amount > 0);
    debtors = debtors.filter((d) => d.amount > 0);
  }

  return transfers;
}

export function computeSettlement(expenses: SettlementExpenseInput[]): Transfer[] {
  return simplifyDebts(computeNetBalances(expenses));
}

// ---------------------------------------------------------------------------
// 按原始币种拆开的转账清单（2026-09-26，"结算页转账清单按币种分行"）。
//
// "每人净值"（上面 computeNetBalances/computeSettlement）不变，一直都是全部
// 币种合在一起算的一个本位币数字；这里只是给"转账清单"另外算一份分币种视图：
// 同一笔 from→to 的欠款，原始是哪个币种花的钱，就单独拉一行出来（不再细分
// 支付方式），本位币层面完全精确，原始币种数字是展示用、历史数据是近似值。
// ---------------------------------------------------------------------------

export interface SettlementExpenseInputWithCurrency {
  currency: string;
  payerParticipantId: string;
  amountBaseCurrency: number;
  amountOriginal: number; // 这笔消费的原始币种金额（expense.amount）
  splits: {
    participantId: string;
    shareAmountBaseCurrency: number;
    shareAmountOriginal: number;
  }[];
}

export interface CurrencyTransfer extends Transfer {
  currency: string;
  amountOriginal: number; // 这笔转账对应的原始币种金额，展示用
}

/**
 * 按 expense.currency 分组，每个币种各自独立跑一次 computeNetBalances/
 * simplifyDebts——这是这次的实现路径：外面套一层"按币种分组再各自调用一次"，
 * 不重写净额结算算法本身。
 *
 * 每个币种分组内部两条平行的净值计算：一条用 shareAmountBaseCurrency/
 * amountBaseCurrency（本位币，精确，是"谁最终欠谁多少钱"的真相源），另一条用
 * shareAmountOriginal/amountOriginal（原始币种，展示用，历史数据是比例反推的
 * 近似值，见 split.ts deriveOriginalCurrencyShares 的注释）。两条净值各自
 * simplifyDebts 之后按 (from,to) 配对——正常情况下（每个币种分组只有一个
 * "债权人 vs 债务人"方向，也是目前所有真实数据的样子）两条链路配对的结果
 * 完全一致；理论上极少数多债权人/多债务人场景下，两条链路各自的贪心算法可能
 * 选出不完全对应的配对，这时退回用这个币种分组"原始币种总额 / 本位币总额"的
 * 比例去反推这一笔的原始币种展示金额，保证一定有数字可以显示，不会因为配对
 * 失败而丢行——这层近似只影响显示的原始币种小数字，不影响本位币金额（真正
 * 决定"该转多少钱"的数字，一直只看 amountBaseCurrency 那条链路）。
 */
export function computeSettlementByCurrency(
  expenses: SettlementExpenseInputWithCurrency[]
): Map<string, CurrencyTransfer[]> {
  const byCurrency = new Map<string, SettlementExpenseInputWithCurrency[]>();
  for (const expense of expenses) {
    const list = byCurrency.get(expense.currency) ?? [];
    list.push(expense);
    byCurrency.set(expense.currency, list);
  }

  const result = new Map<string, CurrencyTransfer[]>();
  for (const [currency, group] of byCurrency) {
    const baseTransfers = simplifyDebts(computeNetBalances(group));
    if (baseTransfers.length === 0) continue; // 这个币种在这个分组里净值为 0，不需要转账，不占一行

    const nativeNet = computeNetBalances(
      group.map((expense) => ({
        payerParticipantId: expense.payerParticipantId,
        amountBaseCurrency: expense.amountOriginal,
        splits: expense.splits.map((s) => ({
          participantId: s.participantId,
          shareAmountBaseCurrency: s.shareAmountOriginal,
        })),
      }))
    );
    const nativeTransfers = simplifyDebts(nativeNet);
    const nativeByKey = new Map(
      nativeTransfers.map((t) => [`${t.fromParticipantId}:${t.toParticipantId}`, t.amountBaseCurrency])
    );

    const totalNative = group.reduce((sum, e) => sum + e.amountOriginal, 0);
    const totalBase = group.reduce((sum, e) => sum + e.amountBaseCurrency, 0);

    const transfers: CurrencyTransfer[] = baseTransfers.map((t) => {
      const key = `${t.fromParticipantId}:${t.toParticipantId}`;
      const matched = nativeByKey.get(key);
      const amountOriginal =
        matched !== undefined ? matched : totalBase > 0 ? Math.round((t.amountBaseCurrency * totalNative) / totalBase) : 0;
      return { ...t, currency, amountOriginal };
    });
    result.set(currency, transfers);
  }
  return result;
}
