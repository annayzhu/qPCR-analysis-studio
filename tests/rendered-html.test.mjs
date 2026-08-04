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

test("server-renders the instrument-independent qPCR application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /qPCR Analysis Studio/);
  assert.match(html, /从原始孔位到可追溯结果/);
  assert.match(html, /Roche LC480/);
  assert.match(html, /QuantStudio 5/);
  assert.match(html, /ABI 7500/);
  assert.match(html, /Generic XLSX/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

