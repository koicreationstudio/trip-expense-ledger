import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RECEIPTS_DIR = process.env.RECEIPTS_DIR ?? './data/receipts';

/**
 * 收据图片按 participant 分目录存放：
 * data/receipts/<participantId>/<随机文件名>.<ext>
 *
 * 用 participantId 分目录只是方便人工排查磁盘占用，
 * 真正的读取权限校验必须在 API 层查 DB（entered_by_participant_id）完成，
 * 不能假设"路径里带着谁的 id"本身就是权限凭证。
 */
export async function saveReceipt(participantId: string, fileExtension: string, data: Buffer): Promise<string> {
  const dir = path.join(RECEIPTS_DIR, participantId);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}${fileExtension}`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, data);

  return path.join(participantId, filename);
}

export async function readReceipt(relativePath: string): Promise<Buffer> {
  return fs.readFile(path.join(RECEIPTS_DIR, relativePath));
}

export async function deleteReceipt(relativePath: string): Promise<void> {
  await fs.rm(path.join(RECEIPTS_DIR, relativePath), { force: true });
}
