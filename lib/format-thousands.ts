/**
 * 千分位格式化——纯展示层用途，第六十七轮任务 H。
 *
 * 唯一的真相来源永远是"不带逗号的纯数字字符串"（比如 fx-compare-card 里的
 * `amountYuan` state，会原样存进 D1、原样喂给 `Number(amountYuan)`）。这个文件
 * 只负责把那份纯数字字符串转成给 `<input value>` 用的、带千分位逗号的展示字符串，
 * 以及反过来把用户在 input 里打出来的字符串（可能已经带逗号，比如浏览器把
 * `value` 原样显示出来后用户又接着打字）剥回纯数字字符串——这两个函数必须配对
 * 使用，不能只用其中一个。
 *
 * 光标定位的两个 helper（`countMeaningfulCharsBefore` / `positionForMeaningfulCount`）
 * 是给"格式化后逗号数量变了、光标位置要跟着重算"这件事用的：先在浏览器已经原生
 * 插入这次按键之后的字符串里，数一下光标之前有几个"有意义字符"（数字或小数点，
 * 逗号不算——这个计数在加不加逗号的两种写法里语义不变），再拿这个计数去新的
 * 格式化字符串里找回同样位置。两者必须配对使用：先在旧字符串（剥逗号前）算计数，
 * 再在新字符串（格式化后）里定位，不能颠倒顺序或者只用一半。
 */

/**
 * fix(第六十九轮，全角字符吞键 bug)：Mac 中文输入法开着的时候，按小数点键实际
 * 打出来的是全角句号「。」或全角句点「．」，按数字键在某些输入法状态下也可能
 * 打出全角数字「０-９」，千分位逗号同理可能打成全角逗号「，」。这些字符原本
 * 一律通不过 `/^\d*\.?\d*$/` 校验，被当成"非法输入"整个按键静默吞掉（用户感觉
 * "打不出小数点"）。这个函数把这几类全角字符原样转换成对应的半角字符——
 * 每个字符转换后还是恰好一个字符（不会变长变短），所以可以放在
 * `stripThousands`/`countMeaningfulCharsBefore` 最前面统一做，不影响后续基于
 * 字符位置的计数和光标换算。
 */
export function normalizeAmountChars(raw: string): string {
  return raw
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[．。]/g, '.')
    .replace(/，/g, ',');
}

/**
 * 剥掉千分位逗号，拿回纯数字字符串。跟 `formatThousands` 反向配对使用。
 * 先过 `normalizeAmountChars` 把全角数字/句号/逗号转回半角，再剥逗号——
 * 这是唯一的 chokepoint，所有金额输入框的 onChange 都经过这个函数，不用
 * 逐个文件单独处理全角字符。
 */
export function stripThousands(raw: string): string {
  return normalizeAmountChars(raw).replace(/,/g, '');
}

/**
 * 纯数字字符串（可能带一个小数点）→ 带千分位逗号的展示字符串。只处理"非负数字
 * + 至多一个小数点"这个形状（这个项目里金额历来就是非负数，负数不在职责范围）。
 * 小数点后面的部分原样保留、不参与分组，即使用户刚打完一个"."还没接小数位
 * （比如 "1234."）也要原样展示，不能因为小数部分是空的就吞掉那个点，不然用户
 * 打小数点的那一下会看起来像没反应。
 */
export function formatThousands(raw: string): string {
  const stripped = stripThousands(raw);
  if (stripped === '') return '';
  const hasDot = stripped.includes('.');
  const dotIndex = stripped.indexOf('.');
  const intPart = hasDot ? stripped.slice(0, dotIndex) : stripped;
  const decimalPart = hasDot ? stripped.slice(dotIndex + 1) : '';
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return hasDot ? `${groupedInt}.${decimalPart}` : groupedInt;
}

/**
 * 数一下 `str` 里、`index` 之前（不含 index 本身那个字符）有几个"有意义字符"
 * （数字或小数点，逗号不算）。配合 `positionForMeaningfulCount` 用来在格式化
 * 前后的两个字符串之间换算光标位置——这个计数值在"有没有逗号"这两种写法里
 * 是同一个语义锚点，逗号只是展示层加的分隔符，不改变这个计数。
 */
export function countMeaningfulCharsBefore(str: string, index: number): number {
  // 先归一化全角字符再数——`str` 这里传进来的是浏览器原生 `e.target.value`，
  // 可能包含用户刚用输入法打出来的全角数字/句号，不归一化的话这些字符会被
  // `/[0-9.]/` 判定成"不算数"，导致光标位置算错。`normalizeAmountChars` 保证
  // 每个字符转换前后还是一对一（不变长），下标语义不受影响。
  const normalized = normalizeAmountChars(str);
  let count = 0;
  const end = Math.min(index, normalized.length);
  for (let i = 0; i < end; i++) {
    if (/[0-9.]/.test(normalized.charAt(i))) count++;
  }
  return count;
}

/**
 * 反过来：在字符串 `str` 里找到"第 meaningfulCount 个有意义字符之后"那个位置，
 * 给 `input.setSelectionRange` 用。找不到足够多有意义字符（比如格式化后字符串
 * 变短了）就退到字符串末尾，不会报错或返回越界位置。
 */
export function positionForMeaningfulCount(str: string, meaningfulCount: number): number {
  if (meaningfulCount <= 0) return 0;
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (/[0-9.]/.test(str.charAt(i))) {
      count++;
      if (count === meaningfulCount) return i + 1;
    }
  }
  return str.length;
}
