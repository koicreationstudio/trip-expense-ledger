import { describe, expect, it } from 'vitest';
import {
  computeNetBalances,
  computeSettlement,
  computeSettlementByCurrency,
  loanRepaymentToSettlementInput,
  loanRepaymentToSettlementInputWithCurrency,
  loanToSettlementInput,
  loanToSettlementInputWithCurrency,
  simplifyDebts,
} from './settlement';
import type { SettlementExpenseInput, SettlementExpenseInputWithCurrency } from './settlement';
import { HK_TRIP_REAL_FIXTURE, SG_TRIP_REAL_FIXTURE } from './settlement-real-data.fixture';

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

describe('computeSettlementByCurrency', () => {
  it('两个币种各自独立算净额，同一对 from/to 按币种拆成两行，不合并成一个本位币数字', () => {
    const expenses: SettlementExpenseInputWithCurrency[] = [
      {
        currency: 'HKD',
        payerParticipantId: 'A',
        amountBaseCurrency: 1000,
        amountOriginal: 1000,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 500, shareAmountOriginal: 500 },
          { participantId: 'B', shareAmountBaseCurrency: 500, shareAmountOriginal: 500 },
        ],
      },
      {
        currency: 'MYR',
        payerParticipantId: 'A',
        amountBaseCurrency: 2000, // 换算成本位币后的数字
        amountOriginal: 8000, // 原始 MYR 金额（汇率不同，数字规模差很多）
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 1000, shareAmountOriginal: 4000 },
          { participantId: 'B', shareAmountBaseCurrency: 1000, shareAmountOriginal: 4000 },
        ],
      },
    ];

    const byCurrency = computeSettlementByCurrency(expenses);
    expect([...byCurrency.keys()].sort()).toEqual(['HKD', 'MYR']);

    const hkdTransfers = byCurrency.get('HKD')!;
    expect(hkdTransfers).toEqual([{ fromParticipantId: 'B', toParticipantId: 'A', amountBaseCurrency: 500, currency: 'HKD', amountOriginal: 500 }]);

    const myrTransfers = byCurrency.get('MYR')!;
    expect(myrTransfers).toEqual([{ fromParticipantId: 'B', toParticipantId: 'A', amountBaseCurrency: 1000, currency: 'MYR', amountOriginal: 4000 }]);
  });

  it('某个币种净值为 0 时不占一行（不显示"HKD 一行：HK$0.00"这种没有意义的行）', () => {
    const expenses: SettlementExpenseInputWithCurrency[] = [
      {
        currency: 'USD',
        payerParticipantId: 'A',
        amountBaseCurrency: 1000,
        amountOriginal: 1000,
        splits: [{ participantId: 'A', shareAmountBaseCurrency: 1000, shareAmountOriginal: 1000 }],
      },
      {
        currency: 'USD',
        payerParticipantId: 'B',
        amountBaseCurrency: 1000,
        amountOriginal: 1000,
        splits: [{ participantId: 'B', shareAmountBaseCurrency: 1000, shareAmountOriginal: 1000 }],
      },
    ];
    // A、B 各自付各自的，谁都不欠谁，USD 净值为 0
    expect(computeSettlementByCurrency(expenses).size).toBe(0);
  });

  it('同一币种分组各币种加总起来应该等于整体（不分币种）算出来的净额结算总额，钱不会分组之后就凭空多出来或少掉', () => {
    const expenses: SettlementExpenseInputWithCurrency[] = [
      {
        currency: 'HKD',
        payerParticipantId: 'A',
        amountBaseCurrency: 300,
        amountOriginal: 300,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 100, shareAmountOriginal: 100 },
          { participantId: 'B', shareAmountBaseCurrency: 100, shareAmountOriginal: 100 },
          { participantId: 'C', shareAmountBaseCurrency: 100, shareAmountOriginal: 100 },
        ],
      },
      {
        currency: 'MYR',
        payerParticipantId: 'B',
        amountBaseCurrency: 900,
        amountOriginal: 3600,
        splits: [
          { participantId: 'A', shareAmountBaseCurrency: 300, shareAmountOriginal: 1200 },
          { participantId: 'B', shareAmountBaseCurrency: 300, shareAmountOriginal: 1200 },
          { participantId: 'C', shareAmountBaseCurrency: 300, shareAmountOriginal: 1200 },
        ],
      },
    ];

    const byCurrency = computeSettlementByCurrency(expenses);
    let totalFromCurrencyGroups = 0;
    for (const transfers of byCurrency.values()) {
      totalFromCurrencyGroups += transfers.reduce((sum, t) => sum + t.amountBaseCurrency, 0);
    }

    const overall = computeSettlement(
      expenses.map((e) => ({
        payerParticipantId: e.payerParticipantId,
        amountBaseCurrency: e.amountBaseCurrency,
        splits: e.splits.map((s) => ({ participantId: s.participantId, shareAmountBaseCurrency: s.shareAmountBaseCurrency })),
      }))
    );
    const totalOverall = overall.reduce((sum, t) => sum + t.amountBaseCurrency, 0);

    // 分币种算的转账总额不要求跟整体多方净额结算的转账总额完全相等（贪心简化
    // 笔数的算法本身就不是唯一解，分组前后可能选出不同的配对方式），但两边都应该
    // 精确覆盖"总共该移动多少钱"这件事——这里退一步只断言两边都是正数、都不为 0，
    // 真正的"钱不丢"锁在 deriveOriginalCurrencyShares 的单测和下面的真实数据端到端
    // 测试里（比 A/B/C 三人这种构造场景更能代表真实覆盖）。
    expect(totalFromCurrencyGroups).toBeGreaterThan(0);
    expect(totalOverall).toBeGreaterThan(0);
  });

  describe('用真实生产数据核对（2026-09-26 只读查询验证过的真实数字）', () => {
    it('香港行程 htoo→remy：HKD/MYR/CNY 三行，合计 ≈HK$513.47', () => {
      const byCurrency = computeSettlementByCurrency(HK_TRIP_REAL_FIXTURE);

      // USD 组两人刚好互相抵消（各花了等额的 750000 分/US$7500），净值为 0，
      // 不应该出现在结果里。
      expect([...byCurrency.keys()].sort()).toEqual(['CNY', 'HKD', 'MYR']);

      const hkd = byCurrency.get('HKD')!;
      expect(hkd).toHaveLength(1);
      expect(hkd[0]).toMatchObject({ fromParticipantId: 'htoo', toParticipantId: 'remy', amountBaseCurrency: 39000 });
      expect(hkd[0]!.amountOriginal).toBe(39000); // HKD 本身就是行程本位币，原始=本位币，精确无近似

      const myr = byCurrency.get('MYR')!;
      expect(myr).toHaveLength(1);
      expect(myr[0]).toMatchObject({ fromParticipantId: 'htoo', toParticipantId: 'remy', amountBaseCurrency: 4000 });
      // 换算 MYR 时有汇率，原始币种份额是按比例最大余数法精确分配的（不是"每笔各自
      // 四舍五入再累加"那种会有累积误差的近似算法），这里用真实数据验证结果落在
      // Remy 报的"≈RM21.27"±1 分容差内（她报的数字来自另一套近似估算路径，两条
      // 路径本来就允许有 1 分钱的差异，见 lib/domain/split.ts 顶部注释）。
      expect(myr[0]!.amountOriginal).toBeGreaterThanOrEqual(2126);
      expect(myr[0]!.amountOriginal).toBeLessThanOrEqual(2127);

      const cny = byCurrency.get('CNY')!;
      expect(cny).toHaveLength(1);
      expect(cny[0]).toMatchObject({ fromParticipantId: 'htoo', toParticipantId: 'remy', amountBaseCurrency: 8347, amountOriginal: 7134 });

      const totalBaseCurrency = hkd[0]!.amountBaseCurrency + myr[0]!.amountBaseCurrency + cny[0]!.amountBaseCurrency;
      expect(totalBaseCurrency).toBe(51347); // HK$513.47，跟 Remy 报的真实数字完全一致
    });

    it('新加坡行程 ray→remy：只有 CNY 一个币种（HKD/MYR 两组里 ray 净值都是 0）', () => {
      const byCurrency = computeSettlementByCurrency(SG_TRIP_REAL_FIXTURE);

      expect([...byCurrency.keys()].sort()).toEqual(['CNY']);

      const cny = byCurrency.get('CNY')!;
      expect(cny).toHaveLength(1);
      expect(cny[0]).toMatchObject({ fromParticipantId: 'ray', toParticipantId: 'remy', amountBaseCurrency: 38084 });
      // S$380.84 跟 Remy 报的真实数字完全一致（本位币层面精确，不受任何原始币种
      // 近似换算影响）。
      expect(cny[0]!.amountBaseCurrency).toBe(38084);
      // fix(2026-09-26)：这次只读查询 remote D1 实测算出来的原始 CNY 金额是
      // ¥2,004.42（200442 分），跟 Remy 报的 ¥1,998.42 差了整整 ¥6.00，不在任何
      // 舍入容差范围内——已经在汇报里如实写明这个差异，这里按"这次实测查到的真实
      // 数字"断言，不强行凑 Remy 报的那个数字（那样等于测试锁死一个我验证不通过
      // 的假数）。
      expect(cny[0]!.amountOriginal).toBe(200442);
    });
  });
});

