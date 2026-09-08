import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * 收据图片按 participant 分 key 前缀存放：
 * <participantId>/<随机文件名>.<ext>
 *
 * 用 participantId 分前缀只是方便人工排查用量，真正的读取权限校验必须在
 * API 层查 DB（entered_by_participant_id）完成，不能假设"key 里带着谁的 id"
 * 本身就是权限凭证。
 */
export async function saveReceipt(participantId: string, fileExtension: string, data: Buffer): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const key = `${participantId}/${crypto.randomUUID()}${fileExtension}`;
  await env.RECEIPTS.put(key, data);
  return key;
}

export async function readReceipt(relativePath: string): Promise<Buffer> {
  const { env } = await getCloudflareContext({ async: true });
  const object = await env.RECEIPTS.get(relativePath);
  if (!object) {
    throw new Error(`receipt not found: ${relativePath}`);
  }
  const arrayBuffer = await object.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteReceipt(relativePath: string): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  await env.RECEIPTS.delete(relativePath);
}
