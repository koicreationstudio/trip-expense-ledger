import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { lookupInvite } from '@/lib/auth/invite';

interface Context {
  params: { code: string };
}

/** 公开接口，不需要登录：这就是同行人拿到链接后第一步要能看到的东西。 */
export async function GET(_request: NextRequest, { params }: Context) {
  const db = await getDb();
  const result = await lookupInvite(db, params.code);

  if (result.status !== 'ok') {
    return NextResponse.json({ status: result.status }, { status: 404 });
  }

  return NextResponse.json({ status: 'ok', invite: result.view });
}
