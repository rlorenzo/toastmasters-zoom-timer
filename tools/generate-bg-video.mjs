// Generate Zoom virtual-background timer videos: the flood color changes at the
// preset's green/yellow/red thresholds while the timer counts up and the timing
// rules (speech type + green/yellow/red chips) sit in the top bar. Drop the MP4
// into Zoom (Settings > Background & Effects); no OBS or application sharing.
//
// Two layouts per preset:
//   corner — small timer in the top-right, center kept clear so you can keep your
//            webcam on in front of the background.
//   center — big centered timer like the web app, for when your webcam is off.
//
// Frames are drawn with @napi-rs/canvas through timer-core's own drawTimingRules
// and drawBigTimer, so the output is pixel-identical to the web app; ffmpeg only
// encodes the frames (no text filter needed). The pure pieces (arg parsing, job
// and layout selection) are exported and unit tested in
// test/generate-bg-video.test.js.
//
//   node tools/generate-bg-video.mjs                 # both layouts, default preset
//   node tools/generate-bg-video.mjs all             # both layouts, every preset
//   node tools/generate-bg-video.mjs prepared --layout=center
//   node tools/generate-bg-video.mjs --green=1:00 --yellow=1:30 --red=2:00
//
// Flags: --layout=corner|center (default: both), --tail=SEC (overtime after red,
// default 60), --fps=N (default 15), --out=DIR (default dist/).

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import {
  computeState,
  DEFAULT_PRESET,
  drawBigTimer,
  drawTimingRules,
  formatTime,
  isOvertime,
  PRESET_KEYS,
  PRESETS,
  parseTime,
  presetDisplayName,
} from '../timer-core.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const W = 1920;
const H = 1080;

// The four flood backgrounds, keyed by state, mirror app.js's BG_SRC.
const IMAGES = {
  start: 'images/toastmasters-zoom-virtual-logo-bk-1920x1080.jpg',
  green: 'images/toastmasters-zoom-virtual-logo-bk-timer-green-1920x1080.jpg',
  yellow: 'images/toastmasters-zoom-virtual-logo-bk-timer-yellow-1920x1080.jpg',
  red: 'images/toastmasters-zoom-virtual-logo-bk-timer-red-1920x1080.jpg',
};

// Fonts the app's canvas text resolves by family name: Montserrat (the brand's
// free Gotham alternate, baked to a bold static TTF) for the rules label, and a
// monospace for the digits/chips. Both are bundled so output is identical on any
// machine (no macOS-only system fonts), which matters for reproducible CI builds.
// DejaVu Sans Mono is what macOS Menlo derives from, so it's registered under the
// `Menlo` family that timer-core's MONO_FONT names.
const MONTSERRAT = join(ROOT, 'fonts/montserrat-bold.ttf');
const MONO = join(ROOT, 'fonts/dejavu-sans-mono-bold.ttf');

// drawBigTimer sizes the readout to fill the zone it's given. Center mirrors the
// app's running-mode timer zone; corner is a compact top-right block that leaves
// the middle clear for a webcam speaker.
const ZONES = {
  center: { x: 140, y: 200, w: 1640, h: 880 },
  corner: { x: 1300, y: 175, w: 540, h: 220 },
};
const LAYOUTS = ['corner', 'center'];

// Any ffmpeg encodes the baked frames; the slim Homebrew build is fine since no
// text filter is involved.
const FFMPEG = 'ffmpeg';

const ARG_RE = /^--([^=]+)(?:=(.*))?$/;

// ---------- Pure helpers (unit tested) ----------

function defaultOpts() {
  return { tail: 60, fps: 15, outDir: join(ROOT, 'dist'), layout: null };
}

function validLayout(v) {
  if (!LAYOUTS.includes(v)) throw new Error(`--layout must be ${LAYOUTS.join('|')}.`);
  return v;
}

