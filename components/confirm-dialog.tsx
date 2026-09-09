'use client';

/**
 * 替代浏览器原生 confirm() 的确认弹窗，样式跟整站容器规格对齐
 * （rounded-xl/border-sand/bg-paper/shadow-card，跟 tx-item 等卡片同一套 token，
 * 不引入新色值）。danger 变体用 coral（跟 invites-manager 撤销链接同一个
 * "非财务破坏性动作"语义色），非 danger 用 accent-700（跟 btn-primary 一致）。
 */
export function ConfirmDialog({
  open,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  variant = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      role="alertdialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-sand bg-paper p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[12.5px] text-ink">{message}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-[14px] text-[12.5px] font-medium text-white transition-colors disabled:opacity-50 ${
              variant === 'danger' ? 'bg-coral hover:opacity-90' : 'bg-accent-700 hover:bg-accent-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
