import { defineCloudflareConfig } from '@opennextjs/cloudflare/config';

// 这个 app 每个请求都要读 cookie 做鉴权（session-based），页面本来就走
// force-dynamic，没有走 ISR 的场景，所以不接 R2 增量缓存这层，省一个 bucket。
export default defineCloudflareConfig();
