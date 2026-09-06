import { relations, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

// ---------------------------------------------------------------------------
// trip：一次出差行程，是几乎所有其它表的顶层归属单位
// ---------------------------------------------------------------------------
export const trips = sqliteTable('trip', {
  id: id(),
  name: text('name').notNull(),
  baseCurrency: text('base_currency').notNull(),
  // active: 记账中 | settled: 已标记结算(settlement_snapshot 已冻结) | archived: 归档隐藏
  status: text('status', { enum: ['active', 'settled', 'archived'] })
    .notNull()
    .default('active'),
  // 建表时 owner 还不存在，先允许 null，创建流程里第二步立刻回填
  ownerParticipantId: text('owner_participant_id'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// participant：trip 下的一个身份占位/成员，未被邀请链接认领时 claimedAt 为 null。
// ---------------------------------------------------------------------------
export const participants = sqliteTable(
  'participant',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
    // null = 尚未被邀请链接认领的占位名字
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => ({
    tripIdx: index('participant_trip_idx').on(table.tripId),
  })
);

// ---------------------------------------------------------------------------
// session：一个 participant 认领身份后拿到的浏览器会话，可以有多个(多设备)。
// cookie 里只放明文 token，DB 只存 hash，防止 DB 泄露=身份泄露。
// ---------------------------------------------------------------------------
export const sessions = sqliteTable(
  'session',
  {
    id: id(),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('session_token_hash_idx').on(table.tokenHash),
    participantIdx: index('session_participant_idx').on(table.participantId),
  })
);

// ---------------------------------------------------------------------------
// invite：行程的邀请链接，code 是不可猜测的随机 token，出现在 URL 里。
// ---------------------------------------------------------------------------
export const invites = sqliteTable(
  'invite',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    createdByParticipantId: text('created_by_participant_id')
      .notNull()
      .references(() => participants.id),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    codeIdx: uniqueIndex('invite_code_idx').on(table.code),
    tripIdx: index('invite_trip_idx').on(table.tripId),
  })
);

// ---------------------------------------------------------------------------
// expense：一笔消费记录。
// entered_by_participant_id 决定「谁能看到这条记录的明细」，是权限边界的核心字段。
// amount_base_currency 在录入时就换算固化，结算时不再重新拉汇率计算，
// 避免同一笔历史消费因汇率波动在不同时间点结算出不同数字。
// 金额一律用最小货币单位（分）存整数，避免浮点误差累积。
// ---------------------------------------------------------------------------
export const expenses = sqliteTable(
  'expense',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    // 私密归属：只有这个人能看到本条记录的明细字段（金额/分类/备注/收据）
    enteredByParticipantId: text('entered_by_participant_id')
      .notNull()
      .references(() => participants.id),
    // 谁代垫了这笔钱，用于结算计算，可以和 enteredBy 不是同一人
    payerParticipantId: text('payer_participant_id')
      .notNull()
      .references(() => participants.id),
    amount: integer('amount').notNull(), // 原始币种最小货币单位
    currency: text('currency').notNull(),
    amountBaseCurrency: integer('amount_base_currency').notNull(), // trip.baseCurrency 最小货币单位，录入时固化
    fxRateUsed: real('fx_rate_used').notNull().default(1),
    fxRateSource: text('fx_rate_source', { enum: ['manual', 'fetched'] })
      .notNull()
      .default('manual'),
    category: text('category').notNull(),
    note: text('note'),
    receiptPath: text('receipt_path'),
    expenseDate: integer('expense_date', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    tripIdx: index('expense_trip_idx').on(table.tripId),
    enteredByIdx: index('expense_entered_by_idx').on(table.enteredByParticipantId),
    payerIdx: index('expense_payer_idx').on(table.payerParticipantId),
  })
);

// ---------------------------------------------------------------------------
// expense_split：一笔消费分摊给哪些人、各分多少，默认等分全部参与者。
// ---------------------------------------------------------------------------
export const expenseSplits = sqliteTable(
  'expense_split',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id),
    shareAmountBaseCurrency: integer('share_amount_base_currency').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.expenseId, table.participantId] }),
    participantIdx: index('expense_split_participant_idx').on(table.participantId),
  })
);

