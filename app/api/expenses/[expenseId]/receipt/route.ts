import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, type Db } from '@/lib/db/client';
import { expenses } from '@/lib/db/schema';
import { withSession } from '@/lib/auth/require-session';
import { deleteReceipt, readReceipt, saveReceipt } from '@/lib/storage/receipts';

interface Context {
  params: { expenseId: string };
}

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * 收据只属于录入者本人，查询条件直接把 enteredByParticipantId 焊死在 WHERE 里，
 * 跟其它 expense 接口的权限模型完全一致：不是自己的一律当不存在。
 */
async function loadOwnExpense(db: Db, expenseId: string, participantId: string) {
  return db.query.expenses.findFirst({
    where: and(eq(expenses.id, expenseId), eq(expenses.enteredByParticipantId, participantId)),
  });
}

export const POST = withSession<Context>(async (request, { params }, identity) => {
  const db = await getDb();
  const expense = await loadOwnExpense(db, params.expenseId, identity.participantId);
  if (!expense) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 });
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 400 });
  }

  const extension = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: 'unsupported_file_type' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const relativePath = await saveReceipt(identity.participantId, extension, buffer);

  if (expense.receiptPath) {
    await deleteReceipt(expense.receiptPath);
  }

  await db
    .update(expenses)
    .set({ receiptPath: relativePath, updatedAt: new Date() })
    .where(eq(expenses.id, params.expenseId));

  return NextResponse.json({ ok: true });
});

export const GET = withSession<Context>(async (_request, { params }, identity) => {
  const db = await getDb();
  const expense = await loadOwnExpense(db, params.expenseId, identity.participantId);
  if (!expense || !expense.receiptPath) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const buffer = await readReceipt(expense.receiptPath);
  const extension = path.extname(expense.receiptPath);

  return new NextResponse(buffer, {
    headers: { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' },
  });
});

export const DELETE = withSession<Context>(async (_request, { params }, identity) => {
  const db = await getDb();
  const expense = await loadOwnExpense(db, params.expenseId, identity.participantId);
  if (!expense || !expense.receiptPath) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await deleteReceipt(expense.receiptPath);
  await db.update(expenses).set({ receiptPath: null, updatedAt: new Date() }).where(eq(expenses.id, params.expenseId));

  return new NextResponse(null, { status: 204 });
});
