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
  category: z.string().trim().min(1).max(100),
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
});
