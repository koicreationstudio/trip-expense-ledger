/**
 * 行程状态文案——原本只有 page.tsx 一处在用（拼进已经删掉的重复 subheader 行），
 * 2026-09-16 第十七轮把它搬进头部大标题的副标题（layout.tsx），改成两处共用，
 * 抽成共享常量，不要两边各自维护一份容易漂移的映射表。
 */
export const TRIP_STATUS_LABEL: Record<string, string> = {
  active: '记账中',
  settled: '已结算',
  archived: '已归档',
};
