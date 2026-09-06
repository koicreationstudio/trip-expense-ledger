import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDbPath: string;
let getHandler: typeof import('./route').GET;

beforeAll(async () => {
  tmpDbPath = path.join(os.tmpdir(), `tel-health-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  process.env.DATABASE_PATH = tmpDbPath;

  await import('@/lib/db/client');
  ({ GET: getHandler } = await import('./route'));
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${tmpDbPath}${suffix}`, { force: true });
  }
});

describe('GET /api/health', () => {
  it('DB 能查询就返回 200 ok:true', async () => {
    const res = await getHandler();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
