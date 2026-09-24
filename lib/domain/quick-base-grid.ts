/**
 * 汇率比价卡顶部"基准换算小卡"（`1 MYR = ... ฿` 那排）的网格列数——第六十六轮
 * bug G。拆成纯函数放这里是这个项目一贯的做法（跟 `deriveMidRate`/
 * `fx-compare-defaults.ts` 同一个理由），方便单独写单测，不用挂组件渲染才能测。
 *
 * 背景：原来容器是 `flex flex-wrap` + 每张卡 `flex-1`（撑满剩余空间），4 张卡
 * 挤不进一整行时，单独落在第二行的最后一张会被 `flex-1` 拉伸成占满整行宽度，
 * 跟上面几张明显不对称。改成 CSS Grid——同一个 grid 的列宽由"总列数"决定，
 * 不受某一行实际放了几张卡影响，天然不会出现"这一行只有一张就把它撑满"的问题。
 *
 * 列数按实际会渲染出几张卡（不是候选池固定长度）动态选。Tailwind JIT 不认
 * 运行时拼出来的 class 名（比如 `grid-cols-${n}`），每种列数必须是完整字面量
 * 分支，不能用模板字符串插值——这也是为什么这里用 if/return 逐条列举，不是
 * 拼字符串。
 */
export function quickBaseGridClassName(count: number): string {
  if (count <= 1) return 'grid grid-cols-1 gap-[6px]';
  if (count === 2) return 'grid grid-cols-2 gap-[6px]';
  if (count === 3) return 'grid grid-cols-3 gap-[6px]';
  if (count === 4) return 'grid grid-cols-2 gap-[6px] sm:grid-cols-4';
  // 5 张以上（当前 `QUICK_BASE_CARD_CURRENCIES` 长度固定是 4，正常走不到这条，
  // 留着是给以后候选池扩容时兜底）：固定列宽自然换行，用 auto-fill（不是
  // auto-fit）——最后一行没坐满的空位留白，不会被已有卡片拉伸去补满。
  return 'grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-[6px]';
}
