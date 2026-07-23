import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink } from "mediabunny";

export type AnalysisProgress = {
  phase: "audio" | "footage" | "effects" | "edit";
  progress: number;
  message: string;
};

export type AnalysisAsset = {
  id: string;
  file: File;
  url: string;
  kind: "image" | "video";
};

export type SignalPoint = {
  time: number;
  energy: number;
  onset: number;
};

export type VisualPoint = {
  time: number;
  brightness: number;
  motion: number;
  cutScore: number;
};

export type SceneCut = {
  time: number;
  confidence: number;
};

export type EffectProfile = {
  assetId: string;
  peakTime: number;
  sourceDuration: number;
  brightness: number;
  flashiness: number;
  suggestedDuration: number;
};

export type DetectedSection = {
  id: string;
  name: string;
  start: number;
  end: number;
  energy: number;
};

export type AnalysisResult = {
  duration: number;
  bpm: number;
  confidence: number;
  beats: number[];
  signals: SignalPoint[];
  visuals: VisualPoint[];
  sceneCuts: SceneCut[];
  sections: DetectedSection[];
  effects: EffectProfile[];
  framesAnalyzed: number;
};

export type SmartPlacement = {
  id: string;
  assetId: string;
  sectionId: string;
  start: number;
  sourceStart: number;
  duration: number;
  scale: number;
  opacity: number;
};

export type DirectorPattern = "restrained" | "pulse" | "build" | "burst" | "release";
export type RhythmRate = "half" | "normal" | "double";
export type DirectorSection = {
  id: string;
  name: string;
  start: number;
  end: number;
  energy: number;
  enabled?: boolean;
  rhythm?: RhythmRate;
  pattern?: DirectorPattern;
  duration?: number;
  scale?: number;
};

const SECTION_NAMES = ["OPEN", "VERSE", "BUILD", "PEAK", "BREAK", "FINAL", "OUTRO"];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

function median(values: number[]) {
  return quantile(values, 0.5);
}

function normalize(values: number[]) {
  const low = quantile(values, 0.05);
  const high = quantile(values, 0.95);
  const range = Math.max(1e-6, high - low);
  return values.map((value) => clamp((value - low) / range));
}

function nearestSignal(signals: SignalPoint[], time: number) {
  if (!signals.length) return { time, energy: 0, onset: 0 };
  const step = signals.length > 1 ? signals[1].time - signals[0].time : 0.02;
  return signals[Math.min(signals.length - 1, Math.max(0, Math.round(time / step)))];
}

function checkAborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

async function yieldFrame(signal?: AbortSignal) {
  checkAborted(signal);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  checkAborted(signal);
}

