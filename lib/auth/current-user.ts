import { cookies } from 'next/headers';
import { db } from '../db/client';
import { resolveUser, USER_SESSION_COOKIE_NAME } from './user-session';
import type { AuthenticatedUser } from './user-session';

/** Server component 专用：从请求 cookie 读当前登录账号（Layer 2），查不到返回 null。 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = cookies().get(USER_SESSION_COOKIE_NAME)?.value;
  return resolveUser(db, token);
}
