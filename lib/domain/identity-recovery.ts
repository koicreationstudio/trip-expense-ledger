/**
 * "新设备/新浏览器/新主屏幕图标检测不到已有登录态"时的安全网第一版：
 * 别在这一刻默认直接开新账号（会把同一个人拆成好几个身份，2026-09 曼谷行程
 * 分裂成两个账号就是这么来的），先给一个"你是不是已经用过"的岔路，
 * 用户如果手头还有专属身份链接（/id/<token>），走这个纯前端函数抽出 token，
 * 直接复用现成的 /id/[token] 登录路由，不用新开一条验证逻辑。
 *
 * 之后如果接了邮箱找回（发信服务），这个岔路口还是同一个组件多加一个选项，
 * 不需要重新设计触发时机。
 */

/**
 * 从用户粘贴的内容里抠出身份 token。
 * 兼容三种粘贴形态：
 *   1. 完整 URL：https://xxx.pages.dev/id/AbC123... （甚至带多余的 query/hash）
 *   2. 只有路径：/id/AbC123...
 *   3. 裸 token：AbC123...（用户手动把链接里 /id/ 后面那段抄出来）
 * 抠不出东西（空字符串/纯空白）返回 null，调用方据此显示"链接看起来不对"。
 */
export function extractIdentityToken(pasted: string): string | null {
  const trimmed = pasted.trim();
  if (!trimmed) return null;

  // 形态 1/2：含 "/id/" 就取它后面那一段，再切掉可能带着的 query/hash/末尾斜杠。
  const marker = '/id/';
  const markerIndex = trimmed.lastIndexOf(marker);
  const afterMarker = markerIndex >= 0 ? trimmed.slice(markerIndex + marker.length) : trimmed;

  const token = afterMarker.split(/[?#]/)[0]!.replace(/\/+$/, '').trim();
  return token.length > 0 ? token : null;
}
