import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
} from "mediabunny";

export type RenderAsset = {
  id: string;
  file: File;
  kind: "image" | "video";
};

export type RenderPlacement = {
  assetId: string;
  start: number;
  sourceStart?: number;
  duration: number;
  scale: number;
  opacity: number;
  trackId?: string;
};

export type RenderTrack = {
  id: string;
  enabled: boolean;
  blend: "screen" | "normal" | "overlay" | "multiply";
  opacity: number;
  hue: number;
  saturation: number;
  brightness: number;
  glow: number;
  color: string;
  fadeIn: number;
  fadeOut: number;
};

type RenderOptions = {
  mainFile: File;
  assets: RenderAsset[];
  placements: RenderPlacement[];
  tracks?: RenderTrack[];
  duration: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
};

function fitInside(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

function abortError(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

export async function renderProject({ mainFile, assets, placements, tracks = [], duration, signal, onProgress }: RenderOptions) {
  if (!("VideoEncoder" in window) || !("VideoDecoder" in window)) {
    throw new Error("This browser cannot render video yet. Open ScenePilot in a current Chrome or Edge browser.");
  }

  const inputs: Input[] = [];
  const bitmaps = new Map<string, ImageBitmap>();
  let output: Output | null = null;
  try {
    onProgress?.(0, "Opening source media");
    const mainInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(mainFile) });
    inputs.push(mainInput);
    const mainVideoTrack = await mainInput.getPrimaryVideoTrack();
    const audioTrack = await mainInput.getPrimaryAudioTrack();
    if (!mainVideoTrack && !audioTrack) throw new Error("The main file has no decodable audio or video track.");
    const sourceWidth = mainVideoTrack ? await mainVideoTrack.getDisplayWidth() : 1280;
    const sourceHeight = mainVideoTrack ? await mainVideoTrack.getDisplayHeight() : 720;
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(2, Math.round(sourceWidth * scale / 2) * 2);
    const height = Math.max(2, Math.round(sourceHeight * scale / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable.");

    const assetReaders = new Map<string, { sink: VideoSampleSink; duration: number }>();
    for (const asset of assets) {
      abortError(signal);
      if (asset.kind === "image") {
        bitmaps.set(asset.id, await createImageBitmap(asset.file));
        continue;
      }
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(asset.file) });
      inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      if (!track) continue;
      assetReaders.set(asset.id, {
        sink: new VideoSampleSink(track),
        duration: (await input.getDurationFromMetadata([track])) ?? await input.computeDuration([track]),
      });
    }

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH });
    output.addVideoTrack(videoSource, { frameRate: 24 });
    const audioSource = audioTrack ? new AudioSampleSource({ codec: "aac", bitrate: QUALITY_HIGH }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    if (audioTrack && audioSource) {
      onProgress?.(0.03, "Copying soundtrack");
      const sink = new AudioSampleSink(audioTrack);
      for await (const sample of sink.samples(0, duration)) {
        abortError(signal);
        await audioSource.add(sample);
        sample.close();
      }
    }

    const fps = 24;
    const frameDuration = 1 / fps;
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    const timestamps = Array.from({ length: frameCount }, (_, index) => index * frameDuration);
    const mainSamples = mainVideoTrack
      ? new VideoSampleSink(mainVideoTrack).samplesAtTimestamps(timestamps)[Symbol.asyncIterator]()
      : null;
    let frameIndex = 0;
    while (frameIndex < frameCount) {
      abortError(signal);
      const time = timestamps[frameIndex];
      const sample = mainSamples ? (await mainSamples.next()).value ?? null : null;
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      if (sample) {
        const box = fitInside(sample.displayWidth, sample.displayHeight, width, height);
        sample.draw(context, box.x, box.y, box.width, box.height);
        sample.close();
      }

      const active = placements
        .filter((placement) => time >= placement.start && time < placement.start + placement.duration)
        .sort((a, b) => tracks.findIndex((track) => track.id === a.trackId) - tracks.findIndex((track) => track.id === b.trackId));
      for (const placement of active) {
        const asset = assets.find((item) => item.id === placement.assetId);
        if (!asset) continue;
        const track = tracks.find((item) => item.id === placement.trackId);
        if (track?.enabled === false) continue;
        const clipTime = time - placement.start;
        const remaining = placement.duration - clipTime;
        const fadeIn = track?.fadeIn ? Math.min(1, clipTime / track.fadeIn) : 1;
        const fadeOut = track?.fadeOut ? Math.min(1, remaining / track.fadeOut) : 1;
        const zoom = placement.scale / 100;
        const drawWidth = width * zoom;
        const drawHeight = height * zoom;
        const x = (width - drawWidth) / 2;
        const y = (height - drawHeight) / 2;
        context.save();
        context.globalAlpha = placement.opacity / 100 * (track?.opacity ?? 100) / 100 * Math.min(fadeIn, fadeOut);
        context.globalCompositeOperation = track?.blend === "normal" ? "source-over" : track?.blend ?? "screen";
        context.filter = `hue-rotate(${track?.hue ?? 0}deg) saturate(${track?.saturation ?? 100}%) brightness(${track?.brightness ?? 100}%) drop-shadow(0 0 ${track?.glow ?? 0}px ${track?.color ?? "#ffffff"})`;
        if (asset.kind === "image") {
          const bitmap = bitmaps.get(asset.id);
          if (bitmap) context.drawImage(bitmap, x, y, drawWidth, drawHeight);
        } else {
          const reader = assetReaders.get(asset.id);
          if (reader) {
            const localTime = Math.min(reader.duration - 0.001, (placement.sourceStart ?? 0) + time - placement.start);
            const effectSample = await reader.sink.getSample(Math.max(0, localTime));
            if (effectSample) {
              effectSample.draw(context, x, y, drawWidth, drawHeight);
              effectSample.close();
            }
          }
        }
        context.restore();
      }

      await videoSource.add(time, frameDuration, { keyFrame: frameIndex % (fps * 2) === 0 });
      frameIndex++;
      if (frameIndex % 12 === 0 || frameIndex === frameCount) {
        onProgress?.(0.05 + (frameIndex / frameCount) * 0.92, `Rendering frame ${frameIndex.toLocaleString()} of ${frameCount.toLocaleString()}`);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }

    onProgress?.(0.98, "Finalizing MP4");
    await output.finalize();
    if (!target.buffer) throw new Error("The renderer produced an empty file.");
    onProgress?.(1, "Render complete");
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output && output.state !== "finalized" && output.state !== "canceled") await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    for (const bitmap of bitmaps.values()) bitmap.close();
    for (const input of inputs) input.dispose();
  }
}
