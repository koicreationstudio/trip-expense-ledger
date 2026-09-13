import { redirect } from 'next/navigation';

/**
 * 取款/换汇不再是独立页面——2026-09-13 第四轮拍板"真正合并进钱包卡内部"，
 * 表单挪到行程主页 WalletCard 组件里原地展开（点「💱 取款/换汇」链接）。
 * 这个路由文件保留但改成重定向，不整个删掉：万一有人收藏过这条旧链接，
 * 落地时还能回到行程主页，而不是碰一个 404。
 */
export default function NewExchangePage({ params }: { params: { tripId: string } }) {
  redirect(`/trips/${params.tripId}`);
}
