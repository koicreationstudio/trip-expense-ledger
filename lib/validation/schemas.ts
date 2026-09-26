import { z } from 'zod';

const currencyCode = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());

const splitSchema = z.object({
  participantId: z.string().min(1),
  shareAmountBaseCurrency: z.number().int().nonnegative(),
});

export const createTripSchema = z.object({
  name: z.string().trim().min(1).max(200),
  baseCurrency: currencyCode,
  ownerDisplayName: z.string().trim().min(1).max(100),
  participantNames: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  // 屏⑦新建行程新增字段（2026-09-13 落地第四轮拍板，都是可选，老流程不填也能建行程）：
  tripStartDate: z.string().datetime().optional(),
  tripEndDate: z.string().datetime().optional(),
  enabledCurrencies: z.array(currencyCode).max(20).optional(),
});

/** 屏①首页卡片可改名新增：目前只开放改名字，不是完整的行程设置编辑。 */
export const updateTripSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export const createExpenseSchema = z.object({
  payerParticipantId: z.string().min(1),
  amount: z.number().int().positive(),
  currency: currencyCode,
  // 只在 currency !== trip.baseCurrency 时需要，手动输入兜底，不在这里强制必填，
  // 由路由按 trip.baseCurrency 动态判断要不要求这个字段。
  fxRateUsed: z.number().positive().optional(),
  // 比价卡片里选定实际使用的支付方式，可空（不比价/不选也能记账）。
  paymentMethodId: z.string().min(1).optional(),
  category: z.string().trim().min(1).max(100),
  // 商家名称，纯展示用可选字段；允许空字符串（编辑时借它表达"清空"，跟 note
  // 的处理方式一致：undefined = 不改这个字段，空字符串 = 显式清空）。
  merchant: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  expenseDate: z.string().datetime(),
  // 不传就在路由里按 trip 全部参与者等分
  splits: z.array(splitSchema).min(1).optional(),
  // 这笔要不要计入 Hero 卡"我承担"主数字的分摊合计，不传按 schema 默认值 false
  // （2026-09-16 新增，见 lib/db/schema.ts expenses.excludeFromSplit 注释）。
  excludeFromSplit: z.boolean().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const createPaymentMethodSchema = z.object({
  label: z.string().trim().min(1).max(100),
  kind: z.enum(['card', 'cash']),
  settlementCurrency: currencyCode,
  fxMarkupPercent: z.number().min(0).max(100).default(0),
  foreignTxnFeePercent: z.number().min(0).max(100).default(0),
  fixedFee: z.number().int().min(0).default(0),
  cashbackPercent: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().default(0),
  // 「支付方式」页现在是行程内路由（/trips/[tripId]/payment-methods），新建的这个
  // 支付方式在这趟行程默认就是「启用」——不用建完还要再点一次勾选。可选是因为
  // payment_method 本身是账号级数据，不排除以后有别的入口不带 tripId 建它。
  tripId: z.string().min(1).optional(),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** 「本行程启用的支付方式」勾选/取消勾选，2026-09-15 落地 Artifact Version 10 遗留缺口。 */
export const updatePaymentMethodEnablementSchema = z.object({
  enabled: z.boolean(),
});

export const claimParticipantSchema = z.object({
  participantId: z.string().min(1),
});

export const createInviteSchema = z.object({
  expiresInDays: z.number().int().positive().max(365).optional(),
  // "对方名字"：纯人类可读标签，方便生成邀请的人自己认出这条链接是给谁的
  // （2026-09-13 落地第四轮拍板屏⑥），不参与任何鉴权判断。
  inviteeName: z.string().trim().max(100).optional(),
});

/** 屏⑥"直接添加参与者"新增：纯姓名，没有登录方式，claimedAt 留空跟占位同行人一样。 */
export const addParticipantSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

export const fxRecommendationSchema = z.object({
  amount: z.number().int().positive(),
  expenseCurrency: currencyCode,
  // true = 不管缓存新不新鲜都立刻现抓一次(独立汇率卡片的「刷新」按钮用)
  forceRefresh: z.boolean().optional(),
  // fix(2026-09-25，任务③)：不传就照旧退回行程本位币（老调用方/老前端不用改）。
  // fx-compare-card.tsx 这次改成显式传"我持有"当前选中的币种——"我的支付方式"
  // 这组数字的隐含汇率公式（impliedRate = 目标币种金额 / 成本）只有在
  // compareCurrency === 我持有 时数学上才是对的，见该文件顶部大注释第 8 点。
  compareCurrency: currencyCode.optional(),
});

// fix(2026-09-24，Remy 明确要求)：汇率比价卡片"我持有/目标币种/自选比较项/
// 兑换金额"这组选项按用户×行程存 D1（见 fx-compare-preference 路由）。币种
// 是否真的在候选池里、自选比较项的 key 对不对得上当前渠道/卡片，这层只做
// 格式校验，业务层面"存的值是不是还有效"由路由再校验一层 + 前端优雅降级
// （值失效不阻塞渲染，见 fx-compare-card.tsx）。
export const fxComparePreferenceSchema = z.object({
  holdCurrency: currencyCode,
  targetCurrency: currencyCode,
  // channel:<key> / card:<paymentMethodId> 统一命名空间，跟 fx-compare-card.tsx
  // 的 enabledCompareKeys 这个 Set 的元素形状一致。
  enabledCompareKeys: z.array(z.string().trim().min(1).max(120)).max(100),
  // "元"（跟页面 amountYuan 输入框同单位），不是分——转换只发生在这个 API
  // 内部，跟 fx-recommendation 那边"提交给 API 前才转最小货币单位"的既有
  // 约定一致。
  amountYuan: z.number().finite().nonnegative().max(1_000_000_000),
});

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(200)
  .email();

const password = z.string().min(8).max(200);

export const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const switchTripSchema = z.object({
  tripId: z.string().min(1),
});

export const createWalletSchema = z.object({
  label: z.string().trim().min(1).max(100),
  currency: currencyCode,
  emoji: z.string().trim().min(1).max(8).default('💰'),
  // 用户输入的起始余额（最小货币单位），只在新建时设置一次；之后由记账/换汇驱动变化。
  initialBalance: z.number().int().min(0).default(0),
  paymentMethodId: z.string().min(1).optional(),
});

export const updateWalletSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  paymentMethodId: z.string().min(1).nullable().optional(),
  // 允许手动订正余额（比如跟实际现金对不上时），不算「记一笔换汇」，直接覆盖。
  currentBalance: z.number().int().optional(),
  // 「设置当前余额」这个动作发生的记录时间，可选补录成之前的日期
  // （2026-09-13 落地第四轮拍板屏⑤），只在同时传了 currentBalance 时才有意义。
  balanceUpdatedAt: z.string().datetime().optional(),
});

export const settlementConfirmationSchema = z.object({
  fromParticipantId: z.string().min(1),
  toParticipantId: z.string().min(1),
});

export const setWalletBalanceSchema = z.object({
  currentBalance: z.number().int(),
  // 可选补录成之前的日期，不传就是"现在"——支付方式页"设置当前余额"新功能专用
  // （2026-09-13 落地第四轮拍板屏⑤），跟 updateWalletSchema 分开是因为这个动作
  // 语义上专门是"记一次余额快照"，不是随手改钱包名字这类字段更新。
  recordedAt: z.string().datetime().optional(),
});

export const createExchangeRecordSchema = z
  .object({
    fromWalletId: z.string().min(1).optional(),
    toWalletId: z.string().min(1),
    fromAmount: z.number().int().positive().optional(),
    toAmount: z.number().int().positive(),
    exchangeDate: z.string().datetime(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => (v.fromWalletId ? v.fromAmount !== undefined : v.fromAmount === undefined), {
    message: 'fromAmount 要跟 fromWalletId 同时有或同时没有',
    path: ['fromAmount'],
  });

// fix(2026-09-26 第七十一轮，任务⑥)：活动流排序模式 + 4 个筛选条件云端同步，跟
// fxComparePreferenceSchema 同一套模式——'ALL' 是 expense-list.tsx 既有的
// "不筛选"字面量，原样存字符串。
export const expenseListPreferenceSchema = z.object({
  sortMode: z.enum(['manual', 'date', 'amount']),
  categoryFilter: z.string().trim().min(1).max(120),
  payerFilter: z.string().trim().min(1).max(120),
  dateFilter: z.string().trim().min(1).max(120),
  paymentMethodFilter: z.string().trim().min(1).max(120),
  // 第七十二轮任务④新增：「计分摊/不计分摊」筛选，跟上面几个不一样——值域固定只有
  // 3 档（不是从当前数据动态取的候选值），用精确 enum 校验，非法值直接 400。
  splitFilter: z.enum(['ALL', 'included', 'excluded']),
});

// fix(2026-09-26 第七十一轮，任务⑤)：活动流拖拽重排，一次提交"新顺序的完整 id
// 数组"（这趟行程当前手动排序模式下可见的全部消费 id，按拖拽后的新顺序），后端按
// 数组下标批量重算 sortOrder（下标本身就是新的相对顺序，不需要客户端自己算具体
// 数值）。数组长度上限跟这个项目其它列表类接口一致做个宽松上限，防止异常大请求。
export const reorderExpensesSchema = z.object({
  orderedExpenseIds: z.array(z.string().min(1)).min(1).max(2000),
});
