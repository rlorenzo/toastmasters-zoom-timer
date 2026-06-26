# Toastmasters Zoom Timer

A browser-based speech timer for Toastmasters meetings on Zoom. Grant your webcam access, pick a speech preset, and the app composites you onto the official Toastmasters virtual background. While idle it shows your segmented webcam; once you start the timer the frame floods green, yellow, then red as your speech crosses each threshold, with a large countdown taking center stage in place of your video so the audience focuses on the time. Everything runs entirely in your browser: no installation, no server, and no file uploads. Your camera feed is processed locally and never leaves your machine; the only outbound requests are to fetch the MediaPipe segmentation runtime and model from public CDNs (jsDelivr and Google).

**Two ways to use it:** run the live web app (below), or skip the setup entirely and [download a ready-made timer video](#zoom-virtual-background-videos-no-setup) to drop straight into Zoom as a virtual background.

---

## Zoom Virtual-Background Videos (no setup)

The quickest way to use the timer: **download a ready-made video and set it as your Zoom virtual background**. No app to run, no OBS, no screen sharing. The background floods green, yellow, then red at the speech's thresholds while a timer counts up and the timing rules sit in the top bar, matching the web app.

There are two layouts for every speech type:

- **`-corner`**: small timer in the top-right with the center kept clear, so you can **keep your webcam on** in front of the background.
- **`-center`**: big centered timer like the web app, for when your **webcam is off**.

Pick your speech type and click to download (or browse everything on the [release page](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/tag/timer-videos)):

| Speech type     | Green / Yellow / Red | Webcam on (corner) | Webcam off (center) |
|-----------------|----------------------|--------------------|---------------------|
| Table Topics    | 1:00 / 1:30 / 2:00   | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-table-topics-corner.mp4) | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-table-topics-center.mp4) |
| Evaluation      | 2:00 / 2:30 / 3:00   | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-evaluation-corner.mp4) | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-evaluation-center.mp4) |
| Ice Breaker     | 4:00 / 5:00 / 6:00   | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-ice-breaker-corner.mp4) | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-ice-breaker-center.mp4) |
| Prepared Speech | 5:00 / 6:00 / 7:00   | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-prepared-corner.mp4) | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-prepared-center.mp4) |
| Long Speech     | 8:00 / 9:00 / 10:00  | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-long-speech-corner.mp4) | [download](https://github.com/rlorenzo/toastmasters-zoom-timer/releases/download/timer-videos/tm-timer-long-speech-center.mp4) |

To use one in Zoom:

1. Download the MP4 for the speech you are timing.
2. In Zoom, open **Settings > Background & Effects**, click **+ > Add Video**, and choose the file.
3. As the speaker begins, select that background so it starts from `0:00`.

> Zoom loops a video virtual background continuously, so each file covers one speaker's run and restarts at `0:00` when it loops. Apply it (or re-select it) as the speaker starts. Each video runs to red plus one minute of overtime.

The videos are rendered from the same code as the web app and refreshed automatically on every release. To build them yourself, see [Generating the videos](#generating-the-videos).

---

## Quick Start

> Camera APIs require a secure context. `file://` URLs will not grant `getUserMedia` access. You must serve the files over `http://localhost` or `https://`.

```bash
git clone <repo-url> toastmasters-zoom-timer
cd toastmasters-zoom-timer
./serve.sh          # or: python3 -m http.server 8000
```

Then:

1. Open <http://localhost:8000> in Chrome, Safari, or Firefox.
2. Grant camera permission when prompted.
3. Pick a preset from the sidebar (default: Prepared Speech 5–7 min).
4. Press `Space` (or click **Start**) to begin timing.

---

## Getting It Into Zoom

> Want a timer with zero setup? Use a [ready-made video](#zoom-virtual-background-videos-no-setup) as your Zoom virtual background instead, with no OBS or screen sharing. The methods below run the live, interactive web app (your segmented webcam composited onto the background).

### OBS Studio Virtual Camera (recommended)

1. Install [OBS Studio](https://obsproject.com) if you have not already.
2. In OBS, add a **Window Capture** source and point it at this browser window or tab.
3. Click **Start Virtual Camera** in OBS.
4. In Zoom, go to **Settings > Video > Camera** and select **OBS Virtual Camera**.

> Tip: press `H` in the app to hide all controls and enter presenter mode. The captured area will show only the composited canvas — no buttons, no sidebar.

### Zoom Share Window (no extra software)

1. In your Zoom meeting, click **Share Screen**.
2. Choose the **Window** tab and select this browser tab.
3. Check **Optimize for video clip** before sharing.

This path is lower quality than the OBS route but requires no additional software.

---

## Keyboard Shortcuts

| Key   | Action                        |
|-------|-------------------------------|
| Space | Start / Pause                 |
| R     | Reset                         |
| H     | Toggle controls (presenter mode) |
| B     | Toggle bell                   |
| ?     | Open setup guide              |
| 1–5   | Jump to preset                |

---

## Speech Presets

| Preset          | Green | Yellow | Red   |
|-----------------|-------|--------|-------|
| Table Topics    | 1:00  | 1:30   | 2:00  |
| Evaluation      | 2:00  | 2:30   | 3:00  |
| Ice Breaker     | 4:00  | 5:00   | 6:00  |
| Prepared Speech | 5:00  | 6:00   | 7:00  |
| Long Speech     | 8:00  | 9:00   | 10:00 |
| Custom          | configurable | configurable | configurable |

Custom thresholds are editable in the sidebar and saved across sessions via `localStorage`.

---

## Browser Support

| Browser          | Notes                                           |
|------------------|-------------------------------------------------|
| Chrome 113+      | Recommended. Full WebGPU path for segmentation. |
| Safari 17+       | Supported via WebGL2 fallback.                  |
| Firefox 121+     | Supported via WebGL2 fallback.                  |
| iOS Safari       | Camera works; wake-lock and some GPU paths are limited. |

---

## How It Works

While idle, MediaPipe SelfieSegmenter runs entirely in-browser (GPU-accelerated via WebGPU where available, WebGL2 otherwise) to separate you from your background; the compositor draws the neutral Toastmasters background onto a `<canvas>` and layers your segmented silhouette in the centered speaker zone. Once timing starts the speaker zone is taken over by a large countdown instead of your video, and the background image is swapped as elapsed time crosses each preset threshold — neutral to green, green to yellow, yellow to red — flooding the whole frame with the state color. `canvas.captureStream()` exposes the composite as a `MediaStream` for direct OBS Browser Source routing.

---

## Background Asset Attribution

The four background images included in this repository under `images/` —

- `images/toastmasters-zoom-virtual-logo-bk-1920x1080.jpg`
- `images/toastmasters-zoom-virtual-logo-bk-timer-green-1920x1080.jpg`
- `images/toastmasters-zoom-virtual-logo-bk-timer-yellow-1920x1080.jpg`
- `images/toastmasters-zoom-virtual-logo-bk-timer-red-1920x1080.jpg`

— are official Toastmasters International materials and are included here solely for use within Toastmasters club meetings.

---

## Troubleshooting

**No camera in dropdown**
Check OS-level camera permissions for your browser (System Settings > Privacy & Security > Camera on macOS). Try a different browser, or refresh the page after granting permission.

**Background not removed cleanly**
Improve your lighting. Segmentation works best when you are well-lit and your background is relatively static and visually distinct from you. Avoid sitting in front of a bright window.

**OBS can't find the window**
Make sure the browser window is visible and not minimized. On macOS, OBS requires Screen Recording permission (System Settings > Privacy & Security > Screen Recording); add OBS there and restart it.

---

## Development

This is a no-build project. The deployed app is just `index.html`, `styles.css`, `main.js`, `app.js`, `timer-core.js`, and the four `images/*.jpg`. `timer-core.js` holds the pure logic and compositing (unit-tested), `app.js` is the DOM/IO shell, and `main.js` is the browser entry that boots it. Tooling lives in `package.json` as dev-only dependencies.

### Generating the videos

The Zoom virtual-background videos are produced by `tools/generate-bg-video.mjs`. It renders one frame per second with [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) through the app's own `drawTimingRules`/`drawBigTimer` (so the output matches the web app) and pipes the frames straight to ffmpeg. `.github/workflows/release-videos.yml` regenerates them and refreshes the `timer-videos` release whenever the renderer, presets, fonts, or background art change on `main`.

```bash
node tools/generate-bg-video.mjs            # both layouts, default preset -> dist/
node tools/generate-bg-video.mjs all        # both layouts, every preset
node tools/generate-bg-video.mjs prepared --layout=center
node tools/generate-bg-video.mjs --green=1:00 --yellow=1:30 --red=2:00   # custom times
```

Requires ffmpeg on your `PATH` (`brew install ffmpeg`). Output lands in `dist/` (gitignored); the workflow uploads it to the release with `--clobber`, so only the current set is ever stored. The bundled fonts (`fonts/montserrat-bold.ttf`, `fonts/dejavu-sans-mono-bold.ttf`) keep the render identical on any machine.

### Toolchain

| Tool                                                                 | Covers                                                                          | Config                       |
|----------------------------------------------------------------------|---------------------------------------------------------------------------------|------------------------------|
| [Biome](https://biomejs.dev)                                         | JS, CSS, HTML, JSON — format + lint                                             | `biome.json`                 |
| [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) | Markdown — lint + auto-fix                                                      | `.markdownlint-cli2.jsonc`   |
| [fallow](https://fallow.tools)                                       | JS project-graph analysis: dead code, dep hygiene, circular deps, duplication    | `.fallowrc.jsonc`            |
| [Vitest](https://vitest.dev) + jsdom                                 | Unit tests + Istanbul coverage (feeds fallow's CRAP scoring)                    | `vitest.config.js`           |
| [ShellCheck](https://www.shellcheck.net)                             | Shell script static analysis                                                    | (none); system binary        |

ShellCheck is the one tool not installed via npm. Install it with your system
package manager (`brew install shellcheck`, `apt install shellcheck`, etc.); CI
runners ship it preinstalled. The lint scripts call whatever `shellcheck` is on
your `PATH`.

### Commands

```bash
npm install        # one-time setup; also installs the Husky pre-commit hook

npm run lint       # static linters (biome + markdown + shellcheck + fallow dead-code/dupes)
npm test           # run the Vitest unit suite
npm run coverage   # Vitest with Istanbul coverage -> coverage/coverage-final.json
npm run health     # full fallow health report (complexity/CRAP), advisory
npm run health:gate # coverage + fallow audit; the CI complexity/CRAP gate

npm run fix        # apply auto-fixes everywhere
npm run fmt        # format only (no lint)

npm run lint:web      # just biome
npm run lint:md       # just markdown
npm run lint:sh       # just shellcheck
npm run lint:fallow   # fallow dead-code + duplication
```

`health:gate` runs the unit tests with Istanbul coverage and feeds the report to
`fallow audit`, so CRAP scores reflect real test coverage rather than an estimate.
It fails on newly introduced complexity, dead code, or duplication in changed
files; the current tree is clean (no functions exceed the cyclomatic/cognitive/CRAP
thresholds). `npm run health` prints the full advisory report.

### Pre-commit hook

`npm install` wires up a Husky pre-commit hook that runs `lint-staged` against
only the files you have staged:

| Staged files                     | Tool                      | Behavior               |
|----------------------------------|---------------------------|------------------------|
| `*.{js,mjs,css,html,json,jsonc}` | `biome check --write`     | Auto-fixes & re-stages |
| `*.md`                           | `markdownlint-cli2 --fix` | Auto-fixes & re-stages |
| `*.sh`                           | `shellcheck`              | Check only             |

After `lint-staged`, the hook also runs `npm run lint:fallow` (fallow's
dead-code + duplication analysis, ~0.5s). It is project-wide rather than
per-staged-file, so it runs as its own step. The coverage-driven complexity/CRAP
gate stays in CI since it needs the test run.

To skip the hook for an exceptional commit, use `git commit --no-verify`.

### Continuous integration

`.github/workflows/lint.yml` runs `npm run lint` and `npm run coverage` (the
Vitest suite) on every push to `main` and every pull request, plus the
coverage-driven complexity/CRAP gate (`fallow audit`) on pull requests. It checks
out full history and passes the base branch explicitly so the audit can diff
against it. Locally, `npm run health:gate` runs the same gate (auto-detecting the
base), and `npm run fix` resolves most formatting and lint issues before you push.
