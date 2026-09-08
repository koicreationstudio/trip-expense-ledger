'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setError('这个邮箱已经注册过了，直接登录就好');
        } else {
          setError('注册失败，检查一下邮箱格式和密码长度（至少 8 位）');
        }
        return;
      }

      // 如果当前浏览器刚好带着一个 Layer 1 tel_session（比如刚认领完邀请还没登录账号），
      // 顺手把这个 participant 关联上账号。没有活跃 session 会返回 400，忽略即可。
      await fetch('/api/account/link-current-trip', { method: 'POST' }).catch(() => {});

      router.push(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-base font-semibold text-ink">注册</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="display-name">
            你的称呼
          </label>
          <input
            id="display-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例如：Remy"
            className="field-input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="email">
            邮箱
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="field-label" htmlFor="password">
            密码（至少 8 位）
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
          />
        </div>

        {error && <p className="text-base text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary"
        >
          {submitting ? '注册中…' : '注册'}
        </button>
      </form>
      <p className="text-sm text-muted">
        已经有账号？
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="tap-link ml-1">
          登录
        </Link>
      </p>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
