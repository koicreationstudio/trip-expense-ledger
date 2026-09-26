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
  // 2026-09-13 落地第四轮拍板：可选的行程起止日期，首页"我的行程"卡片和新建行程表单都要用。
  // 建库时没有这两个字段的老行程留 null，首页那一行日期显示就直接不渲染，不强行补录。
  tripStartDate: integer('trip_start_date', { mode: 'timestamp_ms' }),
  tripEndDate: integer('trip_end_date', { mode: 'timestamp_ms' }),
  // 这个行程同时启用哪些币种（多选），JSON 字符串数组。这一项是 lifeos-pm 自己判断的方向，
  // Artifact 里明确标注还没真正拍板（开放问题②），先落地但刻意收敛在"新建行程表单+这一个
  // 字段"，不散播式地耦合进记账/钱包等其它地方，方便日后改回单一下拉。可以为 null（老行程/
  // 还没设置），此时视为"不做币种收窄"。
  enabledCurrencies: text('enabled_currencies', { mode: 'json' }).$type<string[] | null>(),
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
    // 密码/PIN 找回（2026-09-23 第二次落地，round31 事故后由 Remy 本人在对话
    // 里重新确认才重做，见 lib/auth/pin-hash.ts）：hash 存储，不是明文——跟
    // 上面的 identityToken 刻意采用不同的存储哲学，原因写在 pin-hash.ts。
    // `/id/<token>` 链接机制不删，这两列只是多一条恢复路径，可以为空（没设过）。
    recoveryPinHash: text('recovery_pin_hash'),
    recoveryPinSetAt: integer('recovery_pin_set_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => ({
    emailIdx: uniqueIndex('user_email_idx').on(table.email),
    identityTokenIdx: uniqueIndex('user_identity_token_idx').on(table.identityToken),
  })
);

