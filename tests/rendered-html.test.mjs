import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the staged qPCR analysis application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /qPCR Analysis Studio/);
  assert.match(html, /分类型导入，再统一分析/);
  assert.match(html, /Cq\/Ct\/Cp/);
  assert.match(html, /Tm\/熔解/);
  assert.match(html, /仪器结果/);
  assert.match(html, /板布局/);
  assert.match(html, /添加结果/);
  assert.match(html, /添加布局/);
  assert.match(html, /拖入仪器结果文件/);
  assert.match(html, /拖入板布局文件/);
  assert.match(html, /XLSX · CSV · TXT · TSV/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});