// ---------------------------------------------------------------------------
// payment_method：挂在 participant 身上（卡跟人走，不跟行程走）。
// 用于「这笔该用哪张卡最划算」的比价计算，费率由用户自己手动配置。
// ---------------------------------------------------------------------------
export const paymentMethods = sqliteTable(
  'payment_method',
  {
    id: id(),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['card', 'cash'] }).notNull(),
    settlementCurrency: text('settlement_currency').notNull(),
    fxMarkupPercent: real('fx_markup_percent').notNull().default(0),
    foreignTxnFeePercent: real('foreign_txn_fee_percent').notNull().default(0),
    fixedFee: integer('fixed_fee').notNull().default(0), // 最小货币单位
    cashbackPercent: real('cashback_percent').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    participantIdx: index('payment_method_participant_idx').on(table.participantId),
  })
);

// ---------------------------------------------------------------------------
// settlement_snapshot：行程被显式标记「已结算」时才写入的冻结快照。
// 平时净额结算走实时计算（见 lib/domain/settlement.ts），不落这张表，
// 只有这里的记录代表「过去某一刻算出来、之后不再变」的结果。
// ---------------------------------------------------------------------------
export const settlementSnapshots = sqliteTable(
  'settlement_snapshot',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    computedAt: integer('computed_at', { mode: 'timestamp_ms' }).notNull(),
    baseCurrency: text('base_currency').notNull(),
    // [{ fromParticipantId, toParticipantId, amountBaseCurrency }]
    resultJson: text('result_json', { mode: 'json' }).notNull(),
    createdByParticipantId: text('created_by_participant_id')
      .notNull()
      .references(() => participants.id),
  },
  (table) => ({
    tripIdx: index('settlement_snapshot_trip_idx').on(table.tripId),
  })
);

// ---------------------------------------------------------------------------
// exchange_rate_cache：每日汇率缓存，避免每次记账都打外部汇率 API。
// ---------------------------------------------------------------------------
export const exchangeRateCache = sqliteTable(
  'exchange_rate_cache',
  {
    id: id(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rate: real('rate').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
    source: text('source').notNull(),
  },
  (table) => ({
    pairIdx: uniqueIndex('exchange_rate_pair_idx').on(table.baseCurrency, table.quoteCurrency),
  })
);

// ---------------------------------------------------------------------------
// relations：只用来支持 db.query.*.findFirst({ with: {...} }) 这类关联查询的
// 便利写法，不改变上面任何一张表的实际列/约束。
// ---------------------------------------------------------------------------
export const tripsRelations = relations(trips, ({ many }) => ({
  participants: many(participants),
  invites: many(invites),
  expenses: many(expenses),
  settlementSnapshots: many(settlementSnapshots),
}));

export const participantsRelations = relations(participants, ({ one, many }) => ({
  trip: one(trips, { fields: [participants.tripId], references: [trips.id] }),
  sessions: many(sessions),
  paymentMethods: many(paymentMethods),
  enteredExpenses: many(expenses, { relationName: 'enteredBy' }),
  paidExpenses: many(expenses, { relationName: 'payer' }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  participant: one(participants, { fields: [sessions.participantId], references: [participants.id] }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  trip: one(trips, { fields: [invites.tripId], references: [trips.id] }),
  createdBy: one(participants, { fields: [invites.createdByParticipantId], references: [participants.id] }),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  trip: one(trips, { fields: [expenses.tripId], references: [trips.id] }),
  enteredBy: one(participants, {
    fields: [expenses.enteredByParticipantId],
    references: [participants.id],
    relationName: 'enteredBy',
  }),
  payer: one(participants, {
    fields: [expenses.payerParticipantId],
    references: [participants.id],
    relationName: 'payer',
  }),
  splits: many(expenseSplits),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
  expense: one(expenses, { fields: [expenseSplits.expenseId], references: [expenses.id] }),
  participant: one(participants, { fields: [expenseSplits.participantId], references: [participants.id] }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  participant: one(participants, { fields: [paymentMethods.participantId], references: [participants.id] }),
}));

export const settlementSnapshotsRelations = relations(settlementSnapshots, ({ one }) => ({
  trip: one(trips, { fields: [settlementSnapshots.tripId], references: [trips.id] }),
  createdBy: one(participants, {
    fields: [settlementSnapshots.createdByParticipantId],
    references: [participants.id],
  }),
}));
