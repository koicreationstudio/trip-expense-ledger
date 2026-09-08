import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb } from '@/lib/db/test-client';

let getHandler: typeof import('./route').GET;

beforeAll(async () => {
  await setupTestDb();
  ({ GET: getHandler } = await import('./route'));
});

afterAll(async () => {
  await teardownTestDb();
});

describe('GET /api/health', () => {
  it('DB 能查询就返回 200 ok:true', async () => {
    const res = await getHandler();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });
});
