// 自动生成，别手改 —— scripts/generate-build-info.mjs 在每次 `npm run build`
// （prebuild 钩子）前重新算一遍，写实成"这次构建当下"的 git commit + 时间。
// 这份文件本身照常提交进 git，纯粹是让 lint/typecheck/test 在真正跑 build
// 之前也有个占位值可以 import，不会因为文件不存在直接编译失败；这里存的值
// 是不是当前 commit 不重要，重要的是每次实际部署前 prebuild 都会把它覆盖成
// 真实值。commit 后缀 "-dirty" 代表生成这份文件那一刻工作树有未提交改动
// （部署的代码不完全等于 HEAD 那个 commit，给 Remy 一个诚实提示）。
export const BUILD_COMMIT = "875081c-dirty";
export const BUILD_TIME = "2026-09-15T00:24:52.813Z";
