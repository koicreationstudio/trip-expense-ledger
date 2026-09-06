'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleClick() {
    setSubmitting(true);
    try {
      await fetch('/api/account/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={submitting}
      className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-50"
    >
      {submitting ? '退出中…' : '退出登录'}
    </button>
  );
}
