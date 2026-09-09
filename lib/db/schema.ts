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
// user：Layer 2 账号系统，只负责「记住这个人建过/认领过哪些行程」，
// 完全不参与 Layer 1（session/participant）的任何权限判断。
// 2026-09-09 第十六轮登录系统换血：邮箱密码登录砍掉，改成明文存储的专属身份
// 链接（identity_token，形如 invite.code 那种不可猜测随机 token，直接明文存，
// 不哈希——这条链接本身就是凭证）。email/password_hash 两列保留物理字段(旧
// 数据不丢)但代码从此不再读写，允许为空；新建号一律走 identity_token 这条路。
// ---------------------------------------------------------------------------
export const users = sqliteTable(
  'user',
  {
    id: id(),
    // 已废弃：邮箱密码登录砍掉后不再写入，只读旧数据用，允许为空
    email: text('email'),
    // 已废弃：同上
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    // 专属身份直连链接的 token，明文存储（同 invites.code 的存储哲学），
    // 32 字节随机数 base64url 编码，出现在 /id/[token] 这个 URL 里。
    identityToken: text('identity_token'),
    createdAt: createdAt(),
  },
  (table) => ({
    emailIdx: uniqueIndex('user_email_idx').on(table.email),
    identityTokenIdx: uniqueIndex('user_identity_token_idx').on(table.identityToken),
  })
);

