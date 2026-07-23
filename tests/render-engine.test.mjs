import assert from "node:assert/strict";
import test from "node:test";
import {
  EncodedAudioPacketSource,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
} from "mediabunny";
import { createRenderTrackMetadata, fitCover } from "../lib/render-engine.ts";

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

test("reserved fast-start metadata bounds every rendered track", () => {
  const metadata = createRenderTrackMetadata(180, 30, 48_000);
  assert.deepEqual(metadata.video, { frameRate: 30, maximumPacketCount: 5_400 });
  assert.ok(metadata.audio);
  assert.ok(metadata.audio.maximumPacketCount >= 24_000);

  const videoOnly = createRenderTrackMetadata(180, 30);
  assert.equal(videoOnly.audio, null);
  assert.equal(videoOnly.video.maximumPacketCount, 5_400);
});

test("Mediabunny accepts reserved fast-start video and audio tracks", async () => {
  const metadata = createRenderTrackMetadata(180, 30, 48_000);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "reserve" }), target: new NullTarget() });
  output.addVideoTrack(new EncodedVideoPacketSource("avc"), metadata.video);
  assert.ok(metadata.audio);
  output.addAudioTrack(new EncodedAudioPacketSource("aac"), metadata.audio);

  await output.start();
  await output.cancel();
});
