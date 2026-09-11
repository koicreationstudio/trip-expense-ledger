/**
 * 常用消费分类，够 v0.1 用；完整记账表单（expense-form.tsx）和快速记账
 * （quick-add-expense.tsx）共用同一份，不各自维护一份列表容易慢慢漂移。
 * 不是穷举，用户要的分类不在列表里也可以手动打字（两处都接的是 datalist，不是 select）。
 */
export const COMMON_CATEGORIES = ['餐饮', '交通', '住宿', '门票', '购物', '其他'] as const;