// ---------------------------------------------------------------------------
// recovery_attempt：/api/account/recover-pin 的限流账本。不挂在某个具体
// user 上（还没验证出是哪个账号就已经要限流了，防的正是"逐个账号试密码"
// 这种打法），按调用方 IP 的 hash 分桶——明文 IP 不落库，跟 session 表
// "cookie 只放明文 token，DB 只存 hash"是同一条隐私原则。
// 只记时间戳，不记是否成功/是哪个 IP：查询时只需要"这个桶最近 N 分钟内
// 出现过几次"，不需要更多信息，字段越少越不构成额外的隐私负担。
// ---------------------------------------------------------------------------
export const recoveryAttempts = sqliteTable(
  'recovery_attempt',
  {
    id: id(),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    ipHashIdx: index('recovery_attempt_ip_hash_idx').on(table.ipHash),
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
    // 生成邀请时可选填"这条链接是给谁的"，纯人类可读标签，不参与任何鉴权判断
    // （2026-09-13 落地第四轮拍板，屏⑥邀请管理）。
    inviteeName: text('invitee_name'),
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
    // 商家名称，纯展示用的可选备注性字段，不参与任何计算/校验（2026-09-12 新增，
    // Remy 反馈同分类下多笔消费光看分类分不清是哪一笔）。
    merchant: text('merchant'),
    note: text('note'),
    receiptPath: text('receipt_path'),
    // 这笔消费要不要计入行程主页 Hero 卡"我承担"那个主数字的分摊合计
    // （2026-09-16 新增，落地"机票/宝石消费明细"这个真功能，lifeos-pm 对业务
    // 语义的判断详见 PENDING-DECISIONS 对应章节，不是 Remy 逐字拍板的规格）。
    // 默认 false＝跟现在的行为完全一样，照常计入。true 的意思只是"这笔别算进
    // Hero 卡主数字里、单独拉一行显示"，不代表"这笔 100% 不跟别人分摊"——
    // 这笔本身仍然可以正常有 splits（比如机票/宝石里偶尔真有一笔是跟同行人
    // 分的），实际"谁欠谁多少"的结算计算完全不看这个字段，只看 splits，这个
    // 字段纯粹是 Hero 卡怎么分组显示的开关，故意不跟结算逻辑绑死，免得以后
    // 理解错了还要跟着改一遍算法。
    excludeFromSplit: integer('exclude_from_split', { mode: 'boolean' }).notNull().default(false),
    // 活动流"手动排序"模式下的顺序（2026-09-26 第七十一轮，任务⑤，Remy 明确要求
    // "拖拽支持"）。数字越小排越前，同一趟行程内不要求连续，只要求相对大小正确——
    // 拖拽落位后前端重算受影响区间的新序号一次性 PATCH 回来，不需要整趟行程的全部
    // 消费重新编号。新建消费默认给 0，落库时由 API 层追加到当前行程"手动排序"最末位
    // （查询当前最大 sortOrder + 1），不是让它天然排最前——这是这次的产品判断，
    // 理由是新记的账多半是"最近发生的事"，直觉上排在列表末尾（更早消费的后面）比
    // 突然插到最前面更符合"流水账"的心智模型，需要 Remy 确认认不认可。旧数据（这次
    // 上线前的历史消费）不会自然获得这个顺序，需要一次性回填脚本按当前展示顺序
    // （expenseDate 倒序，这是现有默认排序）赋值，见
    // `scripts/backfill-expense-sort-order.ts`。
    sortOrder: integer('sort_order').notNull().default(0),
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
// trip_payment_method_enabled：「本行程启用的支付方式」勾选状态（2026-09-15
// 落地 Artifact Version 10 第四轮拍板遗留缺口）。payment_method 是账号/participant
// 级数据、不天然挂在某一趟 trip 下（可能跨多趟行程复用），这张表只是一个纯粹的
// 关联勾选表：一行存在＝这个支付方式在这趟行程里勾了「启用」，不存在＝没勾/还没
// 决定。两边都 cascade：行程删了这份勾选没意义，支付方式删了也一样。
// 新建支付方式时（payment-methods-manager.tsx 的表单）默认对当前查看的行程插入
// 一行启用记录，呼应 Artifact 截图里新建的支付方式默认是勾选态；这张表本身不需要
// 存「未启用」这个状态，删行就是取消勾选。
// ---------------------------------------------------------------------------
export const tripPaymentMethodEnabled = sqliteTable(
  'trip_payment_method_enabled',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    paymentMethodId: text('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => ({
    tripIdx: index('trip_payment_method_enabled_trip_idx').on(table.tripId),
    pairIdx: uniqueIndex('trip_payment_method_enabled_pair_idx').on(table.tripId, table.paymentMethodId),
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
    // 「设置当前余额」这个动作最后一次发生的记录时间（2026-09-13 落地第四轮拍板，屏⑤
    // 支付方式页新增功能）：允许补录成之前的日期，不强制等于 updatedAt/now。跟
    // currentBalance 是同一次 PATCH 一起写，不单独起表。
    balanceUpdatedAt: integer('balance_updated_at', { mode: 'timestamp_ms' }),
    // fix(2026-09-24 第三十九轮，团队看板"历史现金消费回溯补算进钱包余额")：这个钱包
    // 绑定支付方式那一刻，有没有已经把"当时已存在、匹配这个支付方式+币种"的历史消费
    // 补扣过一次——只在创建钱包时（POST /api/trips/[tripId]/wallets）付带
    // `paymentMethodId` 才会触发这次一次性补算，算完立刻写这个时间戳。存在的意义是
    // 幂等：防止同一批历史消费被算两次。选择"创建时算一次、写死这个时间戳"而不是
    // "每次显示余额都重新动态算一遍"，是因为这次补算的范围有一条**永远不会变的硬
    // 边界**——「这个钱包诞生之前已经存在的消费」，这条线一旦某一刻算完，未来无论
    // 再过多久都不会有新的消费补进这条线以内（新消费只会发生在"以后"，不会倒着长回
    // "以前"），不属于"随时间推移会变得不准"那类需要动态重算的数据，写死这个时间戳
    // 反而比每次都重新扫一遍历史消费表更省、也更不容易因为"到底该不该重新算"产生
    // 新的歧义。当前 UI 只在建钱包那一刻能设置 `paymentMethodId`（没有事后重新绑定
    // 的入口），所以这个字段目前只会在 INSERT 时写一次，不会被后续 PATCH 触碰。
    historicalBackfillAppliedAt: integer('historical_backfill_applied_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (table) => ({
    tripIdx: index('wallet_trip_idx').on(table.tripId),
    participantIdx: index('wallet_participant_idx').on(table.participantId),
  })
);

// ---------------------------------------------------------------------------
// wallet_balance_history：「设置当前余额」每次落地的审计轨迹（2026-09-26 新增）。
// 只追加、不改写、不删除——每次 PATCH /wallets/[walletId] 真的带了
// `currentBalance`（=一次"设置当前余额"动作，不是单纯改名字/绑支付方式那种
// PATCH）就在写入新锚点的同一次请求里追加一条。
//
// `amount`/`effectiveDate` 记的是这次写入的新锚点（跟 `wallet.currentBalance`/
// `wallet.balanceUpdatedAt` 这次写完之后的值完全一致）。`prevAmount`/
// `prevEffectiveDate` 记改之前的锚点——如果这个钱包之前从没设置过当前余额
// （旧的"未锚定/累加"模式，`wallet.balanceUpdatedAt` 是 null），这两个字段
// 允许是 null，代表"改前从未设置过锚点"，不是"改前锚点是 0"，这条历史第一条
// 该写照写，不能因为"改前没有锚点"就整条跳过不记。
// `displayBalanceBefore`/`displayBalanceAfter` 各自是改之前/改之后，喂给
// `computeWalletDisplayBalance`（lib/domain/wallet-balance.ts）算出来的现余额，
// 不是另外发明一套算法算的——"未锚定模式"下这个函数本来就会把
// `wallet.currentBalance`（累加值）原样当现余额返回，所以即使改前从未锚定，
// `displayBalanceBefore` 也一样能算出一个有意义的数字。
// `changedByParticipantId` 存但列表渲染不显示（Remy 明确要求这轮历史列表别
// 出现"由谁设置"这种操作者文字），字段本身留着不删，以后有需要随时能读。
// ---------------------------------------------------------------------------
export const walletBalanceHistory = sqliteTable(
  'wallet_balance_history',
  {
    id: id(),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(), // 这次设置的新锚点金额，最小货币单位
    effectiveDate: integer('effective_date', { mode: 'timestamp_ms' }).notNull(), // 这次设置的新生效日
    changedByParticipantId: text('changed_by_participant_id')
      .notNull()
      .references(() => participants.id),
    // 字段名跟别的表统一叫 createdAt() 的那套 helper 生成的列名都是 `created_at`——
    // 这张表故意手写这一列（不用那个 helper），列名跟 TS 字段名一样叫 `changed_at`，
    // 免得以后直接查 D1 原始表时，看到一列 `created_at` 却装的是"这次设置发生的
    // 时间"，跟别的表里 `created_at` 表示"这一行本身何时被创建"的语义混在一起。
    changedAt: integer('changed_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    prevAmount: integer('prev_amount'), // 改前锚点金额；改前从未设置过锚点时为 null
    prevEffectiveDate: integer('prev_effective_date', { mode: 'timestamp_ms' }), // 改前生效日；同上可为 null
    displayBalanceBefore: integer('display_balance_before').notNull(),
    displayBalanceAfter: integer('display_balance_after').notNull(),
  },
  (table) => ({
    walletIdx: index('wallet_balance_history_wallet_idx').on(table.walletId),
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
// settlement_confirmation：结算页"转账清单"里某一笔（from→to）是否已被标记
// "已收款"，2026-09-13 落地第四轮拍板（屏④按笔勾选收款）。行存在=已确认，不存在=
// 未确认，不用一个 boolean 列表示——这样"取消勾选"就是删这一行，逻辑更直接。
// 只锚定 (tripId, from, to) 这一对参与者，不锚定金额：如果这期间又有新消费改变了
// 这笔转账的实际金额，已确认状态不会自动失效——这是刻意简化，已在
// PENDING-DECISIONS 里写明，之后如果 Remy 觉得需要按金额也锚定再加。
// 只有 toParticipantId 本人（收钱的人）能确认/取消确认自己收到的这笔钱，
// API 层校验，不能由付钱方替对方标记。
// ---------------------------------------------------------------------------
export const settlementConfirmations = sqliteTable(
  'settlement_confirmation',
  {
    id: id(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromParticipantId: text('from_participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    toParticipantId: text('to_participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    tripIdx: index('settlement_confirmation_trip_idx').on(table.tripId),
    pairIdx: uniqueIndex('settlement_confirmation_pair_idx').on(
      table.tripId,
      table.fromParticipantId,
      table.toParticipantId
    ),
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
// fx_compare_preference：汇率比价卡片（fx-compare-card.tsx）"我持有/目标币种/
// 自选比较项/兑换金额"这组选项，之前只活在组件的纯 useState 里，刷新页面就丢——
// 2026-09-24 Remy 明确要求"按账号×行程记住，换设备也要能恢复"，本地存储只能做
// 即时响应的乐观更新，真相源必须落 D1 才能手机电脑同步。owner 归属沿用
// payment_method 同一套双轨模式（见 payment-method-scope.ts 顶部注释）：有账号
// 挂 user_id，没账号的访客退回 participant_id，只在这趟行程内有效——这张表存的
// 就是"这个人在这趟行程下"的偏好，天然带 trip_id，不需要跨行程共用。
// ---------------------------------------------------------------------------
export const fxComparePreferences = sqliteTable(
  'fx_compare_preference',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').references(() => participants.id, { onDelete: 'cascade' }),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    holdCurrency: text('hold_currency').notNull(),
    targetCurrency: text('target_currency').notNull(),
    // channel:<key> / card:<paymentMethodId> 统一命名空间，跟 fx-compare-card.tsx
    // 里 `enabledCompareKeys` 这个 Set 的元素形状完全一致，JSON 字符串数组存储。
    // 值失效（渠道下架/卡被删）时前端渲染本来就会自然过滤掉，不需要这张表自己
    // 做级联清理。
    enabledCompareKeys: text('enabled_compare_keys', { mode: 'json' }).notNull().$type<string[]>(),
    amountCents: integer('amount_cents').notNull(), // 最小货币单位，holdCurrency 下的金额
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    // 两个 unique index 分别只约束各自那一栏非空的行——SQLite 里 NULL 在 unique
    // index 里互相不算重复，所以"有账号"和"访客"两条轨道不会互相打架，跟
    // payment_method 那边默契一致，不需要额外的 partial index 语法。
    userTripIdx: uniqueIndex('fx_compare_preference_user_trip_idx').on(table.userId, table.tripId),
    participantTripIdx: uniqueIndex('fx_compare_preference_participant_trip_idx').on(
      table.participantId,
      table.tripId
    ),
  })
);

// ---------------------------------------------------------------------------
// expense_list_filter_preference：活动流（expense-list.tsx）的排序模式 + 4 个
// 筛选条件，2026-09-26 第七十一轮任务⑥新增——之前这组选项也是纯 useState，刷新
// 页面/换设备就丢。跟 fx_compare_preference 同一套双轨 owner 归属（有账号按
// user_id，访客按 participant_id）、同一套"只在真实交互时才 PUT"防护
// （hasUserInteractedRef + 内容比对双保险，见 expense-list.tsx 和
// lib/domain/expense-list-preference-diff.ts）。
//
// sortMode 也算进这张偏好表（不是只存 4 个筛选条件）——排序模式同样是"用户这次
// 想怎么看这份流水账"的一部分，没有理由只记筛选不记排序，这是这次的产品判断，
// 需要 Remy 确认认不认可。
// ---------------------------------------------------------------------------
export const expenseListPreferences = sqliteTable(
  'expense_list_filter_preference',
  {
    id: id(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').references(() => participants.id, { onDelete: 'cascade' }),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    sortMode: text('sort_mode', { enum: ['manual', 'date', 'amount'] })
      .notNull()
      .default('manual'),
    // 4 个筛选条件的当前值——'ALL' 是这个项目里"不筛选/全部"的既定字面量
    // （expense-list.tsx 里的 ALL 常量），原样存字符串，不是布尔开关，值失效
    // （比如筛的那个人被移出了行程）时前端渲染自然过滤/退回 ALL，这个表自己
    // 不做级联清理，跟 fx_compare_preference 的既有取舍一致。
    categoryFilter: text('category_filter').notNull().default('ALL'),
    payerFilter: text('payer_filter').notNull().default('ALL'),
    dateFilter: text('date_filter').notNull().default('ALL'),
    paymentMethodFilter: text('payment_method_filter').notNull().default('ALL'),
    // 第七十二轮任务④新增：「计分摊/不计分摊」筛选，值域固定 'ALL' | 'included' | 'excluded'
    // （不像上面几个是"当前数据里取 distinct 值"的动态候选，这个是写死的 3 档）。
    splitFilter: text('split_filter').notNull().default('ALL'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    userTripIdx: uniqueIndex('expense_list_filter_preference_user_trip_idx').on(table.userId, table.tripId),
    participantTripIdx: uniqueIndex('expense_list_filter_preference_participant_trip_idx').on(
      table.participantId,
      table.tripId
    ),
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
  settlementConfirmations: many(settlementConfirmations),
}));

export const settlementConfirmationsRelations = relations(settlementConfirmations, ({ one }) => ({
  trip: one(trips, { fields: [settlementConfirmations.tripId], references: [trips.id] }),
  fromParticipant: one(participants, {
    fields: [settlementConfirmations.fromParticipantId],
    references: [participants.id],
    relationName: 'confirmFrom',
  }),
  toParticipant: one(participants, {
    fields: [settlementConfirmations.toParticipantId],
    references: [participants.id],
    relationName: 'confirmTo',
  }),
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
  tripEnablements: many(tripPaymentMethodEnabled),
}));

export const tripPaymentMethodEnabledRelations = relations(tripPaymentMethodEnabled, ({ one }) => ({
  trip: one(trips, { fields: [tripPaymentMethodEnabled.tripId], references: [trips.id] }),
  paymentMethod: one(paymentMethods, {
    fields: [tripPaymentMethodEnabled.paymentMethodId],
    references: [paymentMethods.id],
  }),
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  trip: one(trips, { fields: [wallets.tripId], references: [trips.id] }),
  participant: one(participants, { fields: [wallets.participantId], references: [participants.id] }),
  paymentMethod: one(paymentMethods, { fields: [wallets.paymentMethodId], references: [paymentMethods.id] }),
  exchangeRecordsFrom: many(exchangeRecords, { relationName: 'fromWallet' }),
  exchangeRecordsTo: many(exchangeRecords, { relationName: 'toWallet' }),
  balanceHistory: many(walletBalanceHistory),
}));

export const walletBalanceHistoryRelations = relations(walletBalanceHistory, ({ one }) => ({
  wallet: one(wallets, { fields: [walletBalanceHistory.walletId], references: [wallets.id] }),
  changedBy: one(participants, { fields: [walletBalanceHistory.changedByParticipantId], references: [participants.id] }),
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
