"use client";

import {
  Activity,
  ChevronDown,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Layers3,
  Maximize2,
  Pause,
  Play,
  Plus,
  Redo2,
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
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { analyzeProject, buildSmartPlacements } from "../lib/analysis-engine";
import type { AnalysisProgress, AnalysisResult } from "../lib/analysis-engine";

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
};

type Placement = {
  id: string;
  assetId: string;
  sectionId: string;
  start: number;
  duration: number;
  scale: number;
  opacity: number;
};

const COLORS = ["#34d6c7", "#ff695d", "#c8ef4b", "#f7c84b", "#5eb8ff"];
const DEMO_BEATS = Array.from({ length: 360 }, (_, index) => index * 0.5);

const initialSections: SectionRule[] = [
  { id: "intro", name: "INTRO", start: 0, end: 24, every: 8, duration: 0.5, scale: 108, enabled: true, color: COLORS[0] },
  { id: "verse", name: "VERSE 1", start: 24, end: 63, every: 8, duration: 0.75, scale: 115, enabled: true, color: COLORS[4] },
  { id: "chorus", name: "CHORUS", start: 63, end: 102, every: 4, duration: 0.5, scale: 128, enabled: true, color: COLORS[1] },
  { id: "verse-2", name: "VERSE 2", start: 102, end: 141, every: 8, duration: 0.75, scale: 112, enabled: true, color: COLORS[2] },
  { id: "outro", name: "OUTRO", start: 141, end: 180, every: 12, duration: 1, scale: 120, enabled: true, color: COLORS[3] },
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
}

function buildSections(duration: number): SectionRule[] {
  const names = ["INTRO", "VERSE 1", "CHORUS", "VERSE 2", "OUTRO"];
  const ratios = [0, 0.13, 0.35, 0.57, 0.79, 1];
  return names.map((name, index) => ({
    id: `${name.toLowerCase().replaceAll(" ", "-")}-${Date.now()}-${index}`,
    name,
    start: duration * ratios[index],
    end: duration * ratios[index + 1],
    every: name === "CHORUS" ? 4 : name === "OUTRO" ? 12 : 8,
    duration: name === "CHORUS" ? 0.5 : 0.75,
    scale: name === "CHORUS" ? 128 : 114,
    enabled: true,
    color: COLORS[index],
  }));
}

