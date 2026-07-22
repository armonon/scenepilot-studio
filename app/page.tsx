"use client";

import {
  Activity,
  ChevronDown,
  Clock3,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  Maximize2,
  Music2,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Settings2,
  SkipBack,
  Sparkles,
  Split,
  Trash2,
  Undo2,
  Upload,
  Video,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { analyzeProject, buildDirectedPlacements, suggestDirectorPattern } from "../lib/analysis-engine";
import type { AnalysisProgress, AnalysisResult, DirectorPattern, RhythmRate } from "../lib/analysis-engine";
import { renderProject } from "../lib/render-engine";
import { loadProject, saveProject } from "../lib/project-store";

type MediaAsset = {
  id: string;
  name: string;
  file: File;
  url: string;
  kind: "image" | "video";
  color: string;
};

type SectionRule = {
  id: string;
  name: string;
  start: number;
  end: number;
  every: number;
  duration: number;
  scale: number;
  enabled: boolean;
  color: string;
  energy: number;
  rhythm: RhythmRate;
  pattern: DirectorPattern;
};

type Placement = {
  id: string;
  assetId: string;
  sectionId: string;
  start: number;
  sourceStart: number;
  duration: number;
  scale: number;
  opacity: number;
  trackId?: string;
};

type ClipTrack = {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  blend: "screen" | "normal" | "overlay" | "multiply";
  opacity: number;
  hue: number;
  saturation: number;
  brightness: number;
  glow: number;
  fadeIn: number;
  fadeOut: number;
};

const COLORS = ["#34d6c7", "#ff695d", "#c8ef4b", "#f7c84b", "#5eb8ff"];
const DEMO_BEATS = Array.from({ length: 360 }, (_, index) => index * 0.5);
const initialClipTracks: ClipTrack[] = [
  { id: "clip-track-1", name: "LIGHT HITS", color: COLORS[0], enabled: true, blend: "screen", opacity: 100, hue: 0, saturation: 110, brightness: 105, glow: 12, fadeIn: 0.03, fadeOut: 0.1 },
  { id: "clip-track-2", name: "OVERLAYS", color: COLORS[1], enabled: true, blend: "overlay", opacity: 82, hue: 0, saturation: 100, brightness: 100, glow: 0, fadeIn: 0.08, fadeOut: 0.18 },
];

const initialSections: SectionRule[] = [
  { id: "intro", name: "INTRO", start: 0, end: 24, every: 8, duration: 0.5, scale: 108, enabled: true, color: COLORS[0], energy: 0.2, rhythm: "half", pattern: "restrained" },
  { id: "verse", name: "VERSE 1", start: 24, end: 63, every: 8, duration: 0.75, scale: 115, enabled: true, color: COLORS[4], energy: 0.42, rhythm: "normal", pattern: "pulse" },
  { id: "chorus", name: "CHORUS", start: 63, end: 102, every: 4, duration: 0.5, scale: 128, enabled: true, color: COLORS[1], energy: 0.82, rhythm: "normal", pattern: "burst" },
  { id: "verse-2", name: "VERSE 2", start: 102, end: 141, every: 8, duration: 0.75, scale: 112, enabled: true, color: COLORS[2], energy: 0.48, rhythm: "normal", pattern: "pulse" },
  { id: "outro", name: "OUTRO", start: 141, end: 180, every: 12, duration: 1, scale: 120, enabled: true, color: COLORS[3], energy: 0.24, rhythm: "half", pattern: "release" },
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
}

function formatWait(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "estimating";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function makeBeatGrid(duration: number, bpm: number, offset: number) {
  const interval = 60 / Math.max(1, bpm);
  let first = offset;
  while (first < 0) first += interval;
  while (first >= interval) first -= interval;
  const grid: number[] = [];
  for (let time = first; time <= duration; time += interval) grid.push(time);
  return grid;
}

function buildSections(duration: number): SectionRule[] {
  const names = ["INTRO", "VERSE 1", "CHORUS", "VERSE 2", "OUTRO"];
  const ratios = [0, 0.13, 0.35, 0.57, 0.79, 1];
  return names.map((name, index) => {
    const energy = name === "CHORUS" ? 0.82 : name === "OUTRO" ? 0.24 : name === "INTRO" ? 0.2 : 0.45;
    return ({
    id: `${name.toLowerCase().replaceAll(" ", "-")}-${Date.now()}-${index}`,
    name,
    start: duration * ratios[index],
    end: duration * ratios[index + 1],
    every: name === "CHORUS" ? 4 : name === "OUTRO" ? 12 : 8,
    duration: name === "CHORUS" ? 0.5 : 0.75,
    scale: name === "CHORUS" ? 128 : 114,
    enabled: true,
    color: COLORS[index],
    energy,
    rhythm: name === "INTRO" || name === "OUTRO" ? "half" as const : "normal" as const,
    pattern: suggestDirectorPattern({ name, energy }, index, names.length),
  });
  });
}

function makePlacements(assets: MediaAsset[], beats: number[], sections: SectionRule[], tracks: ClipTrack[] = initialClipTracks): Placement[] {
  if (!assets.length) return [];
  const next: Placement[] = [];
  sections.forEach((section, sectionIndex) => {
    if (!section.enabled) return;
    const sectionBeats = beats.filter((beat) => beat >= section.start && beat < section.end);
    sectionBeats.forEach((beat, index) => {
      if (index % Math.max(1, section.every) !== 0) return;
      const asset = assets[(index / Math.max(1, section.every) + sectionIndex) % assets.length | 0];
      next.push({
        id: `${section.id}-${index}-${asset.id}`,
        assetId: asset.id,
        sectionId: section.id,
        start: beat,
        sourceStart: 0,
        duration: Math.min(section.duration, section.end - beat),
        scale: section.scale,
        opacity: 100,
        trackId: tracks[Math.max(0, assets.indexOf(asset)) % tracks.length]?.id,
      });
    });
  });
  return next;
}

function EffectLayer({ asset, placement, track, currentTime, playing }: { asset: MediaAsset; placement: Placement; track: ClipTrack; currentTime: number; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const localTime = (placement.sourceStart ?? 0) + currentTime - placement.start;
  useEffect(() => {
    const video = ref.current;
    if (!video || asset.kind !== "video") return;
    if (Math.abs(video.currentTime - localTime) > 0.09) video.currentTime = Math.max(0, localTime);
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [asset.kind, localTime, playing]);
  const clipTime = Math.max(0, currentTime - placement.start);
  const remaining = Math.max(0, placement.duration - clipTime);
  const fadeIn = track.fadeIn > 0 ? Math.min(1, clipTime / track.fadeIn) : 1;
  const fadeOut = track.fadeOut > 0 ? Math.min(1, remaining / track.fadeOut) : 1;
  const opacity = placement.opacity / 100 * track.opacity / 100 * Math.min(fadeIn, fadeOut);
  return (
    <div className="effect-preview" style={{ opacity, transform: `scale(${placement.scale / 100})`, mixBlendMode: track.blend, filter: `hue-rotate(${track.hue}deg) saturate(${track.saturation}%) brightness(${track.brightness}%) drop-shadow(0 0 ${track.glow}px ${track.color})` }}>
      {asset.kind === "image" ? <img src={asset.url} alt="" /> : <video ref={ref} src={asset.url} muted playsInline preload="auto" />}
    </div>
  );
}

type EditSnapshot = { sections: SectionRule[]; placements: Placement[]; clipTracks: ClipTrack[]; beats: number[]; bpm: number; beatOffset: number; selectedSectionId: string; selectedPlacementId: string | null; selectedTrackId: string };

export default function Home() {
  const videoRef = useRef<HTMLMediaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const renderAbortRef = useRef<AbortController | null>(null);
  const analysisRunRef = useRef(0);
  const analysisStartedRef = useRef(0);
  const urlsRef = useRef<string[]>([]);
  const historyRef = useRef<EditSnapshot[]>([]);
  const futureRef = useRef<EditSnapshot[]>([]);
  const tapTimesRef = useRef<number[]>([]);
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [mainUrl, setMainUrl] = useState("");
  const [mainName, setMainName] = useState("3-minute music video");
  const [duration, setDuration] = useState(180);
  const [currentTime, setCurrentTime] = useState(44.12);
  const [playing, setPlaying] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [sections, setSections] = useState<SectionRule[]>(initialSections);
  const [beats, setBeats] = useState<number[]>(DEMO_BEATS);
  const [bpm, setBpm] = useState(120);
  const [beatOffset, setBeatOffset] = useState(0);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [clipTracks, setClipTracks] = useState<ClipTrack[]>(initialClipTracks);
  const [selectedTrackId, setSelectedTrackId] = useState(initialClipTracks[0].id);
  const [draggingPlacementId, setDraggingPlacementId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState(initialSections[2].id);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState("Load a video or song to analyze its rhythm");
  const [activePanel, setActivePanel] = useState<"section" | "clip" | "track">("section");
  const [editorMode, setEditorMode] = useState<"auto" | "pro">("auto");
  const [autoEnergy, setAutoEnergy] = useState<"smooth" | "dynamic" | "maximum">("dynamic");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [analysisElapsed, setAnalysisElapsed] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const selectedSection = sections.find((item) => item.id === selectedSectionId) ?? sections[0];
  const selectedPlacement = placements.find((item) => item.id === selectedPlacementId) ?? null;
  const selectedTrack = clipTracks.find((item) => item.id === (selectedPlacement?.trackId ?? selectedTrackId)) ?? clipTracks[0];
  const activePlacements = placements.filter(
    (item) => currentTime >= item.start && currentTime < item.start + item.duration && clipTracks.find((track) => track.id === (item.trackId ?? clipTracks[0]?.id))?.enabled !== false,
  ).sort((a, b) => clipTracks.findIndex((track) => track.id === (a.trackId ?? clipTracks[0]?.id)) - clipTracks.findIndex((track) => track.id === (b.trackId ?? clipTracks[0]?.id)));
  const visibleBeats = useMemo(() => beats.filter((beat) => beat <= duration), [beats, duration]);
  const energyBars = useMemo(() => {
    if (!analysis?.signals.length) return Array.from({ length: 180 }, () => 8);
    return Array.from({ length: 180 }, (_, index) => {
      const start = Math.floor((index / 180) * analysis.signals.length);
      const end = Math.max(start + 1, Math.floor(((index + 1) / 180) * analysis.signals.length));
      const points = analysis.signals.slice(start, end);
      const level = Math.max(...points.map((point) => point.energy * 0.68 + point.onset * 0.32));
      return Math.round(8 + level * 88);
    });
  }, [analysis]);
  const overallAnalysisProgress = analysisProgress
    ? ({ audio: 0, footage: 25, effects: 70, edit: 88 }[analysisProgress.phase]
      + analysisProgress.progress * ({ audio: 25, footage: 45, effects: 18, edit: 12 }[analysisProgress.phase]))
    : 0;
  const analysisEta = overallAnalysisProgress >= 3
    ? analysisElapsed * (100 - overallAnalysisProgress) / overallAnalysisProgress
    : Number.NaN;
  const mainIsAudio = mainFile?.type.startsWith("audio/") ?? false;
  const directorArc = sections.map((section) => section.pattern.toUpperCase()).join("  /  ");
  useEffect(() => {
    urlsRef.current = [mainUrl, ...assets.map((asset) => asset.url)].filter(Boolean);
  }, [mainUrl, assets]);

  useEffect(() => () => {
    analysisAbortRef.current?.abort();
    renderAbortRef.current?.abort();
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!analyzing) return;
    analysisStartedRef.current = window.performance.now();
    const timer = window.setInterval(() => {
      setAnalysisElapsed((window.performance.now() - analysisStartedRef.current) / 1000);
    }, 250);
    return () => window.clearInterval(timer);
  }, [analyzing]);

  const snapshot = (): EditSnapshot => ({ sections, placements, clipTracks, beats, bpm, beatOffset, selectedSectionId, selectedPlacementId, selectedTrackId });
  const checkpoint = () => {
    historyRef.current = [...historyRef.current.slice(-49), structuredClone(snapshot())];
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };
  const restoreSnapshot = (value: EditSnapshot) => {
    setSections(value.sections);
    setPlacements(value.placements);
    setClipTracks(value.clipTracks);
    setBeats(value.beats);
    setBpm(value.bpm);
    setBeatOffset(value.beatOffset);
    setSelectedSectionId(value.selectedSectionId);
    setSelectedPlacementId(value.selectedPlacementId);
    setSelectedTrackId(value.selectedTrackId);
  };
  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(structuredClone(snapshot()));
    restoreSnapshot(previous);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(structuredClone(snapshot()));
    restoreSnapshot(next);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => setCurrentTime(video.currentTime);
    const ended = () => setPlaying(false);
    video.addEventListener("timeupdate", update);
    video.addEventListener("ended", ended);
    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("ended", ended);
    };
  }, [mainUrl, editorMode]);

  const loadMainMedia = (file?: File) => {
    if (!file || (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) || analyzing || rendering) return;
    analysisAbortRef.current?.abort();
    if (mainUrl) URL.revokeObjectURL(mainUrl);
    const url = URL.createObjectURL(file);
    const probe = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      const nextDuration = Number.isFinite(probe.duration) ? probe.duration : 180;
      setDuration(nextDuration);
      setSections(buildSections(nextDuration));
      setCurrentTime(0);
      setBeats(Array.from({ length: Math.ceil(nextDuration * 2) }, (_, index) => index * 0.5));
      setPlacements([]);
      setAnalysis(null);
      setStatus(file.type.startsWith("audio/")
        ? "Song ready. The engine will map its beats, energy, and musical sections."
        : "Source ready. The engine will inspect its audio and visual frames.");
    };
    setMainFile(file);
    setMainUrl(url);
    setMainName(file.name);
  };

  const addAssets = (files: FileList | File[]) => {
    if (analyzing || rendering) return;
    const incoming = Array.from(files)
      .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
      .map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        file,
        url: URL.createObjectURL(file),
        kind: file.type.startsWith("video/") ? ("video" as const) : ("image" as const),
        color: COLORS[(assets.length + index) % COLORS.length],
      }));
    if (!incoming.length) return;
    const next = [...assets, ...incoming];
    setAssets(next);
    setPlacements(editorMode === "auto" ? [] : makePlacements(next, visibleBeats, sections, clipTracks));
    setAnalysis(null);
    setStatus(`${incoming.length} effect${incoming.length === 1 ? "" : "s"} ready to be visually profiled.`);
  };

  const composeDirector = (result: AnalysisResult, rules: SectionRule[], grid = result.beats, intensity = autoEnergy): Placement[] => (
    buildDirectedPlacements(
      { ...result, beats: grid },
      assets.map((asset) => asset.id),
      intensity,
      rules,
    ).map((placement) => {
      const assetIndex = Math.max(0, assets.findIndex((asset) => asset.id === placement.assetId));
      return { ...placement, trackId: clipTracks[assetIndex % Math.max(1, clipTracks.length)]?.id };
    })
  );

  const runAnalysis = async (auto = false) => {
    if (!mainFile) {
      setStatus("Add a source video or song first so ScenePilot can inspect it.");
      mainInputRef.current?.click();
      return;
    }
    if (!assets.length) {
      setStatus("Add at least one effect so ScenePilot can inspect its visual peak.");
      assetInputRef.current?.click();
      return;
    }
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const run = ++analysisRunRef.current;
    setAnalysisElapsed(0);
    setAnalyzing(true);
    setStatus("Opening the real analysis engine...");
    try {
      const result = await analyzeProject(
        mainFile,
        mainUrl,
        duration,
        assets.map(({ id, file, url, kind }) => ({ id, file, url, kind })),
        (progress) => {
          if (run !== analysisRunRef.current) return;
          setAnalysisProgress(progress);
          setStatus(progress.message);
        },
        controller.signal,
      );
      if (run !== analysisRunRef.current) return;
      const detectedSections: SectionRule[] = result.sections.map((section, index) => ({
        id: section.id,
        name: section.name,
        start: section.start,
        end: section.end,
        every: section.energy > 0.68 ? 2 : section.energy > 0.4 ? 4 : 8,
        duration: section.energy > 0.68 ? 0.22 : 0.42,
        scale: Math.round(108 + section.energy * 28),
        enabled: true,
        color: COLORS[index % COLORS.length],
        energy: section.energy,
        rhythm: section.energy > 0.82 ? "double" : section.energy < 0.28 ? "half" : "normal",
        pattern: suggestDirectorPattern(section, index, result.sections.length),
      }));
      const smart = composeDirector(result, detectedSections);
      const next = auto ? smart : smart.map((placement) => {
        const section = detectedSections.find((item) => placement.start >= item.start && placement.start < item.end);
        const profile = result.effects.find((item) => item.assetId === placement.assetId);
        const peakWindow = Math.max(0.1, (profile?.peakTime ?? 0) - placement.sourceStart + 0.08);
        return section ? { ...placement, duration: Math.min(section.end - placement.start, Math.max(section.duration, peakWindow)), scale: section.scale } : placement;
      });
      checkpoint();
      setAnalysis(result);
      setBpm(result.bpm);
      setBeatOffset(0);
      setBeats(result.beats);
      setSections(detectedSections);
      setSelectedSectionId(detectedSections[0]?.id ?? selectedSectionId);
      setPlacements(next);
      setStatus(`${result.framesAnalyzed} frames, ${result.sceneCuts.length} cuts, ${result.beats.length} beats — ${next.length} placements built.`);
    } catch (error) {
      if (controller.signal.aborted) setStatus("Analysis canceled. Your current edit is unchanged.");
      else setStatus(error instanceof Error ? `Analysis stopped: ${error.message}` : "Analysis stopped because this media could not be decoded.");
    } finally {
      if (run === analysisRunRef.current) {
        setAnalyzing(false);
        setAnalysisProgress(null);
        analysisAbortRef.current = null;
      }
    }
  };

  const runAutoCut = async () => {
    if (!mainFile) {
      setStatus("Start with your main video or song.");
      mainInputRef.current?.click();
      return;
    }
    if (!assets.length) {
      setStatus("Add at least one strobe, light clip, or image.");
      assetInputRef.current?.click();
      return;
    }
    await runAnalysis(true);
  };

  const chooseAutoEnergy = (energy: "smooth" | "dynamic" | "maximum") => {
    setAutoEnergy(energy);
    if (!analysis) return;
    checkpoint();
    const next = composeDirector(analysis, sections, beats, energy);
    setPlacements(next);
    setStatus(`${energy.toUpperCase()} rebuilt from ${analysis.beats.length} measured beats and ${analysis.sceneCuts.length} scene cuts.`);
  };

  const rebuildPlacements = () => {
    checkpoint();
    const smart = analysis ? composeDirector(analysis, sections, beats) : null;
    const next = smart ? smart.filter((placement) => {
      const section = sections.find((item) => placement.start >= item.start && placement.start < item.end);
      return section?.enabled ?? false;
    }).map((placement) => {
      const section = sections.find((item) => placement.start >= item.start && placement.start < item.end);
      const profile = analysis?.effects.find((item) => item.assetId === placement.assetId);
      const peakWindow = Math.max(0.1, (profile?.peakTime ?? 0) - placement.sourceStart + 0.08);
      return section ? { ...placement, duration: Math.min(section.end - placement.start, Math.max(section.duration, peakWindow)), scale: section.scale } : placement;
    }) : makePlacements(assets, visibleBeats, sections, clipTracks);
    setPlacements(next);
    setSelectedPlacementId(null);
    setStatus(`${next.length} deliberate placements built across ${sections.length} sections.`);
  };

  const updateSection = (patch: Partial<SectionRule>) => {
    checkpoint();
    setSections((items) => items.map((item) => (item.id === selectedSectionId ? { ...item, ...patch } : item)));
  };

  const updatePlacement = (patch: Partial<Placement>) => {
    if (!selectedPlacementId) return;
    checkpoint();
    setPlacements((items) => items.map((item) => (item.id === selectedPlacementId ? { ...item, ...patch } : item)));
  };

  const addClipTrack = () => {
    checkpoint();
    const index = clipTracks.length;
    const track: ClipTrack = {
      id: `clip-track-${crypto.randomUUID()}`,
      name: `CLIP TRACK ${index + 1}`,
      color: COLORS[index % COLORS.length],
      enabled: true,
      blend: index % 2 ? "overlay" : "screen",
      opacity: 100,
      hue: 0,
      saturation: 100,
      brightness: 100,
      glow: 0,
      fadeIn: 0.05,
      fadeOut: 0.12,
    };
    setClipTracks((items) => [...items, track]);
    setSelectedTrackId(track.id);
    setSelectedPlacementId(null);
    setActivePanel("track");
    setStatus(`${track.name} added. Drag media or existing clips onto it.`);
  };

  const updateClipTrack = (patch: Partial<ClipTrack>) => {
    if (!selectedTrack) return;
    checkpoint();
    setClipTracks((items) => items.map((track) => track.id === selectedTrack.id ? { ...track, ...patch } : track));
  };

  const removeClipTrack = (trackId: string) => {
    if (clipTracks.length <= 1) return;
    checkpoint();
    const fallback = clipTracks.find((track) => track.id !== trackId);
    setClipTracks((items) => items.filter((track) => track.id !== trackId));
    setPlacements((items) => items.map((placement) => placement.trackId === trackId ? { ...placement, trackId: fallback?.id } : placement));
    setSelectedTrackId(fallback?.id ?? "");
    setSelectedPlacementId(null);
    setActivePanel("track");
  };

  const dropOnClipTrack = (event: DragEvent<HTMLDivElement>, trackId: string) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/x-scenepilot") || event.dataTransfer.getData("text/plain");
    if (!payload) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const start = Math.min(duration - 0.05, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * duration));
    checkpoint();
    if (payload.startsWith("placement:")) {
      const id = payload.slice("placement:".length);
      setPlacements((items) => items.map((placement) => {
        if (placement.id !== id) return placement;
        const nextStart = Math.max(0, Math.min(duration - placement.duration, start));
        const section = sections.find((item) => nextStart >= item.start && nextStart < item.end);
        return { ...placement, trackId, start: nextStart, sectionId: section?.id ?? placement.sectionId };
      }));
      setSelectedPlacementId(id);
      setSelectedTrackId(trackId);
      setActivePanel("clip");
      setStatus(`Clip moved to ${clipTracks.find((track) => track.id === trackId)?.name ?? "track"} at ${formatTime(start)}.`);
    } else if (payload.startsWith("asset:")) {
      const assetId = payload.slice("asset:".length);
      const section = sections.find((item) => start >= item.start && start < item.end) ?? sections[0];
      const placement: Placement = {
        id: `manual-${crypto.randomUUID()}`,
        assetId,
        sectionId: section?.id ?? "manual",
        trackId,
        start,
        sourceStart: 0,
        duration: Math.min(section?.duration ?? 0.5, duration - start),
        scale: section?.scale ?? 112,
        opacity: 100,
      };
      setPlacements((items) => [...items, placement].sort((a, b) => a.start - b.start));
      setSelectedPlacementId(placement.id);
      setSelectedTrackId(trackId);
      setActivePanel("clip");
      setStatus(`Media placed on ${clipTracks.find((track) => track.id === trackId)?.name ?? "track"} at ${formatTime(start)}.`);
    }
    setDraggingPlacementId(null);
  };

  const applyBeatGrid = (nextBpm: number, nextOffset: number) => {
    const roundedBpm = Math.round(Math.min(220, Math.max(50, nextBpm)) * 10) / 10;
    const nextBeats = makeBeatGrid(duration, roundedBpm, nextOffset);
    checkpoint();
    setBpm(roundedBpm);
    setBeatOffset(nextOffset);
    setBeats(nextBeats);
    if (analysis) setPlacements(composeDirector(analysis, sections, nextBeats));
    setStatus(`Beat grid set to ${roundedBpm} BPM with ${nextOffset >= 0 ? "+" : ""}${Math.round(nextOffset * 1000)} ms offset. Auto Director rebuilt the cut.`);
  };

  const tapTempo = (event: MouseEvent<HTMLButtonElement>) => {
    const now = event.timeStamp;
    const previous = tapTimesRef.current.at(-1);
    if (previous && now - previous > 2000) tapTimesRef.current = [];
    tapTimesRef.current = [...tapTimesRef.current.slice(-6), now];
    if (tapTimesRef.current.length < 2) {
      setStatus("Keep tapping the beat.");
      return;
    }
    const intervals = tapTimesRef.current.slice(1).map((time, index) => time - tapTimesRef.current[index]).sort((a, b) => a - b);
    const middle = intervals[Math.floor(intervals.length / 2)];
    applyBeatGrid(60000 / middle, beatOffset);
  };

  const resetBeatGrid = () => {
    if (!analysis) return;
    checkpoint();
    setBpm(analysis.bpm);
    setBeatOffset(0);
    setBeats(analysis.beats);
    setPlacements(composeDirector(analysis, sections, analysis.beats));
    setStatus(`Restored the measured ${analysis.bpm} BPM grid and rebuilt Auto Director.`);
  };

  const splitAtPlayhead = () => {
    const section = sections.find((item) => currentTime > item.start + 0.5 && currentTime < item.end - 0.5);
    if (!section) {
      setStatus("Move the playhead inside a section before splitting.");
      return;
    }
    checkpoint();
    const left = { ...section, end: currentTime };
    const right = { ...section, id: `${section.id}-split-${crypto.randomUUID()}`, name: `${section.name} B`, start: currentTime, color: COLORS[sections.length % COLORS.length] };
    const index = sections.indexOf(section);
    const next = [...sections.slice(0, index), left, right, ...sections.slice(index + 1)];
    setSections(next);
    setSelectedSectionId(right.id);
    setStatus(`Split ${section.name} at ${formatTime(currentTime)}. Give each half its own rhythm.`);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !mainUrl) {
      setPlaying((value) => !value);
      return;
    }
    if (video.paused) {
      await video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const seek = (time: number) => {
    setCurrentTime(time);
    if (videoRef.current) videoRef.current.currentTime = time;
  };

  const removeAsset = (id: string) => {
    if (analyzing || rendering) return;
    checkpoint();
    const target = assets.find((asset) => asset.id === id);
    if (target) URL.revokeObjectURL(target.url);
    setAssets((items) => items.filter((asset) => asset.id !== id));
    setPlacements((items) => items.filter((placement) => placement.assetId !== id));
    setAnalysis(null);
    setStatus("Effect removed. Analyze again to refresh its visual profile.");
  };

  const exportPlan = () => {
    const plan = {
      project: mainName,
      duration,
      bpm,
      beatOffset,
      beatCount: beats.length,
      analysis: analysis ? {
        tempoConfidence: analysis.confidence,
        framesAnalyzed: analysis.framesAnalyzed,
        sceneCuts: analysis.sceneCuts,
        effectProfiles: analysis.effects,
      } : null,
      sections,
      tracks: clipTracks,
      assets: assets.map(({ id, name, kind }) => ({ id, name, kind })),
      placements,
    };
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${mainName.replace(/\.[^/.]+$/, "") || "scenepilot"}-cut-plan.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const saveCurrentProject = async () => {
    if (!mainFile) {
      setStatus("Add a source video or song before saving this project.");
      return;
    }
    try {
      await saveProject<SectionRule, Placement, ClipTrack>({
        mainFile,
        assets: assets.map(({ id, name, file, kind, color }) => ({ id, name, file, kind, color })),
        duration,
        bpm,
        beatOffset,
        beats,
        sections,
        placements,
        tracks: clipTracks,
        analysis,
        autoEnergy,
        savedAt: Date.now(),
      });
      setStatus("Project saved locally with its source media and edit map.");
    } catch (error) {
      setStatus(error instanceof Error ? `Save failed: ${error.message}` : "This browser could not save the project.");
    }
  };

  const restoreCurrentProject = async () => {
    if (analyzing || rendering) return;
    try {
      const stored = await loadProject<SectionRule, Placement, ClipTrack>();
      if (!stored) {
        setStatus("No saved ScenePilot project was found in this browser.");
        return;
      }
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      const restoredMainUrl = URL.createObjectURL(stored.mainFile);
      const restoredAssets = stored.assets.map((asset) => ({ ...asset, url: URL.createObjectURL(asset.file) }));
      setMainFile(stored.mainFile);
      setMainUrl(restoredMainUrl);
      setMainName(stored.mainFile.name);
      setAssets(restoredAssets);
      setDuration(stored.duration);
      setBpm(stored.bpm);
      setBeatOffset(stored.beatOffset ?? 0);
      setBeats(stored.beats);
      const restoredSections = stored.sections.map((section, index) => ({
        ...section,
        energy: section.energy ?? stored.analysis?.sections[index]?.energy ?? 0.5,
        rhythm: section.rhythm ?? "normal" as const,
        pattern: section.pattern ?? suggestDirectorPattern({ name: section.name, energy: section.energy ?? 0.5 }, index, stored.sections.length),
      }));
      setSections(restoredSections);
      const restoredTracks = stored.tracks?.length ? stored.tracks : initialClipTracks;
      setClipTracks(restoredTracks);
      setPlacements(stored.placements.map((placement, index) => ({ ...placement, trackId: placement.trackId ?? restoredTracks[index % restoredTracks.length].id })));
      setAnalysis(stored.analysis);
      setAutoEnergy(stored.autoEnergy);
      setSelectedSectionId(restoredSections[0]?.id ?? "");
      setSelectedPlacementId(null);
      setSelectedTrackId(restoredTracks[0].id);
      setCurrentTime(0);
      historyRef.current = [];
      futureRef.current = [];
      setCanUndo(false);
      setCanRedo(false);
      setStatus(`Restored ${stored.placements.length} placements from your saved project.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Restore failed: ${error.message}` : "This browser could not restore the project.");
    }
  };

  const exportVideo = async () => {
    if (!mainFile || !placements.length || rendering) {
      setStatus("Analyze the source and build placements before rendering.");
      return;
    }
    const controller = new AbortController();
    renderAbortRef.current = controller;
    setRendering(true);
    setRenderProgress(0);
    try {
      const blob = await renderProject({
        mainFile,
        assets: assets.map(({ id, file, kind }) => ({ id, file, kind })),
        placements,
        tracks: clipTracks,
        duration,
        signal: controller.signal,
        onProgress: (progress, message) => {
          setRenderProgress(progress);
          setStatus(message);
        },
      });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${mainName.replace(/\.[^/.]+$/, "") || "scenepilot"}-scenepilot.mp4`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
      setStatus(`Rendered ${(blob.size / 1024 / 1024).toFixed(1)} MB MP4 with the original soundtrack.`);
    } catch (error) {
      if (controller.signal.aborted) setStatus("Render canceled. Your project is still intact.");
      else setStatus(error instanceof Error ? `Render failed: ${error.message}` : "The browser could not render this project.");
    } finally {
      setRendering(false);
      setRenderProgress(0);
      renderAbortRef.current = null;
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void previewRef.current?.requestFullscreen();
  };

  const dropMain = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    loadMainMedia(event.dataTransfer.files[0]);
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Scissors size={18} /></div>
          <div><strong>SCENEPILOT</strong><span>STUDIO</span></div>
        </div>
        <div className="project-title">
          <span className="status-dot" />
          <span>{mainName}</span>
          <ChevronDown size={14} />
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={restoreCurrentProject} disabled={analyzing || rendering} aria-label="Restore saved project" title="Restore project"><FolderOpen size={16} /></button>
          <button className="icon-button" onClick={saveCurrentProject} disabled={!mainFile || analyzing || rendering} aria-label="Save project" title="Save project"><Save size={16} /></button>
          <button className="icon-button" onClick={undo} disabled={!canUndo || analyzing || rendering} aria-label="Undo" title="Undo"><Undo2 size={16} /></button>
          <button className="icon-button" onClick={redo} disabled={!canRedo || analyzing || rendering} aria-label="Redo" title="Redo"><Redo2 size={16} /></button>
          <button className="export-button" onClick={exportVideo} disabled={!mainFile || !placements.length || analyzing || rendering}><Download size={16} /> {rendering ? `${Math.round(renderProgress * 100)}%` : "Render MP4"}</button>
        </div>
      </header>

      {analyzing && analysisProgress && (
        <section className="analysis-dock" aria-live="polite">
          <div className="analysis-dock-copy">
            <Activity size={15} />
            <span><strong>{Math.round(overallAnalysisProgress)}%</strong>{analysisProgress.message}</span>
          </div>
          <div className="analysis-dock-track"><i style={{ width: `${overallAnalysisProgress}%` }} /></div>
          <div className="analysis-dock-meta">
            <span>{analysisProgress.phase === "footage" ? "visuals" : analysisProgress.phase}</span>
            <span>{formatWait(analysisElapsed)} elapsed</span>
            <span>{formatWait(analysisEta)} left</span>
            <button onClick={() => analysisAbortRef.current?.abort()}>Cancel</button>
          </div>
        </section>
      )}

      {editorMode === "auto" ? (
        <section className="auto-screen">
          <div className="auto-heading">
            <span><Zap size={14} fill="currentColor" /> AUTO CUT</span>
            <h1>STROBES THAT HIT.</h1>
            <p>Upload the performance and the light. ScenePilot handles the rhythm.</p>
          </div>

          <div className="auto-workbench">
            <div
              ref={previewRef}
              className={`auto-preview ${dragActive ? "is-dragging" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={dropMain}
            >
              {mainUrl ? mainIsAudio ? (
                <>
                  <div className="audio-source-canvas"><Music2 size={34} /><strong>{mainName}</strong><div>{energyBars.slice(0, 54).map((height, index) => <i key={index} style={{ height: `${Math.max(12, height)}%` }} />)}</div></div>
                  <audio ref={(node) => { videoRef.current = node; }} src={mainUrl} preload="metadata" />
                </>
              ) : (
                <video ref={(node) => { videoRef.current = node; }} src={mainUrl} playsInline preload="metadata" />
              ) : (
                <button className="auto-preview-empty" onClick={() => mainInputRef.current?.click()}>
                  <Film size={42} />
                  <strong>DROP VIDEO OR SONG</strong>
                  <span>or choose a file</span>
                </button>
              )}
              {activePlacements.map((placement) => {
                const asset = assets.find((item) => item.id === placement.assetId);
                const track = clipTracks.find((item) => item.id === (placement.trackId ?? clipTracks[0]?.id));
                return asset && track ? <EffectLayer key={placement.id} asset={asset} placement={placement} track={track} currentTime={currentTime} playing={playing} /> : null;
              })}
              <div className="auto-preview-status"><span className={placements.length ? "ready" : ""} />{placements.length ? `${placements.length} HITS READY` : "WAITING FOR MEDIA"}</div>
              <button className="auto-preview-play" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
            </div>

            <div className="auto-controls">
              <div className="auto-media-row">
                <button className={mainUrl ? "loaded" : ""} disabled={analyzing || rendering} onClick={() => mainInputRef.current?.click()}>
                  <div>{mainUrl ? mainIsAudio ? <Music2 size={20} /> : <Video size={20} /> : <Upload size={20} />}</div>
                  <span><small>01 / SOURCE</small><strong>{mainUrl ? mainName : "Video or song"}</strong></span>
                  {mainUrl && <i>READY</i>}
                </button>
                <button className={assets.length ? "loaded" : ""} disabled={analyzing || rendering} onClick={() => assetInputRef.current?.click()}>
                  <div>{assets.length ? <Sparkles size={20} /> : <Plus size={20} />}</div>
                  <span><small>02 / EFFECTS</small><strong>{assets.length ? `${assets.length} light ${assets.length === 1 ? "clip" : "clips"}` : "Strobes & lights"}</strong></span>
                  {assets.length > 0 && <i>READY</i>}
                </button>
              </div>
              <input ref={mainInputRef} disabled={analyzing || rendering} hidden type="file" accept="video/*,audio/*" onChange={(event) => loadMainMedia(event.target.files?.[0])} />
              <input ref={assetInputRef} disabled={analyzing || rendering} hidden type="file" multiple accept="image/*,video/*" onChange={(event) => event.target.files && addAssets(event.target.files)} />

              <div className="energy-control">
                <div><small>03 / ENERGY</small><strong>How hard should it hit?</strong></div>
                <div className="energy-options">
                  <button className={autoEnergy === "smooth" ? "active" : ""} onClick={() => chooseAutoEnergy("smooth")}><i /><span>SMOOTH</span></button>
                  <button className={autoEnergy === "dynamic" ? "active" : ""} onClick={() => chooseAutoEnergy("dynamic")}><i /><i /><span>DYNAMIC</span></button>
                  <button className={autoEnergy === "maximum" ? "active" : ""} onClick={() => chooseAutoEnergy("maximum")}><i /><i /><i /><span>MAXIMUM</span></button>
                </div>
              </div>

              <div className="director-strip">
                <div><small>04 / AUTO DIRECTOR</small><strong>{analysis ? `${sections.length} musical sections shaped` : "Builds an intentional section arc"}</strong></div>
                <span>{analysis ? directorArc : "RESTRAINT  /  PULSE  /  BUILD  /  BURST  /  RELEASE"}</span>
              </div>

              <button className="auto-cut-button" onClick={analyzing ? () => analysisAbortRef.current?.abort() : runAutoCut} disabled={rendering}>
                {analyzing ? <Activity size={19} /> : <WandSparkles size={19} />}
                <span>{analyzing ? "CANCEL ANALYSIS" : placements.length ? "REMIX THE CUT" : "MAKE THE CUT"}</span>
              </button>

              {rendering && <div className="render-progress"><i style={{ width: `${renderProgress * 100}%` }} /><span>{Math.round(renderProgress * 100)}%</span><button onClick={() => renderAbortRef.current?.abort()}>Cancel render</button></div>}

              <div className="auto-readout">
                <span><Activity size={14} /><strong>{bpm}</strong> BPM</span>
                <span><Zap size={14} /><strong>{placements.length}</strong> HITS</span>
                {analysis && <span><Film size={14} /><strong>{analysis.framesAnalyzed}</strong> FRAMES</span>}
                {analysis && <span><Scissors size={14} /><strong>{analysis.sceneCuts.length}</strong> CUTS</span>}
                <p>{status}</p>
                {placements.length > 0 && <button onClick={exportPlan}><Download size={14} /> JSON plan</button>}
              </div>
            </div>
          </div>
        </section>
      ) : (
      <>
      <section className="workspace">
        <div className="monitor-column">
          <div
            ref={previewRef}
            className={`monitor ${dragActive ? "is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={dropMain}
          >
            {mainUrl ? mainIsAudio ? (
              <>
                <div className="audio-source-canvas"><Music2 size={34} /><strong>{mainName}</strong><div>{energyBars.slice(0, 54).map((height, index) => <i key={index} style={{ height: `${Math.max(12, height)}%` }} />)}</div></div>
                <audio ref={(node) => { videoRef.current = node; }} src={mainUrl} preload="metadata" />
              </>
            ) : (
              <video ref={(node) => { videoRef.current = node; }} src={mainUrl} playsInline preload="metadata" />
            ) : (
              <div className="empty-monitor">
                <div className="empty-reel"><Film size={36} /></div>
                <p>DROP YOUR VIDEO OR SONG</p>
                <span>Video or audio · media never leaves this browser</span>
                <button onClick={() => mainInputRef.current?.click()}><Upload size={16} /> Choose source</button>
              </div>
            )}
            {activePlacements.map((placement) => {
              const asset = assets.find((item) => item.id === placement.assetId);
              const track = clipTracks.find((item) => item.id === (placement.trackId ?? clipTracks[0]?.id));
              return asset && track ? <EffectLayer key={placement.id} asset={asset} placement={placement} track={track} currentTime={currentTime} playing={playing} /> : null;
            })}
            <div className="monitor-badge"><Activity size={13} /> {mainUrl ? "LIVE PREVIEW" : "LOCAL ENGINE READY"}</div>
            <input ref={mainInputRef} hidden type="file" accept="video/*,audio/*" onChange={(event) => loadMainMedia(event.target.files?.[0])} />
          </div>

          <div className="transport">
            <button className="icon-button" onClick={() => seek(Math.max(0, currentTime - 5))} aria-label="Back five seconds"><SkipBack size={17} /></button>
            <button className="play-button" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <div className="timecode"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(duration)}</span></div>
            <input className="scrubber" type="range" min="0" max={duration} step="0.01" value={currentTime} onChange={(event) => seek(Number(event.target.value))} />
            <span className="fps">24 FPS</span>
            <button className="icon-button" onClick={toggleFullscreen} aria-label="Fullscreen preview" title="Fullscreen"><Maximize2 size={16} /></button>
          </div>

          <div className="analysis-strip">
            <div><Zap size={15} /><strong>{visibleBeats.length}</strong><span>edit points</span></div>
            <div><Activity size={15} /><strong>{bpm}</strong><span>BPM</span></div>
            <div><Layers3 size={15} /><strong>{placements.length}</strong><span>placements</span></div>
            <p>{status}</p>
            <button className="analyze-button" onClick={analyzing ? () => analysisAbortRef.current?.abort() : () => runAnalysis(false)} disabled={rendering}><WandSparkles size={16} /> {analyzing ? "Cancel analysis" : "Analyze media"}</button>
          </div>

          <div className="beat-grid-panel">
            <div className="beat-grid-title"><Clock3 size={15} /><span><strong>Beat grid</strong><small>Correct the musical timing</small></span></div>
            <div className="beat-bpm-control">
              <button onClick={() => applyBeatGrid(bpm - 1, beatOffset)} aria-label="Decrease BPM">−</button>
              <strong>{bpm}</strong><span>BPM</span>
              <button onClick={() => applyBeatGrid(bpm + 1, beatOffset)} aria-label="Increase BPM">+</button>
            </div>
            <button className="tap-tempo" onClick={tapTempo}>TAP</button>
            <label className="beat-offset"><span>OFFSET</span><input type="range" min="-0.5" max="0.5" step="0.005" value={beatOffset} onChange={(event) => applyBeatGrid(bpm, Number(event.target.value))} /><strong>{beatOffset >= 0 ? "+" : ""}{Math.round(beatOffset * 1000)}ms</strong></label>
            <button className="icon-button" onClick={resetBeatGrid} disabled={!analysis} aria-label="Restore analyzed beat grid" title="Restore analyzed grid"><RefreshCw size={15} /></button>
          </div>
        </div>

        <aside className="control-column">
          <div className="panel-head">
            <div><Sparkles size={16} /><strong>Effect bin</strong><span>{assets.length} loaded</span></div>
            <button className="add-button" disabled={analyzing || rendering} onClick={() => assetInputRef.current?.click()}><Plus size={16} /> Add media</button>
            <input ref={assetInputRef} disabled={analyzing || rendering} hidden type="file" multiple accept="image/*,video/*" onChange={(event) => event.target.files && addAssets(event.target.files)} />
          </div>

          <div className="asset-bin">
            {assets.length ? assets.map((asset) => (
              <div className="asset-row" key={asset.id} draggable title="Drag onto a clip track" onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-scenepilot", `asset:${asset.id}`); }}>
                <div className="asset-thumb" style={{ borderColor: asset.color }}>
                  {asset.kind === "image" ? <img src={asset.url} alt="" /> : <video src={asset.url} muted />}
                  <span>{asset.kind === "image" ? <ImageIcon size={12} /> : <Video size={12} />}</span>
                </div>
                <div><strong>{asset.name}</strong><span>{asset.kind} · placed on beat</span></div>
                <button onClick={() => removeAsset(asset.id)} aria-label={`Remove ${asset.name}`}><X size={14} /></button>
              </div>
            )) : (
              <button className="asset-empty" onClick={() => assetInputRef.current?.click()}>
                <div><Plus size={20} /></div><strong>Add lights, flashes, textures</strong><span>Images or short video loops</span>
              </button>
            )}
          </div>

          <div className="panel-tabs" role="tablist">
            <button className={activePanel === "section" ? "active" : ""} onClick={() => setActivePanel("section")}><Split size={14} /> Section rule</button>
            <button className={activePanel === "clip" ? "active" : ""} onClick={() => setActivePanel("clip")} disabled={!selectedPlacement}><Clapperboard size={14} /> Clip override</button>
            <button className={activePanel === "track" ? "active" : ""} onClick={() => setActivePanel("track")} disabled={!selectedTrack}><Palette size={14} /> Track FX</button>
          </div>

          {activePanel === "section" && selectedSection && (
            <div className="inspector">
              <div className="inspector-title"><span style={{ background: selectedSection.color }} /><div><strong>{selectedSection.name}</strong><small>{formatTime(selectedSection.start)} — {formatTime(selectedSection.end)}</small></div><label className="switch"><input type="checkbox" checked={selectedSection.enabled} onChange={(event) => updateSection({ enabled: event.target.checked })} /><i /></label></div>
              <label className="field"><span>Director pattern</span><select className="director-select" value={selectedSection.pattern} onChange={(event) => updateSection({ pattern: event.target.value as DirectorPattern })}><option value="restrained">Restrained</option><option value="pulse">Pulse</option><option value="build">Build</option><option value="burst">Burst</option><option value="release">Release</option></select></label>
              <div className="field"><span>Rhythm rate</span><div className="rhythm-segments">{(["half", "normal", "double"] as const).map((rate) => <button key={rate} className={selectedSection.rhythm === rate ? "active" : ""} onClick={() => updateSection({ rhythm: rate })}>{rate === "half" ? "½" : rate === "double" ? "2×" : "1×"}</button>)}</div></div>
              <label className="field"><span>Effect duration</span><div className="value-line"><input type="range" min="0.1" max="4" step="0.05" value={selectedSection.duration} onChange={(event) => updateSection({ duration: Number(event.target.value) })} /><strong>{selectedSection.duration.toFixed(2)}s</strong></div></label>
              <label className="field"><span>Scale</span><div className="value-line"><input type="range" min="50" max="180" value={selectedSection.scale} onChange={(event) => updateSection({ scale: Number(event.target.value) })} /><strong>{selectedSection.scale}%</strong></div></label>
              <div className="inspector-actions"><button onClick={splitAtPlayhead}><Scissors size={15} /> Split at playhead</button><button className="primary" onClick={rebuildPlacements}><Sparkles size={15} /> Fill timeline</button></div>
            </div>
          )}

          {activePanel === "clip" && selectedPlacement && (
            <div className="inspector">
              <div className="inspector-title"><span className="clip-swatch" /><div><strong>Placement override</strong><small>{assets.find((asset) => asset.id === selectedPlacement.assetId)?.name}</small></div></div>
              <label className="field"><span>Clip track</span><select className="director-select" value={selectedPlacement.trackId ?? clipTracks[0]?.id} onChange={(event) => { setSelectedTrackId(event.target.value); updatePlacement({ trackId: event.target.value }); }}>{clipTracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
              <label className="field"><span>Start time</span><div className="value-line"><input type="range" min="0" max={duration} step="0.01" value={selectedPlacement.start} onChange={(event) => updatePlacement({ start: Number(event.target.value) })} /><strong>{formatTime(selectedPlacement.start)}</strong></div></label>
              <label className="field"><span>Duration</span><div className="value-line"><input type="range" min="0.1" max="6" step="0.05" value={selectedPlacement.duration} onChange={(event) => updatePlacement({ duration: Number(event.target.value) })} /><strong>{selectedPlacement.duration.toFixed(2)}s</strong></div></label>
              <label className="field"><span>Scale</span><div className="value-line"><input type="range" min="50" max="200" value={selectedPlacement.scale} onChange={(event) => updatePlacement({ scale: Number(event.target.value) })} /><strong>{selectedPlacement.scale}%</strong></div></label>
              <label className="field"><span>Opacity</span><div className="value-line"><input type="range" min="10" max="100" value={selectedPlacement.opacity} onChange={(event) => updatePlacement({ opacity: Number(event.target.value) })} /><strong>{selectedPlacement.opacity}%</strong></div></label>
              <button className="delete-placement" onClick={() => { checkpoint(); setPlacements((items) => items.filter((item) => item.id !== selectedPlacement.id)); setSelectedPlacementId(null); setActivePanel("section"); }}><Trash2 size={15} /> Remove placement</button>
            </div>
          )}

          {activePanel === "track" && selectedTrack && (
            <div className="inspector track-inspector">
              <div className="inspector-title"><span style={{ background: selectedTrack.color }} /><div><strong>{selectedTrack.name}</strong><small>{placements.filter((placement) => (placement.trackId ?? clipTracks[0]?.id) === selectedTrack.id).length} clips share this stack</small></div><label className="switch"><input type="checkbox" checked={selectedTrack.enabled} onChange={(event) => updateClipTrack({ enabled: event.target.checked })} /><i /></label></div>
              <label className="field"><span>Track name</span><input className="track-name-input" value={selectedTrack.name} maxLength={28} onChange={(event) => updateClipTrack({ name: event.target.value.toUpperCase() })} /></label>
              <label className="field"><span>Blend mode</span><select className="director-select" value={selectedTrack.blend} onChange={(event) => updateClipTrack({ blend: event.target.value as ClipTrack["blend"] })}><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="normal">Normal</option><option value="multiply">Multiply</option></select></label>
              <label className="field"><span>Track opacity</span><div className="value-line"><input type="range" min="0" max="100" value={selectedTrack.opacity} onChange={(event) => updateClipTrack({ opacity: Number(event.target.value) })} /><strong>{selectedTrack.opacity}%</strong></div></label>
              <label className="field"><span>Hue shift</span><div className="value-line"><input type="range" min="-180" max="180" value={selectedTrack.hue} onChange={(event) => updateClipTrack({ hue: Number(event.target.value) })} /><strong>{selectedTrack.hue}°</strong></div></label>
              <label className="field"><span>Color intensity</span><div className="value-line"><input type="range" min="0" max="220" value={selectedTrack.saturation} onChange={(event) => updateClipTrack({ saturation: Number(event.target.value) })} /><strong>{selectedTrack.saturation}%</strong></div></label>
              <label className="field"><span>Brightness</span><div className="value-line"><input type="range" min="20" max="200" value={selectedTrack.brightness} onChange={(event) => updateClipTrack({ brightness: Number(event.target.value) })} /><strong>{selectedTrack.brightness}%</strong></div></label>
              <label className="field"><span>Glow</span><div className="value-line"><input type="range" min="0" max="60" value={selectedTrack.glow} onChange={(event) => updateClipTrack({ glow: Number(event.target.value) })} /><strong>{selectedTrack.glow}px</strong></div></label>
              <div className="fade-fields"><label className="field"><span>Fade in</span><div className="value-line"><input type="range" min="0" max="2" step="0.01" value={selectedTrack.fadeIn} onChange={(event) => updateClipTrack({ fadeIn: Number(event.target.value) })} /><strong>{selectedTrack.fadeIn.toFixed(2)}s</strong></div></label><label className="field"><span>Fade out</span><div className="value-line"><input type="range" min="0" max="2" step="0.01" value={selectedTrack.fadeOut} onChange={(event) => updateClipTrack({ fadeOut: Number(event.target.value) })} /><strong>{selectedTrack.fadeOut.toFixed(2)}s</strong></div></label></div>
              <button className="delete-placement" disabled={clipTracks.length <= 1} onClick={() => removeClipTrack(selectedTrack.id)}><Trash2 size={15} /> Remove clip track</button>
            </div>
          )}
        </aside>
      </section>

      <section className="timeline-wrap">
        <div className="timeline-toolbar">
          <div><Settings2 size={15} /><strong>Arrangement</strong><span>{clipTracks.length} clip tracks · layered compositing</span></div>
          <div className="timeline-legend"><span><i className="beat-legend" />Beat</span><span><i className="fx-legend" />Clip</span><span><i className="scene-legend" />Section</span><button className="track-add-button" onClick={addClipTrack}><Plus size={14} /> Add track</button></div>
        </div>
        <div className="timeline-scroll">
          <div className="timeline" style={{ minWidth: Math.max(980, duration * 7), height: 211 + clipTracks.length * 60 }}>
            <div className="section-lane">
              <div className="track-label"><Split size={15} /><span>SECTIONS</span></div>
              <div className="track-content">
                {sections.map((section) => (
                  <button key={section.id} className={`section-block ${section.id === selectedSectionId ? "selected" : ""}`} style={{ left: `${(section.start / duration) * 100}%`, width: `${((section.end - section.start) / duration) * 100}%`, borderColor: section.color, color: section.color }} onClick={() => { setSelectedSectionId(section.id); setActivePanel("section"); }}><span>{section.name}</span><small>{section.pattern} · {section.rhythm === "half" ? "½×" : section.rhythm === "double" ? "2×" : "1×"}</small></button>
                ))}
              </div>
            </div>
            <div className="ruler-lane">
              <div className="track-label"><Activity size={15} /><span>BEATS</span></div>
              <div className="track-content">
                {visibleBeats.map((beat, index) => <i key={`${beat}-${index}`} className={index % 4 === 0 ? "major-beat" : "beat"} style={{ left: `${(beat / duration) * 100}%` }} />)}
                {analysis?.sceneCuts.map((cut, index) => <i key={`scene-${index}`} className="scene-marker" style={{ left: `${(cut.time / duration) * 100}%`, opacity: 0.45 + cut.confidence * 0.55 }} title={`Detected scene cut at ${formatTime(cut.time)}`} />)}
                {Array.from({ length: Math.floor(duration / 15) + 1 }, (_, index) => index * 15).map((time) => <span className="ruler-time" key={time} style={{ left: `${(time / duration) * 100}%` }}>{formatTime(time).slice(0, 5)}</span>)}
              </div>
            </div>
            <div className="video-lane">
              <div className="track-label">{mainIsAudio ? <Music2 size={15} /> : <Film size={15} />}<span>{mainIsAudio ? "SOURCE AUDIO" : "MAIN VIDEO"}</span></div>
              <div className="track-content"><div className="main-clip"><div className="clip-stripes" /><strong>{mainName}</strong><span>{formatTime(duration)}</span></div></div>
            </div>
            {clipTracks.map((track) => (
              <div className={`clip-track-lane ${track.enabled ? "" : "disabled"}`} key={track.id}>
                <div className={`track-label clip-track-label ${selectedTrack?.id === track.id ? "selected" : ""}`} style={{ borderLeftColor: track.color }}>
                  <button onClick={() => { setSelectedTrackId(track.id); setSelectedPlacementId(null); setActivePanel("track"); }}><Layers3 size={14} /><span>{track.name}</span><small>{track.blend} · {track.opacity}%</small></button>
                  {clipTracks.length > 1 && <button className="track-remove" onClick={() => removeClipTrack(track.id)} aria-label={`Remove ${track.name}`} title="Remove track"><X size={12} /></button>}
                </div>
                <div className="track-content clip-drop-zone" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = draggingPlacementId ? "move" : "copy"; }} onDrop={(event) => dropOnClipTrack(event, track.id)}>
                  {placements.filter((placement) => (placement.trackId ?? clipTracks[0]?.id) === track.id).map((placement) => {
                    const asset = assets.find((item) => item.id === placement.assetId);
                    return <button draggable key={placement.id} className={`effect-block ${placement.id === selectedPlacementId ? "selected" : ""} ${placement.id === draggingPlacementId ? "dragging" : ""}`} style={{ left: `${(placement.start / duration) * 100}%`, width: `${Math.max(0.38, (placement.duration / duration) * 100)}%`, background: asset?.color ?? track.color }} title={`${asset?.name} · ${formatTime(placement.start)} · ${placement.duration.toFixed(2)}s`} onDragStart={(event) => { setDraggingPlacementId(placement.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-scenepilot", `placement:${placement.id}`); }} onDragEnd={() => setDraggingPlacementId(null)} onClick={() => { setSelectedPlacementId(placement.id); setSelectedTrackId(track.id); setSelectedSectionId(placement.sectionId); setActivePanel("clip"); seek(placement.start); }}><span>{asset?.name.slice(0, 12)}</span></button>;
                  })}
                </div>
              </div>
            ))}
            <div className="energy-lane">
              <div className="track-label"><Zap size={15} /><span>ENERGY</span></div>
              <div className="track-content"><div className={`waveform ${analysis ? "measured" : ""}`}>{energyBars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>
            </div>
            <div className="playhead" style={{ left: `calc(132px + (100% - 132px) * ${currentTime / duration})` }}><i /><span>{formatTime(currentTime)}</span></div>
          </div>
        </div>
      </section>
      </>
      )}

      <footer className="mode-dock">
        <div>
          <span>{editorMode === "auto" ? "Want to shape every section?" : "Done arranging?"}</span>
          <strong>{editorMode === "auto" ? "Switch on the full timeline and clip controls." : "Return to the one-click cut."}</strong>
        </div>
        <label className="mode-toggle">
          <span>AUTO</span>
          <input type="checkbox" disabled={analyzing || rendering} checked={editorMode === "pro"} onChange={(event) => setEditorMode(event.target.checked ? "pro" : "auto")} />
          <i />
          <span>PRO ARRANGEMENT</span>
        </label>
      </footer>
    </main>
  );
}
