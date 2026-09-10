import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("offline package embeds its local data font without network or filesystem dependencies", async () => {
  const outputRoot = path.resolve("outputs/offline");
  const release = JSON.parse(await readFile(path.join(outputRoot, "latest.json"), "utf8"));
  const archive = await readFile(path.join(outputRoot, release.zipName));
  assert.equal(createHash("sha256").update(archive).digest("hex"), release.zipSha256);
  const extraction = await mkdtemp(path.join(tmpdir(), "qpcr-release-verification-"));
  let html;
  try {
    execFileSync("unzip", ["-q", path.join(outputRoot, release.zipName), "-d", extraction]);
    html = await readFile(path.join(extraction, release.folderName, "index.html"), "utf8");
    assert.equal(createHash("sha256").update(html).digest("hex"), release.htmlSha256);
  } finally {
    await rm(extraction, { recursive: true, force: true });
  }
  assert.match(html, /data:font\/ttf;base64,/);
  assert.doesNotMatch(html, /url\(["']?\/fonts\//);
  assert.match(html, /font-family:\s*var\(--font-geist-sans,\s*ui-sans-serif\)/);
});
