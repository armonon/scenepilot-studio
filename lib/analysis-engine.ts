import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";

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
    if (!track) throw new Error("The main video has no decodable soundtrack.");
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
      report({ phase: "audio", progress: Math.min(0.95, (wrapped.timestamp + wrapped.duration) / duration), message: "Measuring transients and musical energy" });
      await yieldFrame(signal);
    }
    if (carry.length) processFrame(carry, 0, carry.length);
  } finally {
    input.dispose();
  }

  const frameRate = sampleRate / hopSize;
  const energy = normalize(rawEnergy);
  const onset = normalize(rawOnset);
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

  const signals = energy.map((value, index) => ({ time: index / frameRate, energy: value, onset: onset[index] }));
  const confidence = clamp(bestCorrelation / Math.max(1e-5, quantile(onset, 0.9) ** 2));
  return { bpm: bestBpm, beats: snappedBeats, signals, confidence };
}

function waitForMedia(target: HTMLMediaElement, event: "loadeddata" | "seeked", signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, done);
      signal?.removeEventListener("abort", aborted);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const aborted = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("Analysis canceled", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Media ${event} timed out`));
    }, 10000);
    target.addEventListener(event, done);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
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

async function analyzeFootage(url: string, duration: number, report: (value: AnalysisProgress) => void, signal?: AbortSignal) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  if (video.readyState < 2) await waitForMedia(video, "loadeddata", signal);
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas analysis is unavailable");
  const interval = Math.max(0.35, duration / 420);
  const points: VisualPoint[] = [];
  let previousGray: Uint8Array | undefined;
  let previousHistogram: Float32Array | undefined;

  for (let time = 0, frame = 0; time < duration; time += interval, frame++) {
    checkAborted(signal);
    if (Math.abs(video.currentTime - time) > 0.01) {
      video.currentTime = Math.min(time, Math.max(0, duration - 0.05));
      await waitForMedia(video, "seeked", signal);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const stats = frameStats(context.getImageData(0, 0, canvas.width, canvas.height).data, previousGray);
    let histogramDistance = 0;
    if (previousHistogram) {
      for (let index = 0; index < 16; index++) histogramDistance += Math.abs(stats.histogram[index] - previousHistogram[index]);
      histogramDistance /= 2;
    }
    points.push({ time, brightness: stats.brightness, motion: stats.difference, cutScore: histogramDistance * 0.62 + stats.difference * 0.38 });
    previousGray = stats.gray;
    previousHistogram = stats.histogram;
    if (frame % 12 === 0) {
      report({ phase: "footage", progress: Math.min(0.98, time / duration), message: `Inspecting frame ${frame + 1}` });
      await yieldFrame(signal);
    }
  }
  video.removeAttribute("src");
  video.load();
  const scores = points.slice(1).map((point) => point.cutScore);
  const center = median(scores);
  const deviation = median(scores.map((value) => Math.abs(value - center)));
  const threshold = center + Math.max(0.045, deviation * 3.2);
  const sceneCuts: SceneCut[] = [];
  for (const point of points) {
    if (point.cutScore < threshold || point.time - (sceneCuts.at(-1)?.time ?? -10) < 0.8) continue;
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
    const image = new Image();
    image.src = asset.url;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Image analysis failed")); });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    brightness.push(frameStats(context.getImageData(0, 0, canvas.width, canvas.height).data).brightness);
    times.push(0);
  } else {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = asset.url;
    if (video.readyState < 2) await waitForMedia(video, "loadeddata", signal);
    sourceDuration = video.duration || 1;
    const inspectDuration = Math.min(8, video.duration || 1);
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
  url: string,
  duration: number,
  assets: AnalysisAsset[],
  report: (value: AnalysisProgress) => void,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  report({ phase: "audio", progress: 0, message: "Opening the soundtrack" });
  const audio = await analyzeAudio(file, duration, report, signal);
  report({ phase: "footage", progress: 0, message: "Reading visual frames" });
  const footage = await analyzeFootage(url, duration, report, signal);
  const effects: EffectProfile[] = [];
  for (let index = 0; index < assets.length; index++) {
    report({ phase: "effects", progress: index / Math.max(1, assets.length), message: `Reading effect ${index + 1} of ${assets.length}` });
    effects.push(await analyzeEffect(assets[index], signal));
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

export function buildSmartPlacements(
  result: AnalysisResult,
  assetIds: string[],
  intensity: "smooth" | "dynamic" | "maximum",
): SmartPlacement[] {
  if (!assetIds.length) return [];
  const candidates = result.beats.map((beat, index) => {
    const signal = nearestSignal(result.signals, beat);
    const visual = result.visuals.reduce((best, point) => Math.abs(point.time - beat) < Math.abs(best.time - beat) ? point : best, result.visuals[0]);
    const nearestCut = result.sceneCuts.reduce((distance, cut) => Math.min(distance, Math.abs(cut.time - beat)), Infinity);
    const downbeat = index % 4 === 0 ? 1 : 0;
    const cutAffinity = nearestCut < 0.18 ? 1 : nearestCut < 0.45 ? 0.55 : 0;
    const score = signal.onset * 0.38 + signal.energy * 0.25 + downbeat * 0.2 + cutAffinity * 0.12 + clamp(visual?.motion || 0) * 0.05;
    return { beat, index, score, signal, visual, cutAffinity };
  });
  const density = intensity === "smooth" ? 0.18 : intensity === "dynamic" ? 0.42 : 0.7;
  const threshold = quantile(candidates.map((candidate) => candidate.score), 1 - density);
  const minimumGap = intensity === "smooth" ? 1.1 : intensity === "dynamic" ? 0.45 : 0.22;
  const placements: SmartPlacement[] = [];
  let lastTime = -Infinity;
  for (const candidate of candidates) {
    if (candidate.score < threshold || candidate.beat - lastTime < minimumGap) continue;
    const profileIndex = Math.floor((candidate.signal.energy + candidate.cutAffinity) * result.effects.length) % Math.max(1, result.effects.length);
    const profile = result.effects[profileIndex] ?? { assetId: assetIds[placements.length % assetIds.length], peakTime: 0, sourceDuration: Infinity, brightness: 0.5, flashiness: 0.5, suggestedDuration: 0.3 };
    const assetId = assetIds.includes(profile.assetId) ? profile.assetId : assetIds[placements.length % assetIds.length];
    const section = result.sections.find((item) => candidate.beat >= item.start && candidate.beat < item.end) ?? result.sections[0];
    const idealStart = candidate.beat - profile.peakTime;
    const sourceStart = Math.max(0, -idealStart);
    const start = Math.max(0, idealStart);
    const tail = profile.suggestedDuration * (0.8 + candidate.signal.energy * 0.55);
    const availableSource = profile.sourceDuration - sourceStart;
    placements.push({
      id: `smart-${candidate.index}-${assetId}`,
      assetId,
      sectionId: section?.id ?? "detected-0",
      start,
      sourceStart,
      duration: Math.min(result.duration - start, availableSource, clamp(profile.peakTime - sourceStart + tail, 0.1, 1.6)),
      scale: Math.round(104 + candidate.score * (intensity === "maximum" ? 52 : 34)),
      opacity: Math.round(78 + candidate.score * 22),
    });
    lastTime = candidate.beat;
  }
  return placements;
}
