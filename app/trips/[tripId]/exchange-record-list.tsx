import { formatMoney } from '@/lib/money';

export interface ExchangeRecordItem {
  id: string;
  fromLabel: string | null;
  toLabel: string;
  fromAmount: number | null;
  toAmount: number;
  fromCurrency: string;
  toCurrency: string;
  exchangeDate: string; // ISO
  note: string | null;
}

/** 隐含汇率 = toAmount / fromAmount，现算不存值，避免展示值跟金额本身对不上。 */
function impliedRateLabel(item: ExchangeRecordItem): string | null {
  if (item.fromAmount === null || item.fromAmount === 0) return null;
  const rate = item.toAmount / item.fromAmount;
  return `1 ${item.fromCurrency} ≈ ${rate.toFixed(4)} ${item.toCurrency}`;
}

export function ExchangeRecordList({ records }: { records: ExchangeRecordItem[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-muted">还没有换汇记录，点上面「取款 / 换汇」开始记。</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {records.map((r) => {
        const rateLabel = impliedRateLabel(r);
        return (
          <li key={r.id} className="tx-item">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-lt text-sm"
              aria-hidden="true"
            >
              🔁
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[12.5px] font-medium">
                {r.fromLabel ?? '充值'} → {r.toLabel}
              </span>
              <span className="mt-0.5 truncate border-t border-dashed border-sand pt-0.5 text-[10px] text-muted">
                {rateLabel ?? r.exchangeDate.slice(5, 10)}
                {r.note && ` · ${r.note}`}
              </span>
            </div>
            <span className="shrink-0 font-serif text-[12.5px] font-medium tabular-nums">
              {formatMoney(r.toAmount, r.toCurrency)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
