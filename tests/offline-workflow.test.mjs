import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import XLSX from "xlsx-js-style";

// Requires a local Chrome, or PLAYWRIGHT_BROWSER=chromium after playwright install chromium.
let browser, extraction, entry;
const artifacts = path.resolve("outputs/verification");
before(async () => {
  const output = path.resolve("outputs/offline");
  const release = JSON.parse(await readFile(path.join(output, "latest.json"), "utf8"));
  extraction = await mkdtemp(path.join(tmpdir(), "qpcr-browser-extraction-"));
  execFileSync("unzip", ["-q", path.join(output, release.zipName), "-d", extraction]);
  entry = pathToFileURL(path.join(extraction, release.folderName, "index.html")).href;
  await mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER === "chromium" ? undefined : "chrome", headless: true });
});
after(async () => {
  await browser?.close();
  if (extraction) await rm(extraction, { recursive: true, force: true });
});

async function workspace(t) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  t.after(async () => {
    if (!page.isClosed()) await page.screenshot({ path: path.join(artifacts, `${t.name.replace(/[^a-z0-9-]/gi, "-")}.png`), fullPage: true });
    await context.close();
    assert.deepEqual(errors, [], "No runtime exceptions may be hidden behind blank screens");
  });
  await page.goto(entry);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  return page;
}
async function enterAnalysis(page) {
  await page.locator(".readiness-actions button").click();
  await page.locator(".workspace-tabs").waitFor();
}
async function results(page) {
  await page.locator(".workspace-tabs").getByRole("button", { name: /Results & figures/ }).click();
  await page.locator(".result-chart-stack svg").first().waitFor();
}
async function download(page, button) {
  const pending = page.waitForEvent("download");
  await button.click();
  const file = await pending;
  const output = path.join(artifacts, file.suggestedFilename());
  await file.saveAs(output);
  return output;
}