async function analyzeAudio(file: File, duration: number, report: (value: AnalysisProgress) => void, signal?: AbortSignal) {
  checkAborted(signal);
  const frameSize = 2048;
  const hopSize = 1024;
  const rawEnergy: number[] = [];
  const rawOnset: number[] = [];
  let previousEnergy = 0;
  let previousHigh = 0;
  let sampleRate = 48000;
  let carry = new Float32Array(0);
  let lastProgressTime = -Infinity;
  const processFrame = (samples: Float32Array, start: number, end: number) => {
    let sum = 0;
    let high = 0;
    let previous = 0;
    for (let index = start; index < end; index += 2) {
      const sample = samples[index] || 0;
      sum += sample * sample;
      const delta = sample - previous;
      high += delta * delta;
      previous = sample;
    }
    const count = Math.max(1, Math.ceil((end - start) / 2));
    const energy = Math.sqrt(sum / count);
    const highEnergy = Math.sqrt(high / count);
    rawEnergy.push(energy);
    rawOnset.push(Math.max(0, energy - previousEnergy) * 0.55 + Math.max(0, highEnergy - previousHigh) * 0.45);
    previousEnergy = previousEnergy * 0.72 + energy * 0.28;
    previousHigh = previousHigh * 0.72 + highEnergy * 0.28;
  };
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("The source has no decodable soundtrack.");
    const sink = new AudioBufferSink(track);
    for await (const wrapped of sink.buffers(0, duration)) {
      checkAborted(signal);
      const buffer = wrapped.buffer;
      sampleRate = buffer.sampleRate;
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const mono = new Float32Array(buffer.length);
      for (const channel of channels) for (let index = 0; index < mono.length; index++) mono[index] += (channel[index] || 0) / channels.length;
      const combined = new Float32Array(carry.length + mono.length);
      combined.set(carry);
      combined.set(mono, carry.length);
      let consumed = 0;
      for (let start = 0; start + frameSize <= combined.length; start += hopSize) {
        processFrame(combined, start, start + frameSize);
        consumed = start + hopSize;
      }
      carry = combined.slice(consumed);
      const decodedThrough = wrapped.timestamp + wrapped.duration;
      if (decodedThrough - lastProgressTime >= 2 || decodedThrough >= duration - 0.05) {
        report({ phase: "audio", progress: Math.min(0.98, decodedThrough / duration), message: "Measuring transients and musical energy" });
        lastProgressTime = decodedThrough;
        await yieldFrame(signal);
      }
    }
    if (carry.length) processFrame(carry, 0, carry.length);
  } finally {
    input.dispose();
  }

  const frameRate = sampleRate / hopSize;
  const energy = normalize(rawEnergy);
  const onset = normalize(rawOnset);
  const signals = energy.map((value, index) => ({ time: index / frameRate, energy: value, onset: onset[index] }));
  const onsetFloor = quantile(rawOnset, 0.5);
  const onsetPeak = quantile(rawOnset, 0.95);
  const energyPeak = quantile(rawEnergy, 0.9);
  const hasRhythmicSignal = rawOnset.length >= 8 && energyPeak > 0.0005 && onsetPeak - onsetFloor > 0.00001;
  if (!hasRhythmicSignal) {
    const bpm = 120;
    const beatDuration = 60 / bpm;
    const beats = Array.from({ length: Math.floor(duration / beatDuration) + 1 }, (_, index) => index * beatDuration);
    return { bpm, beats, signals, confidence: 0 };
  }
  const minBpm = 72;
  const maxBpm = 176;
  let bestLag = Math.round((60 / 120) * frameRate);
  let bestCorrelation = -Infinity;
  const noveltyMean = onset.reduce((sum, value) => sum + value, 0) / Math.max(1, onset.length);
  const correlations = new Map<number, number>();
  const minimumLag = Math.floor((60 / maxBpm) * frameRate);
  const maximumLag = Math.ceil((60 / minBpm) * frameRate);
  for (let lag = minimumLag; lag <= maximumLag; lag++) {
    let correlation = 0;
    let weight = 0;
    for (let index = lag; index < onset.length; index += 2) {
      correlation += Math.max(0, onset[index] - noveltyMean) * Math.max(0, onset[index - lag] - noveltyMean);
      weight++;
    }
    correlation /= Math.max(1, weight);
    correlations.set(lag, correlation);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  const left = correlations.get(bestLag - 1) ?? bestCorrelation;
  const right = correlations.get(bestLag + 1) ?? bestCorrelation;
  const curvature = left - 2 * bestCorrelation + right;
  const offset = Math.abs(curvature) > 1e-9 ? clamp(0.5 * (left - right) / curvature, -0.5, 0.5) : 0;
  const bestBpm = Math.round(clamp(60 * frameRate / (bestLag + offset), minBpm, maxBpm));

  const beatDuration = 60 / bestBpm;
  const searchFrames = Math.min(onset.length, Math.round(frameRate * 12));
  let anchorIndex = 0;
  for (let index = 1; index < searchFrames; index++) {
    if (onset[index] > onset[anchorIndex]) anchorIndex = index;
  }
  const anchor = anchorIndex / frameRate;
  const beats: number[] = [];
  for (let time = anchor; time >= 0; time -= beatDuration) beats.unshift(time);
  for (let time = anchor + beatDuration; time <= duration; time += beatDuration) beats.push(time);
  const snappedBeats = beats.map((beat) => {
    const center = Math.round(beat * frameRate);
    const radius = Math.max(1, Math.round(frameRate * 0.065));
    let best = center;
    for (let index = Math.max(0, center - radius); index <= Math.min(onset.length - 1, center + radius); index++) {
      if (onset[index] > (onset[best] ?? 0)) best = index;
    }
    return best / frameRate;
  });

  const correlationValues = [...correlations.values()];
  const correlationFloor = median(correlationValues);
  const confidence = clamp((bestCorrelation - correlationFloor) / Math.max(1e-5, quantile(onset, 0.9) ** 2 * 0.35));
  return { bpm: bestBpm, beats: snappedBeats, signals, confidence };
}

export function hasReliableRhythm(result: Pick<AnalysisResult, "confidence" | "beats" | "signals">) {
  return result.confidence >= 0.08 && result.beats.length >= 2 && result.signals.some((point) => point.onset >= 0.05);
}

