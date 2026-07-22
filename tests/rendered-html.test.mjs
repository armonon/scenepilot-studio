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
  assert.match(html, /DROP VIDEO OR SONG/);
});

test("keeps the analysis, render, persistence, and standalone engines connected", async () => {
  const [page, analysis, renderEngine, projectStore, layout, manifest, serviceWorker, desktop, releaseWorkflow] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/render-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/release-macos.yml", import.meta.url), "utf8"),
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
  assert.match(page, /accept="video\/\*,audio\/\*"/);
  assert.match(page, /analysis-dock-track/);
  assert.match(page, /formatWait\(analysisEta\)/);
  assert.match(page, /event\.currentTarget\.value = ""/);
  assert.match(page, /pendingSourceUrlRef/);
  assert.match(page, /type ClipTrack =/);
  assert.match(page, /dropOnClipTrack/);
  assert.match(page, /clip-track-lane/);
  assert.match(page, /Track FX/);
  assert.match(page, /tracks: clipTracks/);
  assert.match(analysis, /new VideoSampleSink\(track\)/);
  assert.match(analysis, /Audio source ready; building a visual canvas/);
  assert.match(renderEngine, /new Mp4OutputFormat/);
  assert.match(renderEngine, /if \(!mainVideoTrack && !audioTrack\)/);
  assert.match(renderEngine, /mainVideoTrack \?/);
  assert.match(renderEngine, /globalCompositeOperation = track/);
  assert.match(renderEngine, /track\?\.blend === "normal"/);
  assert.match(renderEngine, /hue-rotate/);
  assert.match(renderEngine, /track\?\.fadeIn/);
  assert.match(projectStore, /indexedDB\.open/);
  assert.match(page, /StandaloneRuntime/);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.match(serviceWorker, /scenepilot-standalone-v1/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(desktop, /checkForUpdates/);
  assert.match(desktop, /releases\/latest/);
  assert.match(desktop, /downloadURL/);
  assert.match(releaseWorkflow, /gh release create/);
});