function makePlacements(assets: MediaAsset[], beats: number[], sections: SectionRule[]): Placement[] {
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
        duration: Math.min(section.duration, section.end - beat),
        scale: section.scale,
        opacity: 100,
      });
    });
  });
  return next;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
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
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState(initialSections[2].id);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState("Load a source video to analyze its rhythm");
  const [activePanel, setActivePanel] = useState<"section" | "clip">("section");
  const [editorMode, setEditorMode] = useState<"auto" | "pro">("auto");
  const [autoEnergy, setAutoEnergy] = useState<"smooth" | "dynamic" | "maximum">("dynamic");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);

  const selectedSection = sections.find((item) => item.id === selectedSectionId) ?? sections[0];
  const selectedPlacement = placements.find((item) => item.id === selectedPlacementId) ?? null;
  const activePlacement = placements.find(
    (item) => currentTime >= item.start && currentTime < item.start + item.duration,
  );
  const activeAsset = activePlacement ? assets.find((asset) => asset.id === activePlacement.assetId) : null;
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

  useEffect(() => {
    return () => {
      if (mainUrl) URL.revokeObjectURL(mainUrl);
      assets.forEach((asset) => URL.revokeObjectURL(asset.url));
    };
  }, []); // URLs are intentionally released only when the editor unmounts.

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

  const loadMainVideo = (file?: File) => {
    if (!file || !file.type.startsWith("video/")) return;
    if (mainUrl) URL.revokeObjectURL(mainUrl);
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
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
      setStatus("Source ready. The engine will inspect its audio and visual frames.");
    };
    setMainFile(file);
    setMainUrl(url);
    setMainName(file.name);
  };

  const addAssets = (files: FileList | File[]) => {
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
    setPlacements(editorMode === "auto" ? [] : makePlacements(next, visibleBeats, sections));
    setAnalysis(null);
    setStatus(`${incoming.length} effect${incoming.length === 1 ? "" : "s"} ready to be visually profiled.`);
  };

  const runAnalysis = async (auto = false) => {
    if (!mainFile) {
      setStatus("Add the main video first so ScenePilot can inspect it.");
      mainInputRef.current?.click();
      return;
    }
    if (!assets.length) {
      setStatus("Add at least one effect so ScenePilot can inspect its visual peak.");
      assetInputRef.current?.click();
      return;
    }
    setAnalyzing(true);
    setStatus("Opening the real analysis engine...");
    try {
      const result = await analyzeProject(
        mainFile,
        mainUrl,
        duration,
        assets.map(({ id, file, url, kind }) => ({ id, file, url, kind })),
        (progress) => {
          setAnalysisProgress(progress);
          setStatus(progress.message);
        },
      );
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
      }));
      const next = auto
        ? buildSmartPlacements(result, assets.map((asset) => asset.id), autoEnergy)
        : makePlacements(assets, result.beats, detectedSections);
      setAnalysis(result);
      setBpm(result.bpm);
      setBeats(result.beats);
      setSections(detectedSections);
      setSelectedSectionId(detectedSections[0]?.id ?? selectedSectionId);
      setPlacements(next);
      setStatus(`${result.framesAnalyzed} frames, ${result.sceneCuts.length} cuts, ${result.beats.length} beats — ${next.length} placements built.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Analysis stopped: ${error.message}` : "Analysis stopped because this media could not be decoded.");
    } finally {
      setAnalyzing(false);
      setAnalysisProgress(null);
    }
  };

  const runAutoCut = async () => {
    if (!mainFile) {
      setStatus("Start with your main music video.");
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
    const next = buildSmartPlacements(analysis, assets.map((asset) => asset.id), energy);
    setPlacements(next);
    setStatus(`${energy.toUpperCase()} rebuilt from ${analysis.beats.length} measured beats and ${analysis.sceneCuts.length} scene cuts.`);
  };

  const rebuildPlacements = () => {
    const next = makePlacements(assets, visibleBeats, sections);
    setPlacements(next);
    setSelectedPlacementId(null);
    setStatus(`${next.length} deliberate placements built across ${sections.length} sections.`);
  };

  const updateSection = (patch: Partial<SectionRule>) => {
    setSections((items) => items.map((item) => (item.id === selectedSectionId ? { ...item, ...patch } : item)));
  };

  const updatePlacement = (patch: Partial<Placement>) => {
    if (!selectedPlacementId) return;
    setPlacements((items) => items.map((item) => (item.id === selectedPlacementId ? { ...item, ...patch } : item)));
  };

  const splitAtPlayhead = () => {
    const section = sections.find((item) => currentTime > item.start + 0.5 && currentTime < item.end - 0.5);
    if (!section) {
      setStatus("Move the playhead inside a section before splitting.");
      return;
    }
    const left = { ...section, end: currentTime };
    const right = { ...section, id: `${section.id}-split-${Date.now()}`, name: `${section.name} B`, start: currentTime, color: COLORS[sections.length % COLORS.length] };
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
      beatCount: beats.length,
      analysis: analysis ? {
        tempoConfidence: analysis.confidence,
        framesAnalyzed: analysis.framesAnalyzed,
        sceneCuts: analysis.sceneCuts,
        effectProfiles: analysis.effects,
      } : null,
      sections,
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

  const dropMain = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    loadMainVideo(event.dataTransfer.files[0]);
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
          <button className="icon-button" aria-label="Undo" title="Undo"><Undo2 size={16} /></button>
          <button className="icon-button" aria-label="Redo" title="Redo"><Redo2 size={16} /></button>
          <button className="export-button" onClick={exportPlan}><Download size={16} /> Export plan</button>
        </div>
      </header>

      {editorMode === "auto" ? (
        <section className="auto-screen">
          <div className="auto-heading">
            <span><Zap size={14} fill="currentColor" /> AUTO CUT</span>
            <h1>STROBES THAT HIT.</h1>
            <p>Upload the performance and the light. ScenePilot handles the rhythm.</p>
          </div>

          <div className="auto-workbench">
            <div
              className={`auto-preview ${dragActive ? "is-dragging" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={dropMain}
            >
              {mainUrl ? (
                <video ref={videoRef} src={mainUrl} playsInline preload="metadata" />
              ) : (
                <button className="auto-preview-empty" onClick={() => mainInputRef.current?.click()}>
                  <Film size={42} />
                  <strong>DROP MAIN VIDEO</strong>
                  <span>or choose a file</span>
                </button>
              )}
              {activeAsset && activePlacement && (
                <div className="effect-preview" style={{ opacity: activePlacement.opacity / 100, transform: `scale(${activePlacement.scale / 100})` }}>
                  {activeAsset.kind === "image" ? <img src={activeAsset.url} alt="" /> : <video src={activeAsset.url} autoPlay muted loop playsInline />}
                </div>
              )}
              <div className="auto-preview-status"><span className={placements.length ? "ready" : ""} />{placements.length ? `${placements.length} HITS READY` : "WAITING FOR MEDIA"}</div>
              <button className="auto-preview-play" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
            </div>

            <div className="auto-controls">
              <div className="auto-media-row">
                <button className={mainUrl ? "loaded" : ""} onClick={() => mainInputRef.current?.click()}>
                  <div>{mainUrl ? <Video size={20} /> : <Upload size={20} />}</div>
                  <span><small>01 / SOURCE</small><strong>{mainUrl ? mainName : "Main video"}</strong></span>
                  {mainUrl && <i>READY</i>}
                </button>
                <button className={assets.length ? "loaded" : ""} onClick={() => assetInputRef.current?.click()}>
                  <div>{assets.length ? <Sparkles size={20} /> : <Plus size={20} />}</div>
                  <span><small>02 / EFFECTS</small><strong>{assets.length ? `${assets.length} light ${assets.length === 1 ? "clip" : "clips"}` : "Strobes & lights"}</strong></span>
                  {assets.length > 0 && <i>READY</i>}
                </button>
              </div>
              <input ref={mainInputRef} hidden type="file" accept="video/*" onChange={(event) => loadMainVideo(event.target.files?.[0])} />
              <input ref={assetInputRef} hidden type="file" multiple accept="image/*,video/*" onChange={(event) => event.target.files && addAssets(event.target.files)} />

              <div className="energy-control">
                <div><small>03 / ENERGY</small><strong>How hard should it hit?</strong></div>
                <div className="energy-options">
                  <button className={autoEnergy === "smooth" ? "active" : ""} onClick={() => chooseAutoEnergy("smooth")}><i /><span>SMOOTH</span></button>
                  <button className={autoEnergy === "dynamic" ? "active" : ""} onClick={() => chooseAutoEnergy("dynamic")}><i /><i /><span>DYNAMIC</span></button>
                  <button className={autoEnergy === "maximum" ? "active" : ""} onClick={() => chooseAutoEnergy("maximum")}><i /><i /><i /><span>MAXIMUM</span></button>
                </div>
              </div>

              {analyzing && analysisProgress && (
                <div className="analysis-progress" aria-live="polite">
                  <div className="analysis-phase">
                    {(["audio", "footage", "effects", "edit"] as const).map((phase) => (
                      <span key={phase} className={phase === analysisProgress.phase ? "active" : ""}>{phase}</span>
                    ))}
                  </div>
                  <div className="analysis-progress-track"><i style={{ width: `${overallAnalysisProgress}%` }} /></div>
                  <p>{analysisProgress.message}</p>
                </div>
              )}

              <button className="auto-cut-button" onClick={runAutoCut} disabled={analyzing}>
                {analyzing ? <Activity size={19} /> : <WandSparkles size={19} />}
                <span>{analyzing ? "LISTENING TO THE TRACK..." : placements.length ? "REMIX THE CUT" : "MAKE THE CUT"}</span>
              </button>

              <div className="auto-readout">
                <span><Activity size={14} /><strong>{bpm}</strong> BPM</span>
                <span><Zap size={14} /><strong>{placements.length}</strong> HITS</span>
                {analysis && <span><Film size={14} /><strong>{analysis.framesAnalyzed}</strong> FRAMES</span>}
                {analysis && <span><Scissors size={14} /><strong>{analysis.sceneCuts.length}</strong> CUTS</span>}
                <p>{status}</p>
                {placements.length > 0 && <button onClick={exportPlan}><Download size={14} /> Export</button>}
              </div>
            </div>
          </div>
        </section>
      ) : (
      <>
      <section className="workspace">
        <div className="monitor-column">
          <div
            className={`monitor ${dragActive ? "is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={dropMain}
          >
            {mainUrl ? (
              <video ref={videoRef} src={mainUrl} playsInline preload="metadata" />
            ) : (
              <div className="empty-monitor">
                <div className="empty-reel"><Film size={36} /></div>
                <p>DROP YOUR MAIN VIDEO</p>
                <span>MP4, MOV, WebM · media never leaves this browser</span>
                <button onClick={() => mainInputRef.current?.click()}><Upload size={16} /> Choose video</button>
              </div>
            )}
            {activeAsset && activePlacement && (
              <div className="effect-preview" style={{ opacity: activePlacement.opacity / 100, transform: `scale(${activePlacement.scale / 100})` }}>
                {activeAsset.kind === "image" ? <img src={activeAsset.url} alt="" /> : <video src={activeAsset.url} autoPlay muted loop playsInline />}
              </div>
            )}
            <div className="monitor-badge"><Activity size={13} /> {mainUrl ? "LIVE PREVIEW" : "LOCAL ENGINE READY"}</div>
            <input ref={mainInputRef} hidden type="file" accept="video/*" onChange={(event) => loadMainVideo(event.target.files?.[0])} />
          </div>

          <div className="transport">
            <button className="icon-button" onClick={() => seek(Math.max(0, currentTime - 5))} aria-label="Back five seconds"><SkipBack size={17} /></button>
            <button className="play-button" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <div className="timecode"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(duration)}</span></div>
            <input className="scrubber" type="range" min="0" max={duration} step="0.01" value={currentTime} onChange={(event) => seek(Number(event.target.value))} />
            <span className="fps">24 FPS</span>
            <button className="icon-button" aria-label="Fullscreen preview" title="Fullscreen"><Maximize2 size={16} /></button>
          </div>

          <div className="analysis-strip">
            <div><Zap size={15} /><strong>{visibleBeats.length}</strong><span>edit points</span></div>
            <div><Activity size={15} /><strong>{bpm}</strong><span>BPM</span></div>
            <div><Layers3 size={15} /><strong>{placements.length}</strong><span>placements</span></div>
            <p>{status}</p>
            <button className="analyze-button" onClick={() => runAnalysis(false)} disabled={analyzing}><WandSparkles size={16} /> {analyzing ? "Analyzing..." : "Analyze media"}</button>
          </div>
        </div>

        <aside className="control-column">
          <div className="panel-head">
            <div><Sparkles size={16} /><strong>Effect bin</strong><span>{assets.length} loaded</span></div>
            <button className="add-button" onClick={() => assetInputRef.current?.click()}><Plus size={16} /> Add media</button>
            <input ref={assetInputRef} hidden type="file" multiple accept="image/*,video/*" onChange={(event) => event.target.files && addAssets(event.target.files)} />
          </div>

          <div className="asset-bin">
            {assets.length ? assets.map((asset) => (
              <div className="asset-row" key={asset.id}>
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
          </div>

          {activePanel === "section" && selectedSection && (
            <div className="inspector">
              <div className="inspector-title"><span style={{ background: selectedSection.color }} /><div><strong>{selectedSection.name}</strong><small>{formatTime(selectedSection.start)} — {formatTime(selectedSection.end)}</small></div><label className="switch"><input type="checkbox" checked={selectedSection.enabled} onChange={(event) => updateSection({ enabled: event.target.checked })} /><i /></label></div>
              <label className="field"><span>Place every</span><div className="stepper"><button onClick={() => updateSection({ every: Math.max(1, selectedSection.every - 1) })}>−</button><strong>{selectedSection.every} beats</strong><button onClick={() => updateSection({ every: selectedSection.every + 1 })}>+</button></div></label>
              <label className="field"><span>Effect duration</span><div className="value-line"><input type="range" min="0.1" max="4" step="0.05" value={selectedSection.duration} onChange={(event) => updateSection({ duration: Number(event.target.value) })} /><strong>{selectedSection.duration.toFixed(2)}s</strong></div></label>
              <label className="field"><span>Scale</span><div className="value-line"><input type="range" min="50" max="180" value={selectedSection.scale} onChange={(event) => updateSection({ scale: Number(event.target.value) })} /><strong>{selectedSection.scale}%</strong></div></label>
              <div className="inspector-actions"><button onClick={splitAtPlayhead}><Scissors size={15} /> Split at playhead</button><button className="primary" onClick={rebuildPlacements}><Sparkles size={15} /> Fill timeline</button></div>
            </div>
          )}

          {activePanel === "clip" && selectedPlacement && (
            <div className="inspector">
              <div className="inspector-title"><span className="clip-swatch" /><div><strong>Placement override</strong><small>{assets.find((asset) => asset.id === selectedPlacement.assetId)?.name}</small></div></div>
              <label className="field"><span>Start time</span><div className="value-line"><input type="range" min="0" max={duration} step="0.01" value={selectedPlacement.start} onChange={(event) => updatePlacement({ start: Number(event.target.value) })} /><strong>{formatTime(selectedPlacement.start)}</strong></div></label>
              <label className="field"><span>Duration</span><div className="value-line"><input type="range" min="0.1" max="6" step="0.05" value={selectedPlacement.duration} onChange={(event) => updatePlacement({ duration: Number(event.target.value) })} /><strong>{selectedPlacement.duration.toFixed(2)}s</strong></div></label>
              <label className="field"><span>Scale</span><div className="value-line"><input type="range" min="50" max="200" value={selectedPlacement.scale} onChange={(event) => updatePlacement({ scale: Number(event.target.value) })} /><strong>{selectedPlacement.scale}%</strong></div></label>
              <label className="field"><span>Opacity</span><div className="value-line"><input type="range" min="10" max="100" value={selectedPlacement.opacity} onChange={(event) => updatePlacement({ opacity: Number(event.target.value) })} /><strong>{selectedPlacement.opacity}%</strong></div></label>
              <button className="delete-placement" onClick={() => { setPlacements((items) => items.filter((item) => item.id !== selectedPlacement.id)); setSelectedPlacementId(null); setActivePanel("section"); }}><Trash2 size={15} /> Remove placement</button>
            </div>
          )}
        </aside>
      </section>

      <section className="timeline-wrap">
        <div className="timeline-toolbar">
          <div><Settings2 size={15} /><strong>Cut map</strong><span>Click a section or effect to tune it</span></div>
          <div className="timeline-legend"><span><i className="beat-legend" />Beat</span><span><i className="fx-legend" />Effect</span><span><i className="scene-legend" />Section</span></div>
        </div>
        <div className="timeline-scroll">
          <div className="timeline" style={{ minWidth: Math.max(980, duration * 7) }}>
            <div className="section-lane">
              <div className="track-label"><Split size={15} /><span>SECTIONS</span></div>
              <div className="track-content">
                {sections.map((section) => (
                  <button key={section.id} className={`section-block ${section.id === selectedSectionId ? "selected" : ""}`} style={{ left: `${(section.start / duration) * 100}%`, width: `${((section.end - section.start) / duration) * 100}%`, borderColor: section.color, color: section.color }} onClick={() => { setSelectedSectionId(section.id); setActivePanel("section"); }}><span>{section.name}</span><small>every {section.every}</small></button>
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
              <div className="track-label"><Film size={15} /><span>MAIN VIDEO</span></div>
              <div className="track-content"><div className="main-clip"><div className="clip-stripes" /><strong>{mainName}</strong><span>{formatTime(duration)}</span></div></div>
            </div>
            <div className="effects-lane">
              <div className="track-label"><Sparkles size={15} /><span>EFFECTS</span></div>
              <div className="track-content">
                {placements.map((placement) => {
                  const asset = assets.find((item) => item.id === placement.assetId);
                  return <button key={placement.id} className={`effect-block ${placement.id === selectedPlacementId ? "selected" : ""}`} style={{ left: `${(placement.start / duration) * 100}%`, width: `${Math.max(0.38, (placement.duration / duration) * 100)}%`, background: asset?.color ?? COLORS[0] }} title={`${asset?.name} · ${placement.duration.toFixed(2)}s · ${placement.scale}%`} onClick={() => { setSelectedPlacementId(placement.id); setSelectedSectionId(placement.sectionId); setActivePanel("clip"); seek(placement.start); }} />;
                })}
              </div>
            </div>
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
          <input type="checkbox" checked={editorMode === "pro"} onChange={(event) => setEditorMode(event.target.checked ? "pro" : "auto")} />
          <i />
          <span>PRO ARRANGEMENT</span>
        </label>
      </footer>
    </main>
  );
}