export function mergeDirectedSectionPlacements<T extends { id: string; sectionId: string; start: number }>(
  current: T[],
  rebuilt: T[],
  sectionId: string,
  preserveManualClips = true,
) {
  return [
    ...current.filter((placement) => placement.sectionId !== sectionId || (preserveManualClips && placement.id.startsWith("manual-"))),
    ...rebuilt,
  ].sort((a, b) => a.start - b.start);
}

function frameStats(data: Uint8ClampedArray, previous?: Uint8Array) {
  const gray = new Uint8Array(data.length / 4);
  const histogram = new Float32Array(16);
  let brightness = 0;
  let difference = 0;
  for (let source = 0, target = 0; source < data.length; source += 4, target++) {
    const value = Math.round(data[source] * 0.2126 + data[source + 1] * 0.7152 + data[source + 2] * 0.0722);
    gray[target] = value;
    histogram[Math.min(15, value >> 4)]++;
    brightness += value;
    if (previous) difference += Math.abs(value - previous[target]);
  }
  for (let index = 0; index < histogram.length; index++) histogram[index] /= gray.length;
  return {
    gray,
    histogram,
    brightness: brightness / gray.length / 255,
    difference: previous ? difference / gray.length / 255 : 0,
  };
}

function waitForMedia(target: HTMLMediaElement, event: "loadeddata" | "seeked", signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, done);
      signal?.removeEventListener("abort", aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const aborted = () => { cleanup(); reject(signal?.reason ?? new DOMException("Analysis canceled", "AbortError")); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Media ${event} timed out`)); }, 10000);
    target.addEventListener(event, done);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

async function analyzeFootage(file: File, duration: number, report: (value: AnalysisProgress) => void, signal?: AbortSignal) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    report({ phase: "footage", progress: 1, message: "Audio source ready; building a visual canvas" });
    return { points: [], sceneCuts: [] };
  }
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas analysis is unavailable");
  const interval = Math.max(0.2, duration / 900);
  const points: VisualPoint[] = [];
  let previousGray: Uint8Array | undefined;
  let previousHistogram: Float32Array | undefined;
  const capture = (time: number) => {
    const stats = frameStats(context.getImageData(0, 0, canvas.width, canvas.height).data, previousGray);
    let histogramDistance = 0;
    if (previousHistogram) {
      for (let index = 0; index < 16; index++) histogramDistance += Math.abs(stats.histogram[index] - previousHistogram[index]);
      histogramDistance /= 2;
    }
    points.push({ time, brightness: stats.brightness, motion: stats.difference, cutScore: histogramDistance * 0.62 + stats.difference * 0.38 });
    previousGray = stats.gray;
    previousHistogram = stats.histogram;
  };

  try {
    const sink = new VideoSampleSink(track);
    const timestamps = Array.from({ length: Math.max(1, Math.ceil(duration / interval)) }, (_, index) => Math.min(duration - 0.001, index * interval));
    let frame = 0;
    for await (const sample of sink.samplesAtTimestamps(timestamps)) {
      checkAborted(signal);
      const timestamp = timestamps[frame++] ?? 0;
      if (sample) {
        sample.draw(context, 0, 0, canvas.width, canvas.height);
        capture(timestamp);
        sample.close();
      }
      if (frame % 24 === 0 || frame === timestamps.length) {
        report({ phase: "footage", progress: Math.min(0.98, frame / timestamps.length), message: `Inspecting visual sample ${frame} of ${timestamps.length}` });
        await yieldFrame(signal);
      }
    }
    report({ phase: "footage", progress: 1, message: `Inspected ${points.length} visual samples` });
  } catch {
    checkAborted(signal);
    points.length = 0;
    previousGray = undefined;
    previousHistogram = undefined;
    report({ phase: "footage", progress: 0, message: "Using compatibility scan for this video" });
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const sourceUrl = URL.createObjectURL(file);
    video.src = sourceUrl;
    try {
      if (video.readyState < 2) await waitForMedia(video, "loadeddata", signal);
      const fallbackInterval = Math.max(0.35, duration / 600);
      let frame = 0;
      for (let time = 0; time < duration; time += fallbackInterval) {
        checkAborted(signal);
        const targetTime = Math.min(time, Math.max(0, duration - 0.05));
        if (Math.abs(video.currentTime - targetTime) > 0.01) {
          video.currentTime = targetTime;
          await waitForMedia(video, "seeked", signal);
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        capture(time);
        frame++;
        if (frame % 8 === 0) {
          report({ phase: "footage", progress: Math.min(0.98, time / duration), message: `Compatibility sample ${frame}` });
          await yieldFrame(signal);
        }
      }
      report({ phase: "footage", progress: 1, message: `Inspected ${points.length} visual samples` });
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(sourceUrl);
    }
  } finally {
    input.dispose();
  }
  const scores = points.slice(1).map((point) => point.cutScore);
  const center = median(scores);
  const deviation = median(scores.map((value) => Math.abs(value - center)));
  const threshold = center + Math.max(0.045, deviation * 3.2);
  const sceneCuts: SceneCut[] = [];
  for (const point of points) {
    if (point.cutScore < threshold || point.time - (sceneCuts.at(-1)?.time ?? -10) < 0.3) continue;
    sceneCuts.push({ time: point.time, confidence: clamp((point.cutScore - center) / Math.max(0.08, threshold - center) / 2) });
  }
  return { points, sceneCuts };
}

async function analyzeEffect(asset: AnalysisAsset, signal?: AbortSignal) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas analysis is unavailable");
  const brightness: number[] = [];
  const times: number[] = [];
  let sourceDuration = Infinity;

  if (asset.kind === "image") {
    const bitmap = await createImageBitmap(asset.file);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    brightness.push(frameStats(context.getImageData(0, 0, canvas.width, canvas.height).data).brightness);
    times.push(0);
  } else {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const sourceUrl = asset.url || URL.createObjectURL(asset.file);
    video.src = sourceUrl;
    const temporaryUrl = !asset.url;
    if (video.readyState < 2) await waitForMedia(video, "loadeddata", signal);
    sourceDuration = video.duration || 1;
    const inspectDuration = Math.min(8, sourceDuration);
    for (let index = 0; index < 20; index++) {
      checkAborted(signal);
      const time = (inspectDuration * index) / 20;
      const targetTime = Math.min(time, Math.max(0, inspectDuration - 0.02));
      if (Math.abs(video.currentTime - targetTime) > 0.01) {
        video.currentTime = targetTime;
        await waitForMedia(video, "seeked", signal);
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      brightness.push(frameStats(context.getImageData(0, 0, canvas.width, canvas.height).data).brightness);
      times.push(time);
    }
    video.removeAttribute("src");
    video.load();
    if (temporaryUrl) URL.revokeObjectURL(sourceUrl);
  }

  let peakIndex = 0;
  let totalChange = 0;
  for (let index = 1; index < brightness.length; index++) {
    if (brightness[index] > brightness[peakIndex]) peakIndex = index;
    totalChange += Math.abs(brightness[index] - brightness[index - 1]);
  }
  const flashiness = clamp(totalChange / Math.max(1, brightness.length - 1) * 5);
  return {
    assetId: asset.id,
    peakTime: times[peakIndex] || 0,
    sourceDuration,
    brightness: brightness[peakIndex] || 0.5,
    flashiness,
    suggestedDuration: asset.kind === "image" ? 0.22 : clamp(0.62 - flashiness * 0.42, 0.12, 0.7),
  };
}

function detectSections(duration: number, signals: SignalPoint[], scenes: SceneCut[]) {
  const bucketSize = 4;
  const buckets = Array.from({ length: Math.ceil(duration / bucketSize) }, (_, index) => {
    const start = index * bucketSize;
    const values = signals.filter((point) => point.time >= start && point.time < start + bucketSize).map((point) => point.energy);
    return { time: start, energy: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) };
  });
  const changes = buckets.slice(1).map((bucket, index) => ({
    time: bucket.time,
    score: Math.abs(bucket.energy - buckets[index].energy) + (scenes.some((scene) => Math.abs(scene.time - bucket.time) < 2) ? 0.18 : 0),
  })).sort((a, b) => b.score - a.score);
  const boundaries = [0, duration];
  for (const candidate of changes) {
    if (boundaries.every((boundary) => Math.abs(boundary - candidate.time) >= 12)) boundaries.push(candidate.time);
    if (boundaries.length >= Math.min(8, Math.max(4, Math.round(duration / 30)))) break;
  }
  boundaries.sort((a, b) => a - b);
  const sections = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const values = signals.filter((point) => point.time >= start && point.time < end).map((point) => point.energy);
    return { id: `detected-${index}`, name: "", start, end, energy: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) };
  });
  const energyValues = sections.map((section) => section.energy);
  const high = quantile(energyValues, 0.7);
  const low = quantile(energyValues, 0.3);
  return sections.map((section, index) => ({
    ...section,
    name: index === 0 ? "OPEN" : index === sections.length - 1 ? "OUTRO" : section.energy >= high ? (index > sections.length / 2 ? "FINAL" : "PEAK") : section.energy <= low ? "BREAK" : SECTION_NAMES[Math.min(index, SECTION_NAMES.length - 1)],
  }));
}

export async function analyzeProject(
  file: File,
  _url: string,
  duration: number,
  assets: AnalysisAsset[],
  report: (value: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  report({ phase: "audio", progress: 0, message: "Opening the soundtrack" });
  const audio = await analyzeAudio(file, duration, report, signal);
  report({ phase: "footage", progress: 0, message: "Reading visual frames" });
  const footage = await analyzeFootage(file, duration, report, signal);
  const effects: EffectProfile[] = [];
  for (let index = 0; index < assets.length; index++) {
    report({ phase: "effects", progress: index / Math.max(1, assets.length), message: `Reading effect ${index + 1} of ${assets.length}` });
    effects.push(await analyzeEffect(assets[index], signal));
    report({ phase: "effects", progress: (index + 1) / Math.max(1, assets.length), message: `Profiled effect ${index + 1} of ${assets.length}` });
    await yieldFrame(signal);
  }
  report({ phase: "edit", progress: 0.6, message: "Finding musical sections" });
  const sections = detectSections(duration, audio.signals, footage.sceneCuts);
  report({ phase: "edit", progress: 1, message: "Building the edit map" });
  return {
    duration,
    bpm: audio.bpm,
    confidence: audio.confidence,
    beats: audio.beats,
    signals: audio.signals,
    visuals: footage.points,
    sceneCuts: footage.sceneCuts,
    sections,
    effects,
    framesAnalyzed: footage.points.length,
  };
}

export function suggestDirectorPattern(section: Pick<DirectorSection, "name" | "energy">, index: number, count: number): DirectorPattern {
  const name = section.name.toUpperCase();
  if (name.includes("BUILD")) return "build";
  if (name.includes("PEAK") || name.includes("CHORUS") || name.includes("FINAL") || section.energy >= 0.7) return "burst";
  if (name.includes("OUTRO") || name.includes("BREAK") || index === count - 1) return "release";
  if (name.includes("OPEN") || name.includes("INTRO") || index === 0) return "restrained";
  return "pulse";
}

function sectionBeatGrid(beats: number[], section: DirectorSection) {
  const base = beats.filter((beat) => beat >= section.start && beat < section.end);
  if (section.rhythm === "half") return base.filter((_, index) => index % 2 === 0);
  if (section.rhythm !== "double") return base;
  const doubled: number[] = [];
  for (let index = 0; index < base.length; index++) {
    doubled.push(base[index]);
    const next = base[index + 1];
    if (next != null) doubled.push((base[index] + next) / 2);
  }
  return doubled;
}

export function buildDirectedPlacements(
  result: AnalysisResult,
  assetIds: string[],
  intensity: "smooth" | "dynamic" | "maximum",
  directedSections: DirectorSection[] = result.sections,
): SmartPlacement[] {
  if (!assetIds.length) return [];
  const placements: SmartPlacement[] = [];
  const intensityFactor = intensity === "smooth" ? 0.72 : intensity === "maximum" ? 1.35 : 1;

  directedSections.forEach((section, sectionIndex) => {
    if (section.enabled === false) return;
    const pattern = section.pattern ?? suggestDirectorPattern(section, sectionIndex, directedSections.length);
    const grid = sectionBeatGrid(result.beats, section);
    if (!grid.length) return;
    const candidates = grid.map((beat, index) => {
      const signal = nearestSignal(result.signals, beat);
      const visual = result.visuals.length
        ? result.visuals.reduce((best, point) => Math.abs(point.time - beat) < Math.abs(best.time - beat) ? point : best, result.visuals[0])
        : undefined;
      const nearestCut = result.sceneCuts.reduce((distance, cut) => Math.min(distance, Math.abs(cut.time - beat)), Infinity);
      const cutAffinity = nearestCut < 0.18 ? 1 : nearestCut < 0.45 ? 0.55 : 0;
      const downbeat = index % 4 === 0 ? 1 : 0;
      const score = signal.onset * 0.4 + signal.energy * 0.24 + downbeat * 0.2 + cutAffinity * 0.11 + clamp(visual?.motion || 0) * 0.05;
      return { beat, index, signal, cutAffinity, score };
    });
    const strong = quantile(candidates.map((candidate) => candidate.score), intensity === "smooth" ? 0.72 : intensity === "maximum" ? 0.4 : 0.58);
    let selected = candidates.filter((candidate) => {
      const progress = candidate.index / Math.max(1, candidates.length - 1);
      if (pattern === "restrained") return candidate.index % Math.max(3, Math.round(4 / intensityFactor)) === 0 || candidate.cutAffinity === 1;
      if (pattern === "pulse") return candidate.index % Math.max(2, Math.round(3 / intensityFactor)) === 0 || candidate.score >= strong;
      if (pattern === "build") {
        const stride = progress > 0.72 ? 1 : progress > 0.38 ? 2 : 4;
        return candidate.index % Math.max(1, Math.round(stride / intensityFactor)) === 0;
      }
      if (pattern === "burst") {
        const cycle = intensity === "maximum" ? 6 : 8;
        const burstLength = intensity === "smooth" ? 2 : intensity === "maximum" ? 4 : 3;
        return candidate.index % cycle < burstLength || candidate.cutAffinity === 1;
      }
      return candidate.index === 0 || candidate.cutAffinity === 1 || (candidate.index % Math.max(4, Math.round(6 / intensityFactor)) === 0 && progress < 0.72);
    });
    if (!selected.length) selected = [candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best, candidates[0])];

    selected.forEach((candidate, selectedIndex) => {
      const profiles = result.effects.length ? result.effects : assetIds.map((assetId) => ({ assetId, peakTime: 0, sourceDuration: Infinity, brightness: 0.5, flashiness: 0.5, suggestedDuration: 0.3 }));
      const desiredFlash = pattern === "burst" ? 0.85 : pattern === "build" ? 0.62 : pattern === "release" ? 0.25 : 0.45;
      const ranked = [...profiles].sort((a, b) => Math.abs(a.flashiness - desiredFlash) - Math.abs(b.flashiness - desiredFlash));
      const profile = ranked[(selectedIndex + sectionIndex) % ranked.length];
      const assetId = assetIds.includes(profile.assetId) ? profile.assetId : assetIds[(selectedIndex + sectionIndex) % assetIds.length];
      const tailMultiplier = pattern === "release" ? 1.35 : pattern === "burst" ? 0.72 : 1;
      const tail = profile.suggestedDuration * tailMultiplier * (0.8 + candidate.signal.energy * 0.55);
      const maximumDuration = pattern === "release" ? 2 : 1.6;
      const desiredDuration = clamp(tail + Math.min(profile.peakTime, 0.35), 0.1, maximumDuration);
      const leadIn = Math.min(profile.peakTime, clamp(desiredDuration * 0.35, 0.04, 0.4));
      const start = Math.max(section.start, candidate.beat - leadIn, 0);
      const sourceStart = Math.max(0, profile.peakTime - (candidate.beat - start));
      const availableSource = profile.sourceDuration - sourceStart;
      const requiredPeakWindow = candidate.beat - start + tail;
      const requestedDuration = Math.max(section.duration ?? 0, requiredPeakWindow, 0.1);
      const patternScale = pattern === "restrained" ? -4 : pattern === "burst" ? 16 : pattern === "build" ? Math.round((candidate.index / candidates.length) * 14) : 4;
      placements.push({
        id: `directed-${section.id}-${candidate.index}-${assetId}`,
        assetId,
        sectionId: section.id,
        start,
        sourceStart,
        duration: Math.max(0.05, Math.min(section.end - start, result.duration - start, availableSource, requestedDuration, maximumDuration)),
        scale: section.scale ?? Math.round(104 + candidate.score * (intensity === "maximum" ? 42 : 30) + patternScale),
        opacity: Math.round(clamp(74 + candidate.score * 25 + (pattern === "burst" ? 4 : 0), 50, 100)),
      });
    });
  });
  return placements.sort((a, b) => a.start - b.start);
}

export function buildSmartPlacements(
  result: AnalysisResult,
  assetIds: string[],
  intensity: "smooth" | "dynamic" | "maximum",
): SmartPlacement[] {
  return buildDirectedPlacements(result, assetIds, intensity);
}
