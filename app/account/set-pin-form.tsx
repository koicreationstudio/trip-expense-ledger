'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';

/**
 * `/account` 页面的密码/PIN 找回入口：设置/更新/清除。跟 AccountIdentityLink
 * 平级放在同一页——这条是"多一条恢复路径"，identityToken 链接才是主入口
 * （2026-09-23 第二次落地，见 lib/domain/recovery-pin.ts 顶部说明）。
 */
export function SetPinForm({ hasPinSet: initialHasPinSet }: { hasPinSet: boolean }) {
  const [hasPinSet, setHasPinSet] = useState(initialHasPinSet);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  async function handleSave() {
    setError(null);
    setSuccess(null);
    if (pin !== confirmPin) {
      setError('两次输入的不一样，检查一下');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/account/set-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!res.ok) {
        setError(body?.message ?? '设置失败，稍后再试');
        return;
      }
      setHasPinSet(true);
      setPin('');
      setConfirmPin('');
      setSuccess(hasPinSet ? '已更新' : '已设置');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setConfirmingClear(false);
    setError(null);
    setSuccess(null);
    const res = await fetch('/api/account/set-pin', { method: 'DELETE' });
    if (!res.ok) {
      setError('清除失败，稍后再试');
      return;
    }
    setHasPinSet(false);
    setSuccess('已清除');
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-sand bg-paper px-[9px] py-[9px] shadow-card">
      <p className="text-[10px] text-muted">
        {hasPinSet
          ? '已经设了一个密码/PIN，找不到身份链接时也能靠它找回账号。可以在下面改成新的。'
          : '除了上面那条身份链接，也可以设一个自己好记的密码/PIN，忘了带链接时多一条路能找回账号。'}
      </p>
      <div className="flex flex-col gap-2">
        <label htmlFor="set-pin-input" className="field-label">
          {hasPinSet ? '新密码/PIN' : '密码/PIN'}
        </label>
        <input
          id="set-pin-input"
          type="password"
          inputMode="numeric"
          className="field-input"
          placeholder="至少 4 位"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(null);
          }}
        />
        <label htmlFor="set-pin-confirm-input" className="field-label">
          再输一次确认
        </label>
        <input
          id="set-pin-confirm-input"
          type="password"
          inputMode="numeric"
          className="field-input"
          placeholder="跟上面一样"
          value={confirmPin}
          onChange={(e) => {
            setConfirmPin(e.target.value);
            setError(null);
          }}
        />
      </div>
      {error && <p className="text-[10px] text-coral">{error}</p>}
      {success && <p className="text-[10px] text-muted">{success}</p>}
      <button type="button" onClick={handleSave} disabled={saving || !pin} className="btn-secondary">
        {saving ? '保存中…' : hasPinSet ? '更新密码/PIN' : '设置密码/PIN'}
      </button>
      {hasPinSet && (
        <button type="button" onClick={() => setConfirmingClear(true)} className="self-start text-[10px] text-coral">
          清除已设置的密码/PIN
        </button>
      )}
      <ConfirmDialog
        open={confirmingClear}
        message="确定要清除吗？清除后就只能靠身份链接找回账号了。"
        confirmLabel="确定清除"
        variant="danger"
        onConfirm={handleClear}
        onCancel={() => setConfirmingClear(false)}
      />
    </section>
  );
}
