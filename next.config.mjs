/** @type {import('next').NextConfig} */
const nextConfig = {
  // 不用 output: 'standalone'：better-sqlite3 是原生绑定，standalone 模式的依赖
  // 追踪（@vercel/nft）经常漏掉 .node 二进制文件，自托管场景下踩这个坑排查成本很高。
  // Docker 镜像直接带完整 node_modules 运行更可靠，体积换来的是少踩坑。
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

export default nextConfig;
