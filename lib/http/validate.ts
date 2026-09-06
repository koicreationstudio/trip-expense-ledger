import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';

export type ParsedBody<T> = { data: T } | { error: NextResponse };

/**
 * 统一的请求体校验入口：JSON 解析失败或 zod 校验不过都直接给出 400，
 * 调用方只需要判断 'error' in result 就知道能不能往下走，不用各自重复 try/catch。
 *
 * 类型上把 schema 的 Input 显式钉死成 unknown（而不是让它跟着 T 默认相等）：
 * 请求体解析出来的本来就是 unknown，钉死后 T 只会从 zod 的 Output 推断，
 * 不会因为某个字段带 .default() 导致 Input/Output 不一致时被推成"可能 undefined"。
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T, ZodTypeDef, unknown>
): Promise<ParsedBody<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { error: NextResponse.json({ error: 'invalid_json' }, { status: 400 }) };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      error: NextResponse.json({ error: 'validation_failed', issues: result.error.issues }, { status: 400 }),
    };
  }

  return { data: result.data };
}
