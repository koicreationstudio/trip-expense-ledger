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
