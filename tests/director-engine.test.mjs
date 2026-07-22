import assert from "node:assert/strict";
import test from "node:test";
import { buildDirectedPlacements, hasReliableRhythm } from "../lib/analysis-engine.ts";

const sections = [
  { id: "open", name: "OPEN", start: 0, end: 10, energy: 0.2, rhythm: "half", pattern: "restrained" },
  { id: "build", name: "BUILD", start: 10, end: 20, energy: 0.55, rhythm: "normal", pattern: "build" },
  { id: "peak", name: "PEAK", start: 20, end: 30, energy: 0.9, rhythm: "double", pattern: "burst" },
  { id: "outro", name: "OUTRO", start: 30, end: 40, energy: 0.2, rhythm: "half", pattern: "release" },
];
const beats = Array.from({ length: 81 }, (_, index) => index * 0.5);
const effects = [
  { assetId: "flash", peakTime: 0.8, sourceDuration: 2, brightness: 1, flashiness: 0.9, suggestedDuration: 0.25 },
  { assetId: "glow", peakTime: 0.1, sourceDuration: 2, brightness: 0.7, flashiness: 0.2, suggestedDuration: 0.6 },
];
const result = {
  duration: 40,
  bpm: 120,
  confidence: 0.9,
  beats,
  signals: Array.from({ length: 2000 }, (_, index) => ({ time: index * 0.02, energy: index * 0.02 >= 20 && index * 0.02 < 30 ? 0.9 : 0.45, onset: index % 25 === 0 ? 1 : 0.08 })),
  visuals: beats.map((time) => ({ time, brightness: 0.5, motion: 0.3, cutScore: 0 })),
  sceneCuts: [{ time: 10, confidence: 1 }, { time: 20, confidence: 1 }, { time: 30, confidence: 1 }],
  sections,
  effects,
  framesAnalyzed: 100,
};

test("Auto Director creates an intentional section arc", () => {
  const placements = buildDirectedPlacements(result, ["flash", "glow"], "dynamic", sections);
  const count = (sectionId) => placements.filter((placement) => placement.sectionId === sectionId).length;
  assert.ok(count("peak") > count("open"));
  assert.ok(count("build") > count("outro"));

  const buildHits = placements.filter((placement) => placement.sectionId === "build").map((placement) => placement.start);
  const midpoint = (buildHits[0] + buildHits.at(-1)) / 2;
  assert.ok(buildHits.filter((time) => time >= midpoint).length > buildHits.filter((time) => time < midpoint).length);
  assert.ok(placements.every((placement, index) => index === 0 || placements[index - 1].start <= placement.start));
});

test("effect peaks stay locked to the section rhythm grid", () => {
  const placements = buildDirectedPlacements(result, ["flash", "glow"], "dynamic", sections);
  const doubledPeakGrid = beats.flatMap((beat, index) => index < beats.length - 1 && beat >= 20 && beat < 30 ? [beat, (beat + beats[index + 1]) / 2] : [beat]);
  for (const placement of placements) {
    const profile = effects.find((effect) => effect.assetId === placement.assetId);
    const peakAt = placement.start + profile.peakTime - placement.sourceStart;
    assert.ok(doubledPeakGrid.some((beat) => Math.abs(beat - peakAt) < 0.011), `peak at ${peakAt} missed the beat grid`);
    assert.ok(peakAt >= placement.start && peakAt <= placement.start + placement.duration, `peak at ${peakAt} fell outside its clip`);
  }
});

test("late effect peaks are trimmed into a visible beat-aligned window", () => {
  const lateResult = {
    ...result,
    effects: [{ assetId: "late", peakTime: 4, sourceDuration: 8, brightness: 1, flashiness: 1, suggestedDuration: 0.25 }],
  };
  const placements = buildDirectedPlacements(lateResult, ["late"], "dynamic", sections);
  const rhythmGrid = beats.flatMap((beat, index) => index < beats.length - 1 ? [beat, (beat + beats[index + 1]) / 2] : [beat]);
  assert.ok(placements.length > 0);
  for (const placement of placements) {
    const peakAt = placement.start + 4 - placement.sourceStart;
    assert.ok(peakAt >= placement.start && peakAt <= placement.start + placement.duration);
    assert.ok(rhythmGrid.some((beat) => Math.abs(beat - peakAt) < 0.011));
  }
});

test("section duration and scale overrides apply on every director rebuild", () => {
  const custom = sections.map((section) => section.id === "peak" ? { ...section, duration: 0.9, scale: 141 } : section);
  const placements = buildDirectedPlacements(result, ["flash", "glow"], "dynamic", custom);
  const peakPlacements = placements.filter((placement) => placement.sectionId === "peak");
  assert.ok(peakPlacements.length > 0);
  assert.ok(peakPlacements.every((placement) => placement.scale === 141));
  assert.ok(peakPlacements.some((placement) => placement.duration >= 0.89));
});

test("low-confidence rhythm is not treated as safe for automatic cuts", () => {
  assert.equal(hasReliableRhythm({ ...result, confidence: 0 }), false);
  assert.equal(hasReliableRhythm(result), true);
});