// ---------------------------------------------------------------------------
// participant：trip 下的一个身份占位/成员，未被邀请链接认领时 claimedAt 为 null。
// userId 是 Layer 2（账号系统）打通 Layer 1（session/participant）的唯一桥梁，
// 可空——不是每个 participant 都绑了账号，同行人 guest 认领照旧不需要。
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
    // 账号没了不该连带删掉行程数据，只是这个 participant 不再关联任何账号
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => ({
    tripIdx: index('participant_trip_idx').on(table.tripId),
    userIdx: index('participant_user_idx').on(table.userId),
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
// user_session：Layer 2 账号登录态，形状完全照抄 session（Layer 1）。
// cookie 里只放明文 token，DB 只存 hash。跟 session 表相互独立，
// 一个人可以同时有一个 user_session（记账号）+ 若干 session（当前激活的 trip 身份）。
// ---------------------------------------------------------------------------
export const userSessions = sqliteTable(
  'user_session',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('user_session_token_hash_idx').on(table.tokenHash),
    userIdx: index('user_session_user_idx').on(table.userId),
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
    // 用户在比价卡片里实际选定使用的支付方式，可空（不比价/不选也能记账）。
    // 只用于「记账时钱包自动扣减」这一件事，不影响结算计算。
    paymentMethodId: text('payment_method_id').references(() => paymentMethods.id, { onDelete: 'set null' }),
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
// payment_method：双轨归属。有账号的人（userId 非空）挂 user_id，跨行程终身
// 可见——建过账号的人不用每趟行程重填一次。guest（认领链接进来、没注册账号）
// 没有跨行程身份可以挂，退回 participant_id，只在这一趟行程内有效，这是
// 现实限制不是缺陷。两个外键都可空，读写时该用哪个由
// lib/domain/payment-method-scope.ts 的 chokepoint helper 统一判断，
// 不要在业务代码里重新写一遍「有 userId 就……否则……」。
// 用于「这笔该用哪张卡最划算」的比价计算，费率由用户自己手动配置。
// ---------------------------------------------------------------------------
export const paymentMethods = sqliteTable(
  'payment_method',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').references(() => participants.id, { onDelete: 'cascade' }),
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
    userIdx: index('payment_method_user_idx').on(table.userId),
    participantIdx: index('payment_method_participant_idx').on(table.participantId),
  })
);

// ---------------------------------------------------------------------------
// wallet：挂在「某个人在某趟行程下」的现金/账户余额追踪，私有——只有
// participant_id 对应的那个人自己能查自己的钱包，查询边界跟 expense 的
// entered_by_participant_id 同一套规矩：硬编码 WHERE，不接受客户端传参覆盖。
// 挂在 trip 而不是全局：每趟行程各自记自己的钱包余额，不做跨行程结转，
// 这是「按行程归属」目前最简单可靠的实现方式。
// ---------------------------------------------------------------------------
export const wallets = sqliteTable(
  'wallet',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    currency: text('currency').notNull(),
    emoji: text('emoji').notNull().default('💰'),
    currentBalance: integer('current_balance').notNull().default(0), // 最小货币单位
    // 可选关联到自己配置的支付方式，用于「记账选中这个支付方式时自动扣这个钱包」。
    paymentMethodId: text('payment_method_id').references(() => paymentMethods.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => ({
    tripIdx: index('wallet_trip_idx').on(table.tripId),
    participantIdx: index('wallet_participant_idx').on(table.participantId),
  })
);

// ---------------------------------------------------------------------------
// exchange_record：一笔换汇/充值记录，私有规矩同 wallet。fromWalletId 为空
// 代表「纯充值，没有可追踪的来源钱包」（比如带的实体现金第一次登记）。
// 隐含汇率 = toAmount / fromAmount，故意不额外存 rate 字段——展示时现算，
// 避免存储值跟金额本身算出来的不一致（同一条教训见 expense 表不重复存派生值）。
// ---------------------------------------------------------------------------
export const exchangeRecords = sqliteTable(
  'exchange_record',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    fromWalletId: text('from_wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
    toWalletId: text('to_wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    fromAmount: integer('from_amount'), // fromWalletId 币种最小单位，无来源时为 null
    toAmount: integer('to_amount').notNull(), // toWalletId 币种最小单位
    exchangeDate: integer('exchange_date', { mode: 'timestamp_ms' }).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => ({
    tripIdx: index('exchange_record_trip_idx').on(table.tripId),
    participantIdx: index('exchange_record_participant_idx').on(table.participantId),
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
  wallets: many(wallets),
  exchangeRecords: many(exchangeRecords),
}));

export const participantsRelations = relations(participants, ({ one, many }) => ({
  trip: one(trips, { fields: [participants.tripId], references: [trips.id] }),
  user: one(users, { fields: [participants.userId], references: [users.id] }),
  sessions: many(sessions),
  paymentMethods: many(paymentMethods),
  enteredExpenses: many(expenses, { relationName: 'enteredBy' }),
  paidExpenses: many(expenses, { relationName: 'payer' }),
  wallets: many(wallets),
  exchangeRecords: many(exchangeRecords),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  participant: one(participants, { fields: [sessions.participantId], references: [participants.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  participants: many(participants),
  userSessions: many(userSessions),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
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
  paymentMethod: one(paymentMethods, {
    fields: [expenses.paymentMethodId],
    references: [paymentMethods.id],
  }),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
  expense: one(expenses, { fields: [expenseSplits.expenseId], references: [expenses.id] }),
  participant: one(participants, { fields: [expenseSplits.participantId], references: [participants.id] }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one, many }) => ({
  user: one(users, { fields: [paymentMethods.userId], references: [users.id] }),
  participant: one(participants, { fields: [paymentMethods.participantId], references: [participants.id] }),
  wallets: many(wallets),
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  trip: one(trips, { fields: [wallets.tripId], references: [trips.id] }),
  participant: one(participants, { fields: [wallets.participantId], references: [participants.id] }),
  paymentMethod: one(paymentMethods, { fields: [wallets.paymentMethodId], references: [paymentMethods.id] }),
  exchangeRecordsFrom: many(exchangeRecords, { relationName: 'fromWallet' }),
  exchangeRecordsTo: many(exchangeRecords, { relationName: 'toWallet' }),
}));

export const exchangeRecordsRelations = relations(exchangeRecords, ({ one }) => ({
  trip: one(trips, { fields: [exchangeRecords.tripId], references: [trips.id] }),
  participant: one(participants, { fields: [exchangeRecords.participantId], references: [participants.id] }),
  fromWallet: one(wallets, {
    fields: [exchangeRecords.fromWalletId],
    references: [wallets.id],
    relationName: 'fromWallet',
  }),
  toWallet: one(wallets, {
    fields: [exchangeRecords.toWalletId],
    references: [wallets.id],
    relationName: 'toWallet',
  }),
}));

export const settlementSnapshotsRelations = relations(settlementSnapshots, ({ one }) => ({
  trip: one(trips, { fields: [settlementSnapshots.tripId], references: [trips.id] }),
  createdBy: one(participants, {
    fields: [settlementSnapshots.createdByParticipantId],
    references: [participants.id],
  }),
}));
