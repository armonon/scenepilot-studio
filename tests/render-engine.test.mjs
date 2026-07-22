import assert from "node:assert/strict";
import test from "node:test";
import { fitCover } from "../lib/render-engine.ts";

test("cover geometry matches the full-frame preview without stretching", () => {
  assert.deepEqual(fitCover(1920, 1080, 1080, 1080), { x: -420, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(fitCover(1080, 1920, 1920, 1080), { x: 0, y: -1166.6666666666665, width: 1920, height: 3413.333333333333 });
});

test("cover geometry remains centered when placement scale exceeds 100 percent", () => {
  const box = fitCover(1280, 720, 2304, 1296);
  assert.equal(box.x, 0);
  assert.equal(box.y, 0);
  assert.equal(box.width, 2304);
  assert.equal(box.height, 1296);
});