// Validate flag conversions where they're parsed so typos fail fast with a clear
// message instead of silently rendering the wrong thing (a NaN custom time is
// falsy, so it would otherwise slip through to the default preset).
function num(name, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number.`);
  return n;
}

function time(name, v) {
  const n = parseTime(v);
  if (Number.isNaN(n)) throw new Error(`--${name} must be m:ss (e.g. 1:30).`);
  return n;
}

// Flag -> how it mutates the parsed config. Data instead of an if/else ladder so
// adding a flag never grows a branchy function (mirrors timer-core's KEY_ACTIONS).
const FLAG_SETTERS = {
  tail: (p, v) => {
    p.opts.tail = num('tail', v);
  },
  fps: (p, v) => {
    p.opts.fps = num('fps', v);
  },
  out: (p, v) => {
    p.opts.outDir = resolve(v);
  },
  layout: (p, v) => {
    p.opts.layout = validLayout(v);
  },
  green: (p, v) => {
    p.custom.green = time('green', v);
  },
  yellow: (p, v) => {
    p.custom.yellow = time('yellow', v);
  },
  red: (p, v) => {
    p.custom.red = time('red', v);
  },
};

export function parseArgs(argv) {
  const parsed = { opts: defaultOpts(), custom: {}, positional: [] };
  for (const a of argv) {
    const m = ARG_RE.exec(a);
    if (!m) {
      parsed.positional.push(a);
      continue;
    }
    const set = FLAG_SETTERS[m[1]];
    if (!set) throw new Error(`Unknown flag: --${m[1]}`);
    set(parsed, m[2]);
  }
  return parsed;
}

function hasCustom(custom) {
  return Boolean(custom.green || custom.yellow || custom.red);
}

function validCustom(custom) {
  const th = { green: custom.green, yellow: custom.yellow, red: custom.red };
  if (!(th.green < th.yellow && th.yellow < th.red)) {
    throw new Error('Custom times must satisfy green < yellow < red (use m:ss).');
  }
  return th;
}

// Resolve the [name, thresholds] render jobs from parsed args: any --green/--yellow
// /--red implies one custom render, `all` renders every preset, otherwise a single
// named preset (defaulting to prepared).
export function selectJobs(custom, positional) {
  if (hasCustom(custom)) return [['custom', validCustom(custom)]];
  if (positional[0] === 'all') return PRESET_KEYS.map((k) => [k, PRESETS[k]]);
  const name = positional[0] || DEFAULT_PRESET;
  if (!PRESETS[name]) {
    throw new Error(`Unknown preset "${name}". Try: ${PRESET_KEYS.join(', ')} or all.`);
  }
  return [[name, PRESETS[name]]];
}

// Which layouts to render: the one requested, or both.
export function resolveLayouts(opts) {
  return opts.layout ? [opts.layout] : LAYOUTS;
}

export function timerZone(layout) {
  return ZONES[layout];
}

// Total length in seconds: up to red plus the overtime tail.
export function totalSeconds(th, tail) {
  return th.red + tail;
}

// ---------- Canvas rendering (reuses the app's drawing) ----------

function registerFonts() {
  GlobalFonts.registerFromPath(MONTSERRAT, 'Montserrat');
  GlobalFonts.registerFromPath(MONO, 'Menlo');
}

async function loadBackgrounds() {
  const out = {};
  for (const [state, src] of Object.entries(IMAGES)) {
    out[state] = await loadImage(join(ROOT, src));
  }
  return out;
}

// Compose one frame: flood background for the current state, the timing-rules
// header, and the timer sized to the layout's zone.
function renderFrame(ctx, { bgImages, zone, elapsed, thresholds, label }) {
  const bg = bgImages[computeState(elapsed, thresholds)];
  ctx.drawImage(bg, 0, 0, W, H);
  drawTimingRules(ctx, { label, thresholds });
  drawBigTimer(ctx, zone, formatTime(elapsed), isOvertime(elapsed, thresholds));
}

// Spawn ffmpeg reading raw RGBA frames from stdin, so encoding runs concurrently
// with rendering and no per-frame PNGs ever touch the disk. Returns the process
// and a promise that settles when encoding finishes.
function spawnEncoder(ff, fps, outFile) {
  const ffmpeg = spawn(
    ff,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${W}x${H}`,
      '-framerate',
      '1',
      '-i',
      'pipe:0',
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outFile,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] }
  );
  // Swallow EPIPE if ffmpeg dies early; the real cause surfaces via `closed`.
  ffmpeg.stdin.on('error', () => {});
  const closed = new Promise((res, rej) => {
    ffmpeg.on('error', rej);
    ffmpeg.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
  });
  return { ffmpeg, closed };
}

// Write one frame, respecting backpressure (each ~8 MB frame overflows the pipe
// buffer, so this paces rendering to ffmpeg's consumption). If the stream closes
// or errors first, reject instead of waiting for a `drain` that will never come,
// so an early ffmpeg exit surfaces an error rather than hanging the render loop.
export function writeFrame(stdin, buf) {
  if (stdin.write(buf)) return Promise.resolve();
  return new Promise((res, rej) => {
    const cleanup = () => {
      stdin.off('drain', onDrain);
      stdin.off('close', onEnd);
      stdin.off('error', onEnd);
    };
    const onDrain = () => {
      cleanup();
      res();
    };
    const onEnd = () => {
      cleanup();
      rej(new Error('ffmpeg stdin closed before a frame was written'));
    };
    stdin.once('drain', onDrain);
    stdin.once('close', onEnd);
    stdin.once('error', onEnd);
  });
}

async function generate(ff, name, th, layout, opts, bgImages) {
  const total = totalSeconds(th, opts.tail);
  const zone = timerZone(layout);
  const label = presetDisplayName(name);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const outFile = join(opts.outDir, `tm-timer-${name}-${layout}.mp4`);

  // One frame per second (the readout changes once a second); ffmpeg holds each
  // for a second and resamples to the output fps. getImageData is spec RGBA, which
  // matches the encoder's -pix_fmt rgba exactly.
  const { ffmpeg, closed } = spawnEncoder(ff, opts.fps, outFile);
  for (let elapsed = 0; elapsed < total; elapsed++) {
    renderFrame(ctx, { bgImages, zone, elapsed, thresholds: th, label });
    await writeFrame(ffmpeg.stdin, Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
  }
  ffmpeg.stdin.end();
  await closed;
  return { outFile, total };
}

function logJob(name, layout, th, total, outFile) {
  console.log(
    `${presetDisplayName(name).padEnd(15)} ${layout.padEnd(6)}  ` +
      `green ${formatTime(th.green)}  yellow ${formatTime(th.yellow)}  red ${formatTime(th.red)}  ` +
      `len ${formatTime(total)}  ->  ${outFile}`
  );
}

async function main() {
  const { opts, custom, positional } = parseArgs(process.argv.slice(2));
  const jobs = selectJobs(custom, positional);
  const wantLayouts = resolveLayouts(opts);
  mkdirSync(opts.outDir, { recursive: true });
  registerFonts();
  const bgImages = await loadBackgrounds();

  for (const [name, th] of jobs) {
    for (const layout of wantLayouts) {
      const { outFile, total } = await generate(FFMPEG, name, th, layout, opts, bgImages);
      logJob(name, layout, th, total, outFile);
    }
  }
}

// Run only as a CLI; importing for tests must not render or encode.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
