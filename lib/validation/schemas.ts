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
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const claimParticipantSchema = z.object({
  participantId: z.string().min(1),
});

export const createInviteSchema = z.object({
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export const fxRecommendationSchema = z.object({
  amount: z.number().int().positive(),
  expenseCurrency: currencyCode,
  // true = 不管缓存新不新鲜都立刻现抓一次(独立汇率卡片的「刷新」按钮用)
  forceRefresh: z.boolean().optional(),
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
