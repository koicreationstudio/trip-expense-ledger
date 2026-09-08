import { cookies } from 'next/headers';
import { getDb } from '../db/client';
import { resolveIdentity, SESSION_COOKIE_NAME } from './session';
import type { AuthenticatedIdentity } from './session';

/** Server component 专用：从请求 cookie 读当前登录身份，查不到返回 null。 */
export async function getCurrentIdentity(): Promise<AuthenticatedIdentity | null> {
  const db = await getDb();
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  return resolveIdentity(db, token);
}
