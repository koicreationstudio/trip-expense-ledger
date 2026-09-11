/**
 * 圆形头像占位符：取姓名首字（大写），用于参与者列表/活动流/结算转账清单
 * 三处复用同一套视觉语言，不各自发明。项目目前不存图片头像，纯文字占位够用。
 */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-circle font-medium text-ink"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
