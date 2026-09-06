import { describe, expect, it } from 'vitest';
import { computeNetBalances, computeSettlement, simplifyDebts } from './settlement';
import type { SettlementExpenseInput } from './settlement';

describe('computeNetBalances', () => {
  it('付款人得正、分摊人得负，三人平分一笔消费', () => {
    const expenses: SettlementExpenseInput[] = [
      {
        payerParticipantId: 'A',
        amountBaseCurrency: 300,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 100 },
          { participantId: 'B', shareAmountBaseCurrency: 100 },
          { participantId: 'C', shareAmountBaseCurrency: 100 },
        ],
      },
    ];

    const net = computeNetBalances(expenses);
    expect(net.get('A')).toBe(200); // 垫了300，自己只该出100
    expect(net.get('B')).toBe(-100);
    expect(net.get('C')).toBe(-100);
  });

  it('多笔消费的净值会累加', () => {
    const expenses: SettlementExpenseInput[] = [
      {
        payerParticipantId: 'A',
        amountBaseCurrency: 100,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 50 },
          { participantId: 'B', shareAmountBaseCurrency: 50 },
        ],
      },
      {
        payerParticipantId: 'B',
        amountBaseCurrency: 100,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 50 },
          { participantId: 'B', shareAmountBaseCurrency: 50 },
        ],
      },
    ];

    const net = computeNetBalances(expenses);
    expect(net.get('A')).toBe(0);
    expect(net.get('B')).toBe(0);
  });

  it('没有任何消费时返回空 map', () => {
    expect(computeNetBalances([]).size).toBe(0);
  });
});

describe('simplifyDebts', () => {
  it('两人场景只需要一笔转账', () => {
    const net = new Map([
      ['A', 200],
      ['B', -200],
    ]);
    const transfers = simplifyDebts(net);
    expect(transfers).toEqual([{ fromParticipantId: 'B', toParticipantId: 'A', amountBaseCurrency: 200 }]);
  });

  it('净值为 0 的人不产生任何转账', () => {
    const net = new Map([
      ['A', 0],
      ['B', 0],
    ]);
    expect(simplifyDebts(net)).toEqual([]);
  });

  it('三人场景化简到最少转账笔数（债权人=1时应为 n-1 笔）', () => {
    // A 该收 300，B 欠 100，C 欠 200，最少 2 笔就能清零（各自转给 A）
    const net = new Map([
      ['A', 300],
      ['B', -100],
      ['C', -200],
    ]);
    const transfers = simplifyDebts(net);
    expect(transfers).toHaveLength(2);
    const totalToA = transfers
      .filter((t) => t.toParticipantId === 'A')
      .reduce((sum, t) => sum + t.amountBaseCurrency, 0);
    expect(totalToA).toBe(300);
  });

  it('多对多场景每笔转账金额都为正数，且总额守恒', () => {
    const net = new Map([
      ['A', 500],
      ['B', 300],
      ['C', -400],
      ['D', -400],
    ]);
    const transfers = simplifyDebts(net);
    expect(transfers.every((t) => t.amountBaseCurrency > 0)).toBe(true);

    const totalTransferred = transfers.reduce((sum, t) => sum + t.amountBaseCurrency, 0);
    expect(totalTransferred).toBe(800);
  });
});

describe('computeSettlement', () => {
  it('端到端：从 expense 输入直接算出转账清单', () => {
    const expenses: SettlementExpenseInput[] = [
      {
        payerParticipantId: 'A',
        amountBaseCurrency: 900,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 300 },
          { participantId: 'B', shareAmountBaseCurrency: 300 },
          { participantId: 'C', shareAmountBaseCurrency: 300 },
        ],
      },
    ];

    const transfers = computeSettlement(expenses);
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.toParticipantId === 'A')).toBe(true);
  });
});
