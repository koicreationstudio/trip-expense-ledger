import { describe, it, expect } from 'vitest';
import {
  formatThousands,
  stripThousands,
  countMeaningfulCharsBefore,
  positionForMeaningfulCount,
  normalizeAmountChars,
} from './format-thousands';

describe('formatThousands / stripThousands（第六十七轮任务 H，往返一致）', () => {
  it.each([
    ['100', '100'],
    ['1000', '1,000'],
    ['12500.5', '12,500.5'],
    ['0', '0'],
    ['', ''],
    ['1234567', '1,234,567'],
  ])('formatThousands(%s) → %s，剥逗号能拿回原值', (raw, expected) => {
    const formatted = formatThousands(raw);
    expect(formatted).toBe(expected);
    expect(stripThousands(formatted)).toBe(raw);
  });

  it('小数点后面不参与分组，且刚打完"."还没接小数位也原样保留', () => {
    expect(formatThousands('1234.5')).toBe('1,234.5');
    expect(formatThousands('1234.')).toBe('1,234.');
    expect(formatThousands('1234.50')).toBe('1,234.50');
  });

  it('粘贴带逗号的数字：剥逗号能正确还原成纯数字，不是 NaN', () => {
    const pasted = '12,500';
    const stripped = stripThousands(pasted);
    expect(stripped).toBe('12500');
    expect(Number(stripped)).toBe(12500);
    expect(Number.isNaN(Number(stripped))).toBe(false);
  });

  it('三位整除的数字不多加逗号（比如刚好 100/1000 边界）', () => {
    expect(formatThousands('999')).toBe('999');
    expect(formatThousands('1000000')).toBe('1,000,000');
  });
});

describe('countMeaningfulCharsBefore / positionForMeaningfulCount（光标定位配对）', () => {
  it('逗号不计入"有意义字符"，往返换算光标位置不变', () => {
    // "1,234" 光标在 index 2（紧跟在 "1," 后面，即将输入的字符会插到 '2' 前面）
    // 之前只有 1 个有意义字符（'1'）。
    const before = countMeaningfulCharsBefore('1,234', 2);
    expect(before).toBe(1);
    // 反过来在同一个字符串里，"第 1 个有意义字符之后"应该落在 index 1（'1' 后面，
    // 逗号前面）——跟原始光标语义位置一致（逗号本身不算字符，只是视觉分隔符）。
    expect(positionForMeaningfulCount('1,234', 1)).toBe(1);
  });

  it('典型打字场景：在 "1,234" 中间插入一位数字，光标落在语义正确的位置', () => {
    // 用户在旧值 "1,234" 的 index 2 处（'1,' 之后）按了一下 '9'，浏览器已经把
    // 字符插入好，新的 e.target.value 是 "1,9234"，selectionStart 是 3。
    const rawAfterKeystroke = '1,9234';
    const selectionStart = 3;
    const meaningfulBefore = countMeaningfulCharsBefore(rawAfterKeystroke, selectionStart);
    expect(meaningfulBefore).toBe(2); // '1' 和 '9' 两个有意义字符

    const candidate = stripThousands(rawAfterKeystroke); // "19234"
    const reformatted = formatThousands(candidate); // "19,234"
    const newPos = positionForMeaningfulCount(reformatted, meaningfulBefore);
    // 光标应该落在刚打的 '9' 后面，也就是 "19,234" 里 index 2（紧接在 "19" 后面，
    // 逗号前面）——不是被逗号插入挤到别的地方。
    expect(newPos).toBe(2);
    expect(reformatted[newPos - 1]).toBe('9');
  });

  it('光标在末尾打字：从 "999" 打到 "9999"，光标停在新字符串末尾', () => {
    const rawAfterKeystroke = '9999';
    const selectionStart = 4;
    const meaningfulBefore = countMeaningfulCharsBefore(rawAfterKeystroke, selectionStart);
    expect(meaningfulBefore).toBe(4);

    const reformatted = formatThousands(stripThousands(rawAfterKeystroke)); // "9,999"
    const newPos = positionForMeaningfulCount(reformatted, meaningfulBefore);
    expect(newPos).toBe(reformatted.length);
  });

  it('有意义字符数超过字符串实际长度时退到末尾，不报错不越界', () => {
    expect(positionForMeaningfulCount('1,234', 99)).toBe('1,234'.length);
  });

  it('meaningfulCount 为 0 或负数时落在开头', () => {
    expect(positionForMeaningfulCount('1,234', 0)).toBe(0);
    expect(positionForMeaningfulCount('1,234', -1)).toBe(0);
  });
});

describe('全角字符归一化（第六十九轮，Mac 中文输入法打小数点被吞的 bug）', () => {
  it('normalizeAmountChars 把全角数字/句号/句点/逗号转成半角，其它字符原样保留', () => {
    expect(normalizeAmountChars('。')).toBe('.');
    expect(normalizeAmountChars('．')).toBe('.');
    expect(normalizeAmountChars('，')).toBe(',');
    expect(normalizeAmountChars('０１２３４５６７８９')).toBe('0123456789');
    expect(normalizeAmountChars('abc')).toBe('abc');
  });

  it('stripThousands 先归一化全角字符再剥逗号：全角句号/句点能正确变成半角小数点', () => {
    // 复现 Remy 报的 bug：中文输入法状态下按小数点键，实际打出来的是全角句号。
    expect(stripThousands('11051。')).toBe('11051.');
    expect(stripThousands('11051．')).toBe('11051.');
    // 剥出来的结果要能通过金额输入框那条校验正则，不能被当成非法字符吞掉。
    expect(/^\d*\.?\d*$/.test(stripThousands('11051。'))).toBe(true);
    expect(/^\d*\.?\d*$/.test(stripThousands('11051．'))).toBe(true);
  });

  it('stripThousands 处理全角数字+全角逗号+全角句号混合输入', () => {
    // "１１，０５１。５" 全部用全角字符打出的 "11,051.5"
    expect(stripThousands('１１，０５１。５')).toBe('11051.5');
  });

  it('formatThousands(stripThousands(...)) 完整往返：全角输入最终展示成正常带逗号的半角格式', () => {
    const candidate = stripThousands('11051。5');
    expect(formatThousands(candidate)).toBe('11,051.5');
  });

  it('countMeaningfulCharsBefore 认识全角数字/句号，不会把它们当成"不算数"的字符', () => {
    // 模拟用户在 "11051" 后面用输入法打了一个全角句号，浏览器 value 变成 "11051。"，
    // 光标停在句号后面（index 6）。归一化前如果只认半角 '.'，这个位置会被漏数。
    const rawAfterKeystroke = '11051。';
    const meaningfulBefore = countMeaningfulCharsBefore(rawAfterKeystroke, rawAfterKeystroke.length);
    expect(meaningfulBefore).toBe(6); // '1','1','0','5','1','。'(算作小数点) 共 6 个
  });
});
