import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("offline package embeds its local data font without network or filesystem dependencies", async () => {
  const outputRoot = path.resolve("outputs/offline");
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const release = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("qPCR-Analysis-Studio_Offline_"));
  assert.ok(release, "offline release folder was not generated");
  const html = await readFile(path.join(outputRoot, release.name, "index.html"), "utf8");
  assert.match(html, /data:font\/ttf;base64,/);
  assert.doesNotMatch(html, /url\(["']?\/fonts\//);
  assert.match(html, /font-family:\s*var\(--font-geist-sans,\s*ui-sans-serif\)/);
});