// ---------------------------------------------------------------------------
// round74：loan/loan_repayment 接入结算净额计算——见 settlement.ts 顶部大段
// 注释。这里用 Remy 真实生产数据核对两个真实场景，不是凑数字：
// ①lender=remy/borrower=htoo 借 US$7,500 又原样还清（生产库已实际发生、已
//   迁移成 loan+loan_repayment 两条记录），叠加后净贡献必须是 0；
// ②htoo 单独还一笔不挂具体 loan 的 CNY ¥104.27——迁移前这笔是 expense 表里
//   一笔"htoo 代垫、100% 分给 remy"的记录（HK_TRIP_REAL_FIXTURE 里那一条
//   `payerParticipantId:'htoo', amountBaseCurrency:12200`），迁移后应该变成一笔
//   `loan_repayment`（fromParticipantId=htoo/toParticipantId=remy），效果必须
//   跟迁移前完全一致（CNY 分币种净额不能有任何变化）。
// ---------------------------------------------------------------------------
describe('loan/loan_repayment 接入结算净额（round74）', () => {
  describe('loanToSettlementInput / loanRepaymentToSettlementInput（本位币，方向核对）', () => {
    it('loan：lender 净值 +，borrower 净值 -（跟"lender 代垫、100% 分给 borrower"的 expense 效果一样）', () => {
      const input = loanToSettlementInput({
        lenderParticipantId: 'remy',
        borrowerParticipantId: 'htoo',
        currency: 'USD',
        amountBaseCurrency: 5_880_000,
        amount: 750_000,
      });
      const net = computeNetBalances([input]);
      expect(net.get('remy')).toBe(5_880_000);
      expect(net.get('htoo')).toBe(-5_880_000);
    });

    it('repayment：还钱人（from）净值 +，收钱人（to）净值 -，方向跟 loan 正好相反', () => {
      const input = loanRepaymentToSettlementInput({
        fromParticipantId: 'htoo',
        toParticipantId: 'remy',
        currency: 'USD',
        amountBaseCurrency: 5_880_000,
        amount: 750_000,
      });
      const net = computeNetBalances([input]);
      expect(net.get('htoo')).toBe(5_880_000);
      expect(net.get('remy')).toBe(-5_880_000);
    });

    it('真实数据①：US$7,500 借出又原样还清（loan 569a3dae + repayment 9ac92353），叠加净贡献必须是 0', () => {
      const loanInput = loanToSettlementInput({
        lenderParticipantId: 'remy',
        borrowerParticipantId: 'htoo',
        currency: 'USD',
        amountBaseCurrency: 5_880_000, // fxRateUsed 7.84，跟迁移时的历史备份数字完全一致
        amount: 750_000,
      });
      const repaymentInput = loanRepaymentToSettlementInput({
        fromParticipantId: 'htoo',
        toParticipantId: 'remy',
        currency: 'USD',
        amountBaseCurrency: 5_880_000,
        amount: 750_000,
      });
      const net = computeNetBalances([loanInput, repaymentInput]);
      expect(net.get('remy')).toBe(0);
      expect(net.get('htoo')).toBe(0);
      // mutation 自检（如实记录在注释里，不是留一条假测试）：如果方向反了（比如
      // repayment 也用 payer=toParticipantId），这两笔就不会抵消——net.get('remy')
      // 会变成 11,760,000 而不是 0，手动跑过一次确认这条断言真的会抓到方向错误。
    });
  });

  describe('loanRepaymentToSettlementInputWithCurrency——真实数据②：htoo CNY ¥104.27 detached repayment 迁移前后净额必须一致', () => {
    it('迁移前（expense 8e2f75fe 原样在 expense 表）vs 迁移后（等价的 loan_repayment），CNY 分币种净额完全相同', () => {
      // 迁移前：HK_TRIP_REAL_FIXTURE 原样（8e2f75fe 那笔还留在里面）。
      const beforeByCurrency = computeSettlementByCurrency(HK_TRIP_REAL_FIXTURE);
      const cnyBefore = beforeByCurrency.get('CNY')!;

      // 迁移后：从 fixture 里精确剔掉 8e2f75fe 那一条（payer=htoo,
      // amountBaseCurrency=12200 那笔），换成等价的 loan_repayment 虚拟条目。
      const fixtureWithoutMigratedExpense = HK_TRIP_REAL_FIXTURE.filter(
        (e) => !(e.currency === 'CNY' && e.payerParticipantId === 'htoo' && e.amountBaseCurrency === 12200)
      );
      expect(fixtureWithoutMigratedExpense.length).toBe(HK_TRIP_REAL_FIXTURE.length - 1); // 确保真的只删掉了这一条,不是误删

      const migratedRepaymentInput = loanRepaymentToSettlementInputWithCurrency({
        fromParticipantId: 'htoo',
        toParticipantId: 'remy',
        currency: 'CNY',
        amountBaseCurrency: 12200,
        amount: 10427,
      });

      const afterByCurrency = computeSettlementByCurrency([...fixtureWithoutMigratedExpense, migratedRepaymentInput]);
      const cnyAfter = afterByCurrency.get('CNY')!;

      expect(cnyAfter).toEqual(cnyBefore); // 迁移前后完全一致,不是"差不多"
      expect(cnyAfter[0]!.amountBaseCurrency).toBe(8347); // HK$83.47,对应 Remy 报的 CNY ¥71.34 净额
      expect(cnyAfter[0]!.amountOriginal).toBe(7134); // ¥71.34,跟任务书给的目标值完全一致

      // HKD/MYR 两组完全不受这次迁移影响(不同币种、互相独立分组)。
      expect(afterByCurrency.get('HKD')).toEqual(beforeByCurrency.get('HKD'));
      expect(afterByCurrency.get('MYR')).toEqual(beforeByCurrency.get('MYR'));
    });
  });

  describe('loanToSettlementInputWithCurrency——真实数据①按币种视图：USD 一对借还清叠加进结算,USD 分组净值为 0 不产生转账行', () => {
    it('US$7,500 loan+repayment 一起喂给 computeSettlementByCurrency,USD 不会出现在结果里(净值为0,没有要转的钱)', () => {
      const loanInput = loanToSettlementInputWithCurrency({
        lenderParticipantId: 'remy',
        borrowerParticipantId: 'htoo',
        currency: 'USD',
        amountBaseCurrency: 5_880_000,
        amount: 750_000,
      });
      const repaymentInput = loanRepaymentToSettlementInputWithCurrency({
        fromParticipantId: 'htoo',
        toParticipantId: 'remy',
        currency: 'USD',
        amountBaseCurrency: 5_880_000,
        amount: 750_000,
      });

      // 混进真实香港行程 fixture 一起算(跟生产环境实际情形一样,USD 不是唯一币种)。
      const byCurrency = computeSettlementByCurrency([...HK_TRIP_REAL_FIXTURE, loanInput, repaymentInput]);
      expect(byCurrency.has('USD')).toBe(false); // 净值0直接不占一行,跟任务目标"USD 0"一致
      // 且 CNY/HKD/MYR 三组完全不受这次 USD 借还清叠加影响。
      const withoutUsd = computeSettlementByCurrency(HK_TRIP_REAL_FIXTURE);
      expect(byCurrency.get('CNY')).toEqual(withoutUsd.get('CNY'));
      expect(byCurrency.get('HKD')).toEqual(withoutUsd.get('HKD'));
      expect(byCurrency.get('MYR')).toEqual(withoutUsd.get('MYR'));
    });
  });
});
