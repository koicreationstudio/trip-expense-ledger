'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MIN_RECOVERY_PIN_LENGTH, validateRecoveryPin } from '@/lib/domain/recovery-pin';

/**
 * 密码/PIN 找回口令的设置表单——身份直连链接之外第二条恢复路径。跟链接不是
 * 二选一，这里存了之后链接还是照样能用（不影响、不覆盖）。
 */
export function SetPinForm({ setAtLabel }: { setAtLabel: string | null }) {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSavedJustNow(false);
    const validation = validateRecoveryPin(pin);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    if (pin !== confirmPin) {
      setError('两次输入不一致，再确认一下');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/account/set-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? '保存失败，刷新页面再试一次');
        return;
      }
      setPin('');
      setConfirmPin('');
      setSavedJustNow(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div>
        <p className="text-[10.5px] font-semibold text-ink">密码/PIN 找回</p>
        <p className="mt-1 text-[10px] text-muted">
          {setAtLabel
            ? `已设置（${setAtLabel}）。以后 cookie 丢了、忘了保存身份链接，也能直接用这个密码找回，不用翻链接。下面可以改成新的。`
            : '身份链接之外多一条找回路，设一个自己记得住的密码/PIN，以后忘了保存链接也能找回。'}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="pin-input" className="field-label">
          {setAtLabel ? '新密码/PIN' : '密码/PIN'}
        </label>
        <input
          id="pin-input"
          type="password"
          className="field-input"
          placeholder={`至少 ${MIN_RECOVERY_PIN_LENGTH} 位`}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(null);
          }}
        />
        <label htmlFor="pin-confirm-input" className="field-label">
          再输一次确认
        </label>
        <input
          id="pin-confirm-input"
          type="password"
          className="field-input"
          value={confirmPin}
          onChange={(e) => {
            setConfirmPin(e.target.value);
            setError(null);
          }}
        />
      </div>
      {error && <p className="text-[10px] text-coral">{error}</p>}
      {savedJustNow && !error && <p className="text-[10px] text-muted">已保存。</p>}
      <button type="button" onClick={handleSubmit} disabled={saving} className="btn-secondary self-start">
        {saving ? '保存中…' : setAtLabel ? '改成新密码' : '设置'}
      </button>
    </section>
  );
}
