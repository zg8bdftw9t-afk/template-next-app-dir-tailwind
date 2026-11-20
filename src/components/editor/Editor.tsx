"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ───────────────────────── Types ───────────────────────── */

type Lane = "text" | "overlay" | "main" | "audio";
type ClipType = "video" | "image" | "audio" | "text";

type Filter = {
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  sepia: number;
  hue: number;
  blur: number;
};

type Asset = {
  id: string;
  name: string;
  kind: "video" | "image" | "audio";
  url: string;
  duration: number;
  w: number;
  h: number;
};

type Clip = {
  id: string;
  type: ClipType;
  assetId?: string;
  lane: Lane;
  start: number;
  dur: number;
  trimIn: number;
  speed: number;
  volume: number;
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  fade: number;
  filter: Filter;
  text: string;
  color: string;
  size: number;
  bold: boolean;
  stroke: boolean;
};

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

/* ───────────────────────── Constants & helpers ───────────────────────── */

const DEFAULT_FILTER: Filter = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  grayscale: 0,
  sepia: 0,
  hue: 0,
  blur: 0,
};

const FILTER_PRESETS: { name: string; f: Partial<Filter> }[] = [
  { name: "Asli", f: {} },
  { name: "Hitam Putih", f: { grayscale: 1, contrast: 1.1 } },
  { name: "Vintage", f: { sepia: 0.6, contrast: 1.1, brightness: 1.05, saturate: 0.9 } },
  { name: "Vivid", f: { saturate: 1.7, contrast: 1.1 } },
  { name: "Dingin", f: { hue: -15, saturate: 1.1, brightness: 1.03 } },
  { name: "Hangat", f: { sepia: 0.3, saturate: 1.3, hue: -8 } },
  { name: "Drama", f: { contrast: 1.4, brightness: 0.9, saturate: 1.2 } },
];

const RATIOS: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
  "1:1": { w: 1000, h: 1000 },
  "4:3": { w: 960, h: 720 },
};

const LANES: { id: Lane; label: string }[] = [
  { id: "text", label: "Teks" },
  { id: "overlay", label: "Overlay" },
  { id: "main", label: "Video" },
  { id: "audio", label: "Audio" },
];
const LANE_H = 44;
const RULER_H = 24;
const MIN_DUR = 0.2;
const DRAW_RANK: Record<Lane, number> = { main: 0, overlay: 1, text: 2, audio: 3 };

const CLIP_COLOR: Record<ClipType, string> = {
  video: "bg-sky-600 border-sky-400",
  image: "bg-teal-600 border-teal-400",
  audio: "bg-emerald-600 border-emerald-400",
  text: "bg-fuchsia-600 border-fuchsia-400",
};

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

function filterStr(f: Filter) {
  if (JSON.stringify(f) === JSON.stringify(DEFAULT_FILTER)) return "none";
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) grayscale(${f.grayscale}) sepia(${f.sepia}) hue-rotate(${f.hue}deg) blur(${f.blur}px)`;
}

function fadeAlpha(c: Clip, t: number) {
  if (c.fade <= 0) return 1;
  return clamp(Math.min((t - c.start) / c.fade, (c.start + c.dur - t) / c.fade), 0, 1);
}

function newClip(p: Partial<Clip> & Pick<Clip, "type" | "lane" | "start" | "dur">): Clip {
  return {
    id: uid(),
    trimIn: 0,
    speed: 1,
    volume: 1,
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    rotate: 0,
    fade: 0,
    filter: { ...DEFAULT_FILTER },
    text: "",
    color: "#ffffff",
    size: 80,
    bold: true,
    stroke: true,
    ...p,
  };
}

/* ───────────────────────── Small UI pieces ───────────────────────── */

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onStart: () => void;
  suffix?: string;
  digits?: number;
}) {
  const { label, value, min, max, step, onChange, onStart, suffix = "", digits = 2 } = props;
  return (
    <label className="block text-xs text-zinc-400">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-zinc-300">
          {value.toFixed(digits)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-400"
      />
    </label>
  );
}

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const { active, className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
        active ? "bg-cyan-500 text-black" : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
      } ${className}`}
    />
  );
}

/* ───────────────────────── Editor ───────────────────────── */

