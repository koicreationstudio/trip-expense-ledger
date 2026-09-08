import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// 让 `next dev` 本地也能连到真的 D1/R2 模拟（miniflare），不用另开一套本地
// sqlite/磁盘文件路线。官方要求这个调用必须直接放在 config 文件里、且不能
// await（虽然函数本身是 async）。
initOpenNextCloudflareForDev();

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
