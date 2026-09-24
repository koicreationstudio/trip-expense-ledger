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
      // fix(2026-09-24 第五十八轮，Remy 截图反馈)：成功提示原本一直挂在按钮上方不消失，
      // 位置孤立看不出跟"刚才点了那下"有关系。这轮改成跟 AccountIdentityLink 的
      // copied 状态同款——挪到按钮正下方 + 2 秒后自动消失，让它看起来是"这次点击
      // 的短暂反馈"而不是长期挂着的静态文字。
      setSuccess(hasPinSet ? '已更新' : '已设置');
      setTimeout(() => setSuccess(null), 2000);
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
    setTimeout(() => setSuccess(null), 2000);
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
          autoComplete="new-password"
          className="field-input"
          placeholder="至少 4 位"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(null);
          }}
        />
        {/* fix(2026-09-24 第五十八轮)：只加引导文案，不改 MIN_PIN_LENGTH=4 这个最短长度
            限制——4 位数字全库比对只有 1 万种组合，改最短长度会影响已经设过 4 位 PIN
            的人，是否要强制升级是产品决策不是这轮范围，留给 Remy 定。 */}
        <p className="text-[10px] text-muted">建议设 6 位以上数字，或者用一串好记的短密码，比 4 位数字更安全。</p>
        <label htmlFor="set-pin-confirm-input" className="field-label">
          再输一次确认
        </label>
        <input
          id="set-pin-confirm-input"
          type="password"
          autoComplete="new-password"
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
      {/* fix(2026-09-24 第五十八轮，ui-auditor 真机走查抓到)：原本只判断 !pin，
          只填了第一个框、确认框还是空的时候按钮就已经解锁，给"可以提交了"的
          误导信号（点了还是会被 pin!==confirmPin 的校验拦下，不是数据风险，
          纯粹是 disabled 态这个视觉信号不准）。两个框都有内容才解锁。 */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !pin || !confirmPin}
        className="btn-secondary disabled:cursor-not-allowed"
      >
        {saving ? '保存中…' : hasPinSet ? '更新密码/PIN' : '设置密码/PIN'}
      </button>
      {/* fix(2026-09-24 第五十八轮)：跟按钮直接挂钩的短暂反馈，2 秒后自动消失（见
          handleSave/handleClear 里的 setTimeout），不再是长期挂着的静态文字。 */}
      {success && (
        <p className="text-[10px] font-medium text-ok" role="status">
          ✓ {success}
        </p>
      )}
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
