import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ScenePilot auto editor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>ScenePilot Studio/);
  assert.match(html, /STROBES THAT HIT/);
  assert.match(html, /MAKE THE CUT/);
  assert.match(html, /PRO ARRANGEMENT/);
  assert.match(html, /Render MP4/);
  assert.match(html, /Restore saved project/);
  assert.match(html, /AUTO DIRECTOR/);
});

test("keeps the analysis, render, and persistence engines connected", async () => {
  const [page, analysis, renderEngine, projectStore] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/render-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /renderProject\(/);
  assert.match(page, /saveProject</);
  assert.match(page, /analysisAbortRef\.current\?\.abort/);
  assert.match(analysis, /sourceStart/);
  assert.match(analysis, /signal\?\.throwIfAborted/);
  assert.match(analysis, /buildDirectedPlacements/);
  assert.match(analysis, /pattern === "build"/);
  assert.match(page, /tapTempo/);
  assert.match(page, /beatOffset/);
  assert.match(renderEngine, /new Mp4OutputFormat/);
  assert.match(renderEngine, /globalCompositeOperation = "screen"/);
  assert.match(projectStore, /indexedDB\.open/);
});
