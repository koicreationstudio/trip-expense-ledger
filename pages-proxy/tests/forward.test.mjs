// 转发冒烟测试守护 —— 这不是打真实网络的端到端测试（那个是 deploy.sh 部署后
// 的步骤④回读，打生产 /api/health），这里测的是"转发函数本身的逻辑有没有被
// 改坏"：拿一个假的 env.ORIGIN.fetch 当探针，断言 onRequest 确实且只调用了它
// 一次、传进去的还是原封不动的同一个 request 对象（不是重新拼出来的），而且
// 把 fetch 的返回值原样吐回去。
//
// mutation 验证记录在 pages-proxy/deploy.sh 注释里：手动把
// functions/[[path]].js 改成三种坏版本（不调用 fetch / 重新 new Request 而不是
// 透传原对象 / 吞掉返回值自己造一个新 Response）各跑一次这份测试，三次都真的
// 红了，改回原版全绿，证明这道关卡不是空壳。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/[[path]].js';

test('把收到的 request 原样转给 ORIGIN，只调用一次', async () => {
  const fakeRequest = new Request('https://kongsi-trip.pages.dev/trips/abc');
  const fakeResponse = new Response('ok', { status: 200 });
  let callCount = 0;
  let receivedRequest = null;

  const context = {
    request: fakeRequest,
    env: {
      ORIGIN: {
        fetch(req) {
          callCount += 1;
          receivedRequest = req;
          return fakeResponse;
        },
      },
    },
  };

  const result = await onRequest(context);

  assert.equal(callCount, 1, 'ORIGIN.fetch 必须恰好被调用一次');
  assert.equal(receivedRequest, fakeRequest, '传给 ORIGIN.fetch 的必须是同一个 request 对象（原样透传，不是重新拼的）');
  assert.equal(result, fakeResponse, 'onRequest 的返回值必须是 ORIGIN.fetch 的返回值本身（不改写）');
});

test('POST 请求（比如登录/表单提交）也原样转发，不是只处理 GET', async () => {
  const fakeRequest = new Request('https://kongsi-trip.pages.dev/api/account/provision', {
    method: 'POST',
  });
  const fakeResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
  let receivedRequest = null;

  const context = {
    request: fakeRequest,
    env: {
      ORIGIN: {
        fetch(req) {
          receivedRequest = req;
          return fakeResponse;
        },
      },
    },
  };

  const result = await onRequest(context);

  assert.equal(receivedRequest.method, 'POST');
  assert.equal(result, fakeResponse);
});
