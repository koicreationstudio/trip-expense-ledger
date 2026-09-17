/**
 * 圆形头像占位符：取姓名首字（大写），用于参与者列表/活动流/结算转账清单
 * 三处复用同一套视觉语言，不各自发明。项目目前不存图片头像，纯文字占位够用。
 */
// fix(2026-09-17 第二十轮，Remy 要求逐 CSS token 核对结算屏)：Artifact 里两个
// 已知真实数据点——基础 `.avatar{width:22px;font-size:10.5px}`、结算屏 scoped
// `#scr-settlement .avatar{width:18px;font-size:9px}`——原来这里用的是
// `size*0.4` 这个比例，22px 算出来是 8.8px（该是 10.5px）、18px 算出来是 7.2px
// （该是 9px），两个尺寸都偏小快 2px，不是四舍五入误差。用这两个真实数据点
// 拟合出一条直线 `font = 0.375*size + 2.25`，代进去正好精确对上这两个已知值
// （不是凑巧微调 0.4 这个系数，是真的解出跟方案吻合的公式）。
function avatarFontSize(size: number): number {
  return Math.round((0.375 * size + 2.25) * 10) / 10;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-circle font-medium text-ink"
      style={{ width: size, height: size, fontSize: avatarFontSize(size) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