test("cq-plate-edit-undo-apply-and-export", async t => {
  const page = await workspace(t);
  await page.locator('input[type="file"]').first().setInputFiles("examples/demo-data/qpcr_single_plate_expression_demo.tsv");
  await enterAnalysis(page);
  await results(page);
  assert.equal(await page.locator(".result-chart-stack svg").count(), 2);
  const before = await page.locator(".result-table-wrap tbody").innerText();
  const workbook = XLSX.read(await readFile(await download(page, page.getByRole("button", { name: "Excel · 5 sheets", exact: true }))), { type: "buffer" });
  assert.ok(workbook.SheetNames.includes("Well Calculations"));
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Complete Results"]).length, 8);
  const bar = XLSX.read(await readFile(await download(page, page.getByRole("button", { name: "Bar Excel", exact: true }))), { type: "buffer" });
  assert.deepEqual(XLSX.utils.sheet_to_json(bar.Sheets.bar, { header: 1 })[0], ["category", "value", "sd", "sem", "group"]);
  await page.locator(".workspace-tabs").getByRole("button", { name: /Plate workspace/ }).click();
  const well = page.locator('.well-cell').filter({ has: page.locator('.well-name', { hasText: /^A1$/ }) });
  await well.click();
  assert.match(await page.locator(".single-cq-value").innerText(), /20\.020/);
  await page.getByLabel("Set Sample Name for selection", { exact: true }).fill("Renamed");
  await page.getByRole("button", { name: "Apply to 1 selected well(s)", exact: true }).click();
  assert.match(await well.innerText(), /Renamed/);
  assert.ok(await page.locator(".pending-recalculation-notice").isVisible());
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.match(await well.innerText(), /Control_01/);
  await results(page);
  assert.equal(await page.locator(".result-table-wrap tbody").innerText(), before);
  await page.locator(".workspace-tabs").getByRole("button", { name: /Plate workspace/ }).click();
  await well.click();
  await page.getByLabel("Set replicate number for selection", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Apply to 1 selected well(s)", exact: true }).click();
  await page.locator(".pending-recalculation-notice").getByRole("button").click();
  await results(page);
  assert.equal(await page.locator(".result-table-wrap tbody tr").count(), 8);
  await download(page, page.getByRole("button", { name: "SVG", exact: true }).first());
  await download(page, page.getByRole("button", { name: "PNG 4×", exact: true }).first());
  await page.getByRole("button", { name: "Propagated technical SD", exact: true }).click();
  assert.ok(await page.locator('svg g[aria-label*="propagated technical-replicate SD"]').count() > 0);
  await page.evaluate(() => {
    window.Image = class { set src(value) { queueMicrotask(() => this.onerror?.(new Error(value))); } };
  });
  await page.getByRole("button", { name: "PNG 4×", exact: true }).first().click();
  await page.getByRole("alert").filter({ hasText: "Chart rendering failed" }).waitFor();
});

for (const [start, label, field] of [["delta-cq", "Start from ΔCq", "Delta Cq"], ["delta-delta-cq", "Start from ΔΔCq", "Delta Delta Cq"]]) {
  test(`${start}-offline-chart-and-provenance`, async t => {
    const page = await workspace(t);
    await page.getByRole("radio", { name: new RegExp(label) }).click();
    const longName = "Treated-long-sample-name-所有字符都必须保留";
    const content = `Sample\tAssay\tAssay Type\tReplicate\tCq\t${field}\nControl\tGENE\tTarget\t1\t20\t3\nControl\tGENE\tTarget\t2\t21\t3.2\n${longName}\tGENE\tTarget\t1\t29\t2\n${longName}\tGENE\tTarget\t2\t30\t2.2\n`;
    await page.locator('input[type="file"]').first().setInputFiles({ name: `${start}.tsv`, mimeType: "text/tab-separated-values", buffer: Buffer.from(content) });
    assert.equal(await page.getByRole("radio", { name: new RegExp(label) }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Confirm incomplete", exact: true }).click();
    await enterAnalysis(page);
    assert.ok(await page.locator(".workspace-tabs").getByRole("button", { name: /Plate workspace/ }).isDisabled());
    await results(page);
    assert.equal(await page.locator(`svg text[aria-label="${longName}"]`).textContent(), longName);
    const file = await download(page, page.getByRole("button", { name: "Excel", exact: true }));
    const workbook = XLSX.read(await readFile(file), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Complete Results"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].analysis_start, start);
    assert.equal(rows[0].value_provenance, "user-supplied");
    assert.ok(Math.abs(rows[0][start === "delta-cq" ? "delta_cq" : "delta_delta_cq"] - 3.1) < 1e-12);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Supplied Values"]).length, 4);
    await page.getByRole("button", { name: "Technical-replicate SD", exact: true }).click();
    assert.ok(await page.locator('svg g[aria-label*="propagated technical-replicate SD"]').count() > 0);
    const svg = await readFile(await download(page, page.getByRole("button", { name: "SVG", exact: true })), "utf8");
    assert.ok(svg.includes(longName));
    assert.doesNotMatch(svg, /NaN|Infinity/);
    await download(page, page.getByRole("button", { name: "PNG 4×", exact: true }));
  });
}

test("all-selected-samples-remain-in-chart", async t => {
  const page = await workspace(t);
  const lines = ["Well\tSample\tAssay\tReplicate\tCq"];
  for (let sample = 0; sample < 45; sample++) {
    for (let assay = 0; assay < 2; assay++) {
      const position = sample * 2 + assay;
      const well = `${String.fromCharCode(65 + Math.floor(position / 12))}${position % 12 + 1}`;
      lines.push(`${well}\tSample-${sample + 1}\t${assay ? "GENE" : "GAPDH"}\t1\t${assay ? 24 : 20}`);
    }
  }
  await page.locator('input[type="file"]').first().setInputFiles({ name: "45-samples.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from(lines.join("\n")) });
  await enterAnalysis(page);
  await results(page);
  const choices = page.locator(".sample-display-group button");
  for (const choice of await choices.all()) if (await choice.getAttribute("aria-pressed") !== "true") await choice.click();
  assert.equal(await page.locator('svg text[aria-label^="Sample-"]').count(), 45);
  const svg = await readFile(await download(page, page.getByRole("button", { name: "SVG", exact: true })), "utf8");
  assert.ok(svg.includes('aria-label="Sample-45"'));
});

test("tm-only-analysis-remains-available", async t => {
  const page = await workspace(t);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "tm-only.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from("Well\tSample\tAssay\tReplicate\tTm1\tTm2\nA1\tControl\tGENE\t1\t82\t\nA2\tControl\tGENE\t2\t82.2\t78\n") });
  await enterAnalysis(page);
  await page.locator(".workspace-tabs").getByRole("button", { name: /Results & figures/ }).click();
  await page.getByRole("heading", { name: "Tm & melt analysis", exact: true }).waitFor();
  assert.ok(await page.locator(".results-panel table tbody tr").count() > 0);
  assert.ok(await page.getByRole("button", { name: "Quantification", exact: true }).isDisabled());
});