export default function Editor() {
  const [assets, setAssetsState] = useState<Asset[]>([]);
  const [clips, setClipsState] = useState<Clip[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(60);
  const [ratio, setRatio] = useState("16:9");
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<"media" | "teks">("media");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const clipsRef = useRef<Clip[]>([]);
  const assetsRef = useRef<Asset[]>([]);
  const totalRef = useRef(0);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const zoomRef = useRef(60);
  const rafRef = useRef(0);
  const playStartRef = useRef({ wall: 0, t: 0 });
  const onEndRef = useRef<(() => void) | null>(null);
  const els = useRef(new Map<string, MediaEl>());
  const undoRef = useRef<Clip[][]>([]);
  const redoRef = useRef<Clip[][]>([]);
  const audioRef = useRef<{
    ctx: AudioContext;
    master: GainNode;
    dest: MediaStreamAudioDestinationNode;
    hooked: WeakSet<HTMLMediaElement>;
  } | null>(null);

  zoomRef.current = zoom;
  const dims = RATIOS[ratio];
  const selected = clips.find((c) => c.id === selId) ?? null;
  const total = useMemo(
    () => clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0),
    [clips],
  );

  /* ── state wrappers (keep refs in sync immediately) ── */

  const setC = (fn: (prev: Clip[]) => Clip[]) => {
    const next = fn(clipsRef.current);
    clipsRef.current = next;
    totalRef.current = next.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
    setClipsState(next);
  };
  const setA = (fn: (prev: Asset[]) => Asset[]) => {
    const next = fn(assetsRef.current);
    assetsRef.current = next;
    setAssetsState(next);
  };
  const commit = () => {
    undoRef.current.push(clipsRef.current);
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
  };
  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(clipsRef.current);
    setC(() => prev);
  };
  const redo = () => {
    const nxt = redoRef.current.pop();
    if (!nxt) return;
    undoRef.current.push(clipsRef.current);
    setC(() => nxt);
  };
  const upd = (id: string, patch: Partial<Clip>) =>
    setC((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updFilter = (id: string, patch: Partial<Filter>) =>
    setC((p) => p.map((c) => (c.id === id ? { ...c, filter: { ...c.filter, ...patch } } : c)));

  /* ── audio graph ── */

  const hook = (el: HTMLMediaElement) => {
    const a = audioRef.current;
    if (!a || a.hooked.has(el)) return;
    const src = a.ctx.createMediaElementSource(el);
    src.connect(a.master);
    src.connect(a.dest);
    a.hooked.add(el);
  };
  const ensureAudio = () => {
    if (!audioRef.current) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      audioRef.current = {
        ctx,
        master,
        dest: ctx.createMediaStreamDestination(),
        hooked: new WeakSet(),
      };
    }
    if (audioRef.current.ctx.state === "suspended") void audioRef.current.ctx.resume();
    els.current.forEach((el) => {
      if (el instanceof HTMLMediaElement) hook(el);
    });
  };

  /* ── media elements ── */

  const getEl = (c: Clip): MediaEl | null => {
    let el = els.current.get(c.id);
    if (el) return el;
    const a = assetsRef.current.find((x) => x.id === c.assetId);
    if (!a) return null;
    if (a.kind === "image") {
      const im = new Image();
      im.onload = () => renderFrame(timeRef.current);
      im.src = a.url;
      el = im;
    } else {
      const m = document.createElement(a.kind === "video" ? "video" : "audio");
      m.preload = "auto";
      m.setAttribute("playsinline", "");
      m.onseeked = () => renderFrame(timeRef.current);
      m.onloadeddata = () => renderFrame(timeRef.current);
      m.src = a.url;
      el = m;
      hook(m);
    }
    els.current.set(c.id, el);
    return el;
  };

  /* ── rendering ── */

  const renderFrame = (t: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width;
    const H = cv.height;
    const isPlaying = playingRef.current;
    const all = clipsRef.current;
    const active = new Set(
      all.filter((c) => t >= c.start - 1e-6 && t < c.start + c.dur).map((c) => c.id),
    );

    // sync <video>/<audio> elements
    for (const c of all) {
      if (c.type !== "video" && c.type !== "audio") continue;
      const m = getEl(c) as HTMLMediaElement | null;
      if (!m) continue;
      if (!active.has(c.id)) {
        if (!m.paused) m.pause();
        continue;
      }
      const target = c.trimIn + (t - c.start) * c.speed;
      m.playbackRate = c.speed;
      m.volume = clamp(c.volume, 0, 1);
      if (isPlaying) {
        if (m.paused) {
          if (Math.abs(m.currentTime - target) > 0.05) m.currentTime = target;
          m.play().catch(() => {});
        } else if (Math.abs(m.currentTime - target) > 0.35) {
          m.currentTime = target;
        }
      } else {
        if (!m.paused) m.pause();
        if (Math.abs(m.currentTime - target) > 0.04) m.currentTime = target;
      }
    }

    // draw
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const visual = all
      .filter((c) => c.type !== "audio" && active.has(c.id))
      .sort((a, b) => DRAW_RANK[a.lane] - DRAW_RANK[b.lane] || a.start - b.start);

    for (const c of visual) {
      ctx.save();
      ctx.globalAlpha = c.opacity * fadeAlpha(c, t);
      ctx.translate(W / 2 + c.x * W, H / 2 + c.y * H);
      ctx.rotate((c.rotate * Math.PI) / 180);
      if (c.type === "text") {
        const fs = c.size * c.scale * (Math.min(W, H) / 720);
        ctx.font = `${c.bold ? 700 : 500} ${fs}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const lines = c.text.split("\n");
        const lh = fs * 1.2;
        lines.forEach((line, i) => {
          const y = (i - (lines.length - 1) / 2) * lh;
          if (c.stroke) {
            ctx.lineWidth = fs / 7;
            ctx.strokeStyle = "#000";
            ctx.strokeText(line, 0, y);
          }
          ctx.fillStyle = c.color;
          ctx.fillText(line, 0, y);
        });
      } else {
        const el = getEl(c);
        if (el) {
          let sw = 0;
          let sh = 0;
          if (el instanceof HTMLVideoElement) {
            if (el.readyState >= 2) {
              sw = el.videoWidth;
              sh = el.videoHeight;
            }
          } else if (el instanceof HTMLImageElement && el.complete) {
            sw = el.naturalWidth;
            sh = el.naturalHeight;
          }
          if (sw && sh) {
            const s = Math.min(W / sw, H / sh) * c.scale;
            ctx.filter = filterStr(c.filter);
            ctx.drawImage(el as CanvasImageSource, (-sw * s) / 2, (-sh * s) / 2, sw * s, sh * s);
          }
        }
      }
      ctx.restore();
    }
  };

  // Redraw when paused & something changed
  useEffect(() => {
    if (!playingRef.current) renderFrame(timeRef.current);
  }, [clips, dims.w, dims.h, assets]);

  /* ── transport ── */

  const pauseAll = () => {
    cancelAnimationFrame(rafRef.current);
    playingRef.current = false;
    setPlaying(false);
    els.current.forEach((el) => {
      if (el instanceof HTMLMediaElement && !el.paused) el.pause();
    });
    renderFrame(timeRef.current);
  };

  const tick = () => {
    if (!playingRef.current) return;
    const { wall, t: t0 } = playStartRef.current;
    let t = t0 + (performance.now() - wall) / 1000;
    const end = totalRef.current;
    if (t >= end) {
      t = end;
      timeRef.current = t;
      setTime(t);
      renderFrame(t);
      pauseAll();
      onEndRef.current?.();
      return;
    }
    timeRef.current = t;
    setTime(t);
    renderFrame(t);
    rafRef.current = requestAnimationFrame(tick);
  };

  const play = () => {
    if (totalRef.current <= 0) return;
    if (timeRef.current >= totalRef.current - 0.02) {
      timeRef.current = 0;
      setTime(0);
    }
    ensureAudio();
    playStartRef.current = { wall: performance.now(), t: timeRef.current };
    playingRef.current = true;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlay = () => (playingRef.current ? pauseAll() : play());

  const seek = (t: number) => {
    const v = clamp(t, 0, Math.max(totalRef.current, 0));
    timeRef.current = v;
    setTime(v);
    playStartRef.current = { wall: performance.now(), t: v };
    renderFrame(v);
  };

  /* ── editing actions ── */

  const addAsset = (a: Asset) => {
    const lane: Lane = a.kind === "audio" ? "audio" : "main";
    const start = clipsRef.current
      .filter((c) => c.lane === lane)
      .reduce((m, c) => Math.max(m, c.start + c.dur), 0);
    commit();
    const clip = newClip({
      type: a.kind,
      assetId: a.id,
      lane,
      start,
      dur: a.kind === "image" ? 5 : Math.max(a.duration, MIN_DUR),
    });
    setC((p) => [...p, clip]);
    setSelId(clip.id);
  };

  const addText = (text = "Teks baru", size = 80) => {
    commit();
    const clip = newClip({
      type: "text",
      lane: "text",
      start: timeRef.current,
      dur: 3,
      text,
      size,
      y: 0.3,
    });
    setC((p) => [...p, clip]);
    setSelId(clip.id);
  };

  const splitAt = () => {
    const t = timeRef.current;
    const c =
      clipsRef.current.find((k) => k.id === selId && t > k.start + 0.05 && t < k.start + k.dur - 0.05) ??
      clipsRef.current.find((k) => t > k.start + 0.05 && t < k.start + k.dur - 0.05);
    if (!c) return;
    commit();
    const first = { ...c, dur: t - c.start };
    const second = {
      ...c,
      id: uid(),
      start: t,
      dur: c.start + c.dur - t,
      trimIn: c.trimIn + (t - c.start) * c.speed,
    };
    setC((p) => p.flatMap((k) => (k.id === c.id ? [first, second] : [k])));
    setSelId(second.id);
  };

  const removeSel = () => {
    if (!selId) return;
    commit();
    const el = els.current.get(selId);
    if (el instanceof HTMLMediaElement) el.pause();
    setC((p) => p.filter((k) => k.id !== selId));
    setSelId(null);
  };

  const duplicate = () => {
    if (!selected) return;
    commit();
    const copy = { ...selected, id: uid(), start: selected.start + selected.dur, filter: { ...selected.filter } };
    setC((p) => [...p, copy]);
    setSelId(copy.id);
  };

  const setSpeed = (c: Clip, speed: number) => {
    const a = assetsRef.current.find((x) => x.id === c.assetId);
    let dur = (c.dur * c.speed) / speed;
    if (a) dur = Math.min(dur, (a.duration - c.trimIn) / speed);
    upd(c.id, { speed, dur: Math.max(dur, MIN_DUR) });
  };

  const importFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const kind = file.type.startsWith("video")
        ? "video"
        : file.type.startsWith("image")
          ? "image"
          : file.type.startsWith("audio")
            ? "audio"
            : null;
      if (!kind) return;
      const url = URL.createObjectURL(file);
      const base = { id: uid(), name: file.name, kind, url } as const;
      if (kind === "image") {
        const im = new Image();
        im.onload = () =>
          setA((p) => [...p, { ...base, duration: 5, w: im.naturalWidth, h: im.naturalHeight }]);
        im.src = url;
      } else {
        const m = document.createElement(kind === "video" ? "video" : "audio");
        m.preload = "metadata";
        m.onloadedmetadata = () =>
          setA((p) => [
            ...p,
            {
              ...base,
              duration: isFinite(m.duration) ? m.duration : 5,
              w: (m as HTMLVideoElement).videoWidth || 0,
              h: (m as HTMLVideoElement).videoHeight || 0,
            },
          ]);
        m.src = url;
      }
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  /* ── timeline drag ── */

  const snap = (v: number, skip: string) => {
    const pts = [
      0,
      timeRef.current,
      ...clipsRef.current.filter((k) => k.id !== skip).flatMap((k) => [k.start, k.start + k.dur]),
    ];
    const th = 8 / zoomRef.current;
    let best = v;
    let bd = th;
    for (const p of pts) {
      const d = Math.abs(p - v);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  const startDrag = (e: React.PointerEvent, c: Clip, mode: "move" | "l" | "r") => {
    e.stopPropagation();
    e.preventDefault();
    setSelId(c.id);
    commit();
    const x0 = e.clientX;
    const orig = c;
    const isMedia = c.type === "video" || c.type === "audio";
    const asset = assetsRef.current.find((a) => a.id === c.assetId);

    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / zoomRef.current;
      if (mode === "move") {
        const ns = Math.max(0, orig.start + d);
        const a = snap(ns, c.id);
        const b = snap(ns + orig.dur, c.id) - orig.dur;
        const pick = Math.abs(a - ns) <= Math.abs(b - ns) ? a : b;
        upd(c.id, { start: Math.max(0, pick) });
      } else if (mode === "l") {
        let delta = snap(Math.max(0, orig.start + d), c.id) - orig.start;
        delta = Math.min(delta, orig.dur - MIN_DUR);
        delta = Math.max(delta, -orig.start);
        if (isMedia) delta = Math.max(delta, -orig.trimIn / orig.speed);
        upd(c.id, {
          start: orig.start + delta,
          dur: orig.dur - delta,
          trimIn: isMedia ? orig.trimIn + delta * orig.speed : 0,
        });
      } else {
        const ne = snap(orig.start + orig.dur + d, c.id);
        let nd = Math.max(MIN_DUR, ne - orig.start);
        if (isMedia && asset) nd = Math.min(nd, (asset.duration - orig.trimIn) / orig.speed);
        upd(c.id, { dur: nd });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const scrub = (e: React.PointerEvent) => {
    const rect = contentRef.current!.getBoundingClientRect();
    const go = (cx: number) => seek((cx - rect.left) / zoomRef.current);
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ── export ── */

  const doExport = async () => {
    if (totalRef.current <= 0 || exporting) return;
    pauseAll();
    setSelId(null);
    setExporting(true);
    try {
      ensureAudio();
      const a = audioRef.current!;
      a.master.gain.value = 0; // silent while rendering
      timeRef.current = 0;
      setTime(0);
      renderFrame(0);
      await new Promise((r) => setTimeout(r, 400));

      const stream = canvasRef.current!.captureStream(30);
      a.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const mimes = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined,
      );
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start(250);
      await new Promise<void>((res) => {
        onEndRef.current = res;
        play();
      });
      onEndRef.current = null;
      await new Promise((r) => setTimeout(r, 250));
      rec.stop();
      await stopped;
      a.master.gain.value = 1;

      const type = rec.mimeType || "video/webm";
      const blob = new Blob(chunks, { type });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `video-${Date.now()}.${type.includes("mp4") ? "mp4" : "webm"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    } finally {
      if (audioRef.current) audioRef.current.master.gain.value = 1;
      setExporting(false);
    }
  };

  /* ── keyboard shortcuts ── */

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      removeSel();
    } else if (!mod && e.key.toLowerCase() === "s") {
      splitAt();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate();
    } else if (e.key === "ArrowLeft") {
      seek(timeRef.current - (e.shiftKey ? 1 : 1 / 30));
    } else if (e.key === "ArrowRight") {
      seek(timeRef.current + (e.shiftKey ? 1 : 1 / 30));
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // keep the playhead visible during playback
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !playing) return;
    const x = time * zoom;
    if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = x - 40;
  }, [time, zoom, playing]);

  /* ───────────────────────── Render ───────────────────────── */

  const contentW = Math.max(total + 15, 40) * zoom;
  const tickStep = zoom >= 100 ? 1 : zoom >= 45 ? 2 : zoom >= 22 ? 5 : 10;
  const ticks: number[] = [];
  for (let s = 0; s * zoom <= contentW; s += tickStep) ticks.push(s);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100 select-none">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-cyan-400 text-black">✂</span>
          Editor Video
        </div>
        <div className="flex items-center gap-3">
          <select
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            className="rounded-md bg-zinc-800 px-2 py-1.5 text-xs"
          >
            {Object.keys(RATIOS).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button
            onClick={doExport}
            disabled={exporting || total <= 0}
            className="rounded-md bg-cyan-400 px-4 py-1.5 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40"
          >
            {exporting ? `Mengekspor ${Math.round((time / Math.max(total, 0.01)) * 100)}%` : "Ekspor"}
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex min-h-0 flex-1">
        {/* Left: media / text */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800">
          <div className="flex gap-1 p-2">
            <Btn active={tab === "media"} onClick={() => setTab("media")} className="flex-1">
              Media
            </Btn>
            <Btn active={tab === "teks"} onClick={() => setTab("teks")} className="flex-1">
              Teks
            </Btn>
          </div>
          {tab === "media" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="video/*,image/*,audio/*"
                hidden
                onChange={(e) => importFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="mb-3 w-full rounded-lg border border-dashed border-zinc-600 py-6 text-sm text-zinc-300 hover:border-cyan-400 hover:text-cyan-300"
              >
                + Impor video, foto, audio
              </button>
              <div className="grid grid-cols-2 gap-2">
                {assets.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => addAsset(a)}
                    title="Klik untuk menambahkan ke timeline"
                    className="group relative aspect-video overflow-hidden rounded-md bg-zinc-800 text-left"
                  >
                    {a.kind === "video" && (
                      <video src={`${a.url}#t=0.1`} preload="metadata" muted className="h-full w-full object-cover" />
                    )}
                    {a.kind === "image" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                    )}
                    {a.kind === "audio" && (
                      <div className="grid h-full place-items-center text-2xl">♫</div>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-[10px]">
                      {a.name}
                    </span>
                    {a.kind !== "image" && (
                      <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px]">
                        {fmt(a.duration)}
                      </span>
                    )}
                    <span className="absolute inset-0 hidden place-items-center bg-cyan-400/30 text-2xl group-hover:grid">
                      +
                    </span>
                  </button>
                ))}
              </div>
              {assets.length === 0 && (
                <p className="mt-2 text-center text-xs text-zinc-500">
                  Belum ada media. Impor file lalu klik untuk menambahkannya ke timeline.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2 p-2">
              <Btn className="w-full" onClick={() => addText("Teks baru", 80)}>
                + Teks default
              </Btn>
              <Btn className="w-full" onClick={() => addText("JUDUL BESAR", 140)}>
                + Judul
              </Btn>
              <Btn className="w-full" onClick={() => addText("Subtitle di sini", 56)}>
                + Subtitle
              </Btn>
              <p className="pt-2 text-xs text-zinc-500">
                Teks ditambahkan di posisi playhead. Edit isi, warna, dan ukuran di panel kanan.
              </p>
            </div>
          )}
        </aside>

        {/* Center: preview */}
        <main className="flex min-w-0 flex-1 flex-col bg-zinc-900">
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <canvas
                ref={canvasRef}
                width={dims.w}
                height={dims.h}
                className="max-h-full max-w-full bg-black shadow-2xl"
              />
            </div>
            {clips.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-zinc-400">
                Impor media untuk mulai mengedit
              </div>
            )}
          </div>
          <div className="flex h-11 shrink-0 items-center justify-center gap-3 border-t border-zinc-800 text-sm">
            <Btn onClick={() => seek(0)}>⏮</Btn>
            <Btn onClick={togglePlay} active={playing} className="w-16">
              {playing ? "Jeda" : "Putar"}
            </Btn>
            <span className="w-32 text-center tabular-nums text-zinc-300">
              {fmt(time)} / {fmt(total)}
            </span>
          </div>
        </main>

        {/* Right: inspector */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 p-3">
          {!selected ? (
            <div className="text-xs text-zinc-500">
              <p className="mb-2 text-sm font-medium text-zinc-300">Properti</p>
              Pilih klip di timeline untuk mengedit.
              <ul className="mt-4 space-y-1">
                <li><kbd>Spasi</kbd> putar / jeda</li>
                <li><kbd>S</kbd> potong di playhead</li>
                <li><kbd>Del</kbd> hapus klip</li>
                <li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> undo / redo</li>
                <li><kbd>Ctrl+D</kbd> duplikat</li>
                <li><kbd>← →</kbd> geser frame (Shift = 1 dtk)</li>
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="truncate text-sm font-medium capitalize">
                  {selected.type === "text"
                    ? "Teks"
                    : assets.find((a) => a.id === selected.assetId)?.name ?? selected.type}
                </p>
              </div>
              <div className="flex gap-1">
                <Btn onClick={splitAt} className="flex-1">Potong</Btn>
                <Btn onClick={duplicate} className="flex-1">Duplikat</Btn>
                <Btn onClick={removeSel} className="flex-1 !bg-red-600/80 hover:!bg-red-500">Hapus</Btn>
              </div>

              {selected.type === "text" && (
                <div className="space-y-2">
                  <textarea
                    value={selected.text}
                    onFocus={commit}
                    onChange={(e) => upd(selected.id, { text: e.target.value })}
                    rows={3}
                    className="w-full rounded-md bg-zinc-800 p-2 text-sm"
                  />
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    Warna
                    <input
                      type="color"
                      value={selected.color}
                      onPointerDown={commit}
                      onChange={(e) => upd(selected.id, { color: e.target.value })}
                      className="h-7 w-10 cursor-pointer rounded bg-transparent"
                    />
                    <Btn active={selected.bold} onClick={() => { commit(); upd(selected.id, { bold: !selected.bold }); }}>
                      Tebal
                    </Btn>
                    <Btn active={selected.stroke} onClick={() => { commit(); upd(selected.id, { stroke: !selected.stroke }); }}>
                      Outline
                    </Btn>
                  </div>
                  <Slider label="Ukuran" value={selected.size} min={20} max={300} step={1} digits={0}
                    onStart={commit} onChange={(v) => upd(selected.id, { size: v })} />
                </div>
              )}

              {(selected.type === "video" || selected.type === "image") && (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  Layer
                  <Btn active={selected.lane === "main"} onClick={() => { commit(); upd(selected.id, { lane: "main" }); }}>
                    Utama
                  </Btn>
                  <Btn active={selected.lane === "overlay"} onClick={() => { commit(); upd(selected.id, { lane: "overlay" }); }}>
                    Overlay
                  </Btn>
                </div>
              )}

              {selected.type !== "audio" && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Transformasi</h3>
                  <Slider label="Skala" value={selected.scale} min={0.1} max={3} step={0.01} onStart={commit}
                    onChange={(v) => upd(selected.id, { scale: v })} />
                  <Slider label="Posisi X" value={selected.x} min={-1} max={1} step={0.01} onStart={commit}
                    onChange={(v) => upd(selected.id, { x: v })} />
                  <Slider label="Posisi Y" value={selected.y} min={-1} max={1} step={0.01} onStart={commit}
                    onChange={(v) => upd(selected.id, { y: v })} />
                  <Slider label="Rotasi" value={selected.rotate} min={-180} max={180} step={1} digits={0} suffix="°"
                    onStart={commit} onChange={(v) => upd(selected.id, { rotate: v })} />
                  <Slider label="Opasitas" value={selected.opacity} min={0} max={1} step={0.01} onStart={commit}
                    onChange={(v) => upd(selected.id, { opacity: v })} />
                  <Slider label="Fade in/out" value={selected.fade} min={0} max={Math.max(0.1, selected.dur / 2)} step={0.05}
                    suffix=" dtk" onStart={commit} onChange={(v) => upd(selected.id, { fade: v })} />
                </section>
              )}

              {(selected.type === "video" || selected.type === "audio") && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Audio & Kecepatan</h3>
                  <Slider label="Volume" value={selected.volume} min={0} max={1} step={0.01} onStart={commit}
                    onChange={(v) => upd(selected.id, { volume: v })} />
                  <Slider label="Kecepatan" value={selected.speed} min={0.25} max={4} step={0.05} suffix="x" onStart={commit}
                    onChange={(v) => setSpeed(selected, v)} />
                </section>
              )}

              {(selected.type === "video" || selected.type === "image") && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Filter</h3>
                  <div className="flex flex-wrap gap-1">
                    {FILTER_PRESETS.map((p) => (
                      <Btn key={p.name} onClick={() => { commit(); upd(selected.id, { filter: { ...DEFAULT_FILTER, ...p.f } }); }}>
                        {p.name}
                      </Btn>
                    ))}
                  </div>
                  <Slider label="Kecerahan" value={selected.filter.brightness} min={0} max={2} step={0.01} onStart={commit}
                    onChange={(v) => updFilter(selected.id, { brightness: v })} />
                  <Slider label="Kontras" value={selected.filter.contrast} min={0} max={2} step={0.01} onStart={commit}
                    onChange={(v) => updFilter(selected.id, { contrast: v })} />
                  <Slider label="Saturasi" value={selected.filter.saturate} min={0} max={3} step={0.01} onStart={commit}
                    onChange={(v) => updFilter(selected.id, { saturate: v })} />
                  <Slider label="Hitam putih" value={selected.filter.grayscale} min={0} max={1} step={0.01} onStart={commit}
                    onChange={(v) => updFilter(selected.id, { grayscale: v })} />
                  <Slider label="Sepia" value={selected.filter.sepia} min={0} max={1} step={0.01} onStart={commit}
                    onChange={(v) => updFilter(selected.id, { sepia: v })} />
                  <Slider label="Hue" value={selected.filter.hue} min={-180} max={180} step={1} digits={0} suffix="°" onStart={commit}
                    onChange={(v) => updFilter(selected.id, { hue: v })} />
                  <Slider label="Blur" value={selected.filter.blur} min={0} max={20} step={0.5} digits={1} suffix="px" onStart={commit}
                    onChange={(v) => updFilter(selected.id, { blur: v })} />
                </section>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Timeline */}
      <section className="shrink-0 border-t border-zinc-800 bg-zinc-950">
        <div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3">
          <Btn onClick={undo} title="Undo (Ctrl+Z)">↶</Btn>
          <Btn onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</Btn>
          <Btn onClick={splitAt} title="Potong (S)">✂ Potong</Btn>
          <Btn onClick={removeSel} disabled={!selId} title="Hapus (Del)">Hapus</Btn>
          <div className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
            Zoom
            <input
              type="range"
              min={10}
              max={200}
              value={zoom}
              onChange={(e) => setZoom(parseInt(e.target.value))}
              className="w-32 accent-cyan-400"
            />
          </div>
        </div>

        <div className="flex">
          {/* gutter */}
          <div className="w-16 shrink-0 border-r border-zinc-800">
            <div style={{ height: RULER_H }} />
            {LANES.map((l) => (
              <div
                key={l.id}
                style={{ height: LANE_H }}
                className="flex items-center justify-center border-t border-zinc-800 text-[11px] text-zinc-500"
              >
                {l.label}
              </div>
            ))}
          </div>

          {/* scrollable tracks */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div ref={contentRef} className="relative" style={{ width: contentW }}>
              {/* ruler */}
              <div
                onPointerDown={scrub}
                style={{ height: RULER_H }}
                className="relative cursor-pointer bg-zinc-900"
              >
                {ticks.map((s) => (
                  <div key={s} className="absolute top-0 h-full border-l border-zinc-700 pl-1 text-[10px] text-zinc-500"
                    style={{ left: s * zoom }}>
                    {fmt(s).split(".")[0]}
                  </div>
                ))}
              </div>

              {/* lanes */}
              {LANES.map((l) => (
                <div
                  key={l.id}
                  style={{ height: LANE_H }}
                  className="relative border-t border-zinc-800"
                  onPointerDown={(e) => {
                    setSelId(null);
                    scrub(e);
                  }}
                >
                  {clips
                    .filter((c) => c.lane === l.id)
                    .map((c) => {
                      const a = assets.find((x) => x.id === c.assetId);
                      return (
                        <div
                          key={c.id}
                          onPointerDown={(e) => startDrag(e, c, "move")}
                          style={{ left: c.start * zoom, width: Math.max(c.dur * zoom, 4), top: 3, height: LANE_H - 6 }}
                          className={`absolute flex cursor-grab items-center overflow-hidden rounded border text-[11px] ${CLIP_COLOR[c.type]} ${
                            c.id === selId ? "ring-2 ring-white" : ""
                          }`}
                        >
                          <div
                            onPointerDown={(e) => startDrag(e, c, "l")}
                            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-white/30 hover:bg-white/60"
                          />
                          <span className="pointer-events-none truncate px-3">
                            {c.type === "text" ? c.text || "Teks" : a?.name}
                            {c.speed !== 1 && ` · ${c.speed}x`}
                          </span>
                          <div
                            onPointerDown={(e) => startDrag(e, c, "r")}
                            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-white/30 hover:bg-white/60"
                          />
                        </div>
                      );
                    })}
                </div>
              ))}

              {/* playhead */}
              <div
                className="pointer-events-none absolute top-0 z-20 h-full w-px bg-cyan-400"
                style={{ left: time * zoom }}
              >
                <div className="absolute -left-1.5 top-0 h-3 w-3 rounded-b-sm bg-cyan-400" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {exporting && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/70">
          <div className="w-80 rounded-xl bg-zinc-900 p-5 text-center">
            <p className="mb-3 text-sm font-medium">Mengekspor video…</p>
            <div className="h-2 overflow-hidden rounded bg-zinc-700">
              <div
                className="h-full bg-cyan-400"
                style={{ width: `${Math.min(100, (time / Math.max(total, 0.01)) * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              Ekspor berjalan real-time. Jangan pindah tab sampai selesai.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
