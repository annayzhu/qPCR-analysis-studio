import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "outputs", "offline");
const releaseDate = process.env.RELEASE_DATE || new Date().toISOString().slice(0, 10).replaceAll("-", "");
const folderName = `qPCR-Analysis-Studio_Offline_${releaseDate}`;
const releaseFolder = path.join(outputRoot, folderName);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "qpcr-analysis-offline-"));

function escapeInline(source, tag) {
  return source.replaceAll(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

const aliasPlugin = {
  name: "project-alias",
  setup(context) {
    context.onResolve({ filter: /^@\// }, (args) => context.resolve(`./${args.path.slice(2)}`, {
      resolveDir: projectRoot,
      kind: args.kind,
    }));
  },
};

try {
  const entryPath = path.join(temporaryRoot, "entry.tsx");
  const bundlePath = path.join(temporaryRoot, "bundle.js");
  await writeFile(entryPath, [
    'import { createRoot } from "react-dom/client";',
    `import QpcrAnalysisStudio from ${JSON.stringify(path.join(projectRoot, "app", "QpcrAnalysisStudio.tsx"))};`,
    `import { LanguageProvider } from ${JSON.stringify(path.join(projectRoot, "app", "i18n.tsx"))};`,
    'createRoot(document.getElementById("qpcr-analysis-root")).render(<LanguageProvider><QpcrAnalysisStudio /></LanguageProvider>);',
  ].join("\n"));
  await build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    bundle: true,
    splitting: false,
    format: "iife",
    platform: "browser",
    target: ["chrome100", "edge100", "firefox100", "safari15.4"],
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [aliasPlugin],
    absWorkingDir: projectRoot,
    nodePaths: [path.join(projectRoot, "node_modules")],
  });

  const [javascript, rawCss] = await Promise.all([
    readFile(bundlePath, "utf8"),
    readFile(path.join(projectRoot, "app", "globals.css"), "utf8"),
  ]);
  const css = rawCss.replace(/^@import\s+["']tailwindcss["'];\s*/mu, "");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>qPCR Analysis Studio</title><style>${escapeInline(css, "style")}</style></head><body><noscript>请启用浏览器 JavaScript 后使用本工具。</noscript><div id="qpcr-analysis-root"></div><script>${escapeInline(javascript, "script")}</script></body></html>`;

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(releaseFolder, { recursive: true });
  const htmlPath = path.join(releaseFolder, "index.html");
  await writeFile(htmlPath, html, "utf8");
  const htmlHash = createHash("sha256").update(await readFile(htmlPath)).digest("hex");
  await writeFile(path.join(releaseFolder, "README_使用说明.txt"), [
    "qPCR Analysis Studio 离线版",
    "",
    "1. 请先完整解压 ZIP，不要直接在压缩包预览中运行。",
    "2. 双击 index.html，推荐最新版 Chrome、Edge 或 Safari。",
    "3. 无需安装 Node.js，也不需要联网；实验文件仅在当前浏览器本地处理。",
    "4. 本工具仅供科研使用。计算结果应结合原始数据、板布局、实验设计与 QC 复核。",
    "",
    `Build date: ${releaseDate}`,
  ].join("\n"));
  await writeFile(path.join(releaseFolder, "SHA256SUMS.txt"), `${htmlHash}  index.html\n`);

  const zipName = `${folderName}.zip`;
  const zipResult = spawnSync("zip", ["-q", "-r", zipName, folderName], { cwd: outputRoot, encoding: "utf8" });
  if (zipResult.error) throw zipResult.error;
  if (zipResult.status !== 0) throw new Error(`zip failed: ${zipResult.stderr}`);
  const zipPath = path.join(outputRoot, zipName);
  const zipHash = createHash("sha256").update(await readFile(zipPath)).digest("hex");
  await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${zipHash}  ${zipName}\n`);
  console.log(JSON.stringify({
    releaseFolder,
    zipPath,
    zipSha256: zipHash,
    zipBytes: (await stat(zipPath)).size,
  }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
