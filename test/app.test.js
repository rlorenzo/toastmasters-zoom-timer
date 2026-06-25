import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  app,
  frameStep,
  init,
  listCameras,
  loadSettings,
  pauseTimer,
  readCustomFromInputs,
  resetTimer,
  resizeOffscreenCanvases,
  runKeyAction,
  scheduleNext,
  segmentFrame,
  showCustomError,
  startCamera,
  startTimer,
  syncPresetUI,
  toggleBell,
  toggleStartPause,
  updateClockDom,
  updateStateLabelDom,
} from '../app.js';

// app.js binds the DOM contract from test/setup.js once at import. Each test resets
// the shared module state, DOM element state, and localStorage rather than
// re-importing, so the bound references stay valid.
const $ = (id) => document.getElementById(id);

beforeEach(() => {
  window.localStorage.clear();
  document.body.className = '';
  Object.assign(app, {
    mode: 'idle',
    elapsed: 0,
    lastBgState: 'start',
    preset: 'prepared',
    customTimes: { green: 300, yellow: 360, red: 420 },
    bellEnabled: false,
    stream: null,
    segmenter: null,
    personBox: null,
    missedFrames: 0,
    audioCtx: null,
    wakeLock: null,
  });
  for (const id of ['custom-green', 'custom-yellow', 'custom-red']) $(id).value = '';
  $('camera-select').innerHTML = '';
  $('clock-html').textContent = '';
  const sl = $('state-label-html');
  sl.textContent = '';
  sl.removeAttribute('data-state');
  for (const p of document.querySelectorAll('p.error')) p.remove();
});

// Install a fake navigator.mediaDevices and stub the <video> element's IO so the
// camera/boot paths run without real getUserMedia. Returns the spies for asserts.
function mockCameraIO({ stream, devices = [] } = {}) {
  const getUserMedia = vi
    .fn()
    .mockResolvedValue(stream ?? { getTracks: () => [], getVideoTracks: () => [] });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue(devices) },
  });
  const video = $('video-source');
  Object.defineProperty(video, 'srcObject', { writable: true, configurable: true, value: null });
  video.play = vi.fn().mockResolvedValue(undefined);
  return { getUserMedia, video };
}

describe('loadSettings', () => {
  it('applies persisted preset, custom times, and bell', () => {
    window.localStorage.setItem('tmtimer.preset', 'evaluation');
    window.localStorage.setItem(
      'tmtimer.customTimes',
      JSON.stringify({ green: 10, yellow: 20, red: 30 })
    );
    window.localStorage.setItem('tmtimer.bell', '1');
    loadSettings();
    expect(app.preset).toBe('evaluation');
    expect(app.customTimes).toEqual({ green: 10, yellow: 20, red: 30 });
    expect(app.bellEnabled).toBe(true);
  });

  it('keeps defaults when storage is empty', () => {
    loadSettings();
    expect(app.preset).toBe('prepared');
    expect(app.bellEnabled).toBe(false);
  });
});

describe('syncPresetUI', () => {
  it('reflects the active preset and custom-field visibility', () => {
    app.preset = 'custom';
    app.customTimes = { green: 60, yellow: 90, red: 120 };
    syncPresetUI();
    expect($('preset-select').value).toBe('custom');
    expect($('custom-fields').hidden).toBe(false);
    expect($('custom-green').value).toBe('1:00');
    expect($('custom-red').value).toBe('2:00');
  });

  it('hides custom fields for a named preset', () => {
    app.preset = 'prepared';
    syncPresetUI();
    expect($('custom-fields').hidden).toBe(true);
  });
});

describe('readCustomFromInputs / showCustomError', () => {
  it('returns parsed times for valid input', () => {
    $('custom-green').value = '1:00';
    $('custom-yellow').value = '1:30';
    $('custom-red').value = '2:00';
    expect(readCustomFromInputs()).toEqual({ green: 60, yellow: 90, red: 120 });
    expect(document.querySelector('#custom-fields p.error')).toBeNull();
  });

  it('shows an error and returns null for invalid input', () => {
    $('custom-green').value = 'nope';
    expect(readCustomFromInputs()).toBeNull();
    const err = document.querySelector('#custom-fields p.error');
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/m:ss/);
  });

  it('clears a prior error once input becomes valid', () => {
    showCustomError('boom');
    expect(document.querySelector('#custom-fields p.error')).not.toBeNull();
    $('custom-green').value = '1:00';
    $('custom-yellow').value = '1:30';
    $('custom-red').value = '2:00';
    readCustomFromInputs();
    expect(document.querySelector('#custom-fields p.error')).toBeNull();
  });
});

describe('updateStateLabelDom / updateClockDom', () => {
  it('writes the state label and data-state', () => {
    const el = $('state-label-html');
    updateStateLabelDom('green', false);
    expect(el.textContent).toBe('GREEN');
    expect(el.getAttribute('data-state')).toBe('green');
    updateStateLabelDom('start', false);
    expect(el.textContent).toBe('START');
    expect(el.hasAttribute('data-state')).toBe(false);
    updateStateLabelDom('red', true);
    expect(el.textContent).toBe('OVERTIME');
    expect(el.getAttribute('data-state')).toBe('overtime');
  });

  it('writes the formatted clock', () => {
    app.elapsed = 125;
    updateClockDom();
    expect($('clock-html').textContent).toBe('2:05');
  });
});

describe('timer controls', () => {
  it('start -> pause -> reset cycles mode', () => {
    startTimer();
    expect(app.mode).toBe('running');
    expect(document.querySelector('#btn-start-pause .btn-label').textContent).toBe('Pause');
    pauseTimer();
    expect(app.mode).toBe('paused');
    app.elapsed = 42;
    resetTimer();
    expect(app.mode).toBe('idle');
    expect(app.elapsed).toBe(0);
  });

  it('toggleStartPause flips between start and pause', () => {
    toggleStartPause();
    expect(app.mode).toBe('running');
    toggleStartPause();
    expect(app.mode).toBe('paused');
  });

  it('toggleBell flips state + persists', () => {
    toggleBell();
    expect(app.bellEnabled).toBe(true);
    expect(window.localStorage.getItem('tmtimer.bell')).toBe('1');
  });
});

describe('runKeyAction', () => {
  it('dispatches preset selection', () => {
    runKeyAction('preset:1'); // evaluation
    expect(app.preset).toBe('evaluation');
    expect(window.localStorage.getItem('tmtimer.preset')).toBe('evaluation');
  });

  it('ignores an out-of-range preset index', () => {
    const before = app.preset;
    runKeyAction('preset:9');
    expect(app.preset).toBe(before);
  });

  it('dispatches timer + view actions', () => {
    runKeyAction('toggle');
    expect(app.mode).toBe('running');
    runKeyAction('reset');
    expect(app.mode).toBe('idle');
    runKeyAction('bell');
    expect(app.bellEnabled).toBe(true);
    runKeyAction('stage-clean');
    expect(document.body.classList.contains('stage-clean')).toBe(true);
    // jsdom doesn't implement <dialog>.showModal; stub it to cover openHelp.
    const guide = $('setup-guide');
    guide.showModal = vi.fn();
    runKeyAction('help');
    expect(guide.showModal).toHaveBeenCalled();
  });
});

describe('keydown handler', () => {
  function keydown(key, opts = {}) {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    document.dispatchEvent(e);
    return e;
  }

  it('runs the mapped action and prevents default for space', () => {
    const e = keydown(' ');
    expect(app.mode).toBe('running');
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores keys while a modifier is held', () => {
    keydown(' ', { ctrlKey: true });
    expect(app.mode).toBe('idle');
  });

  it('ignores unbound keys', () => {
    keydown('z');
    expect(app.mode).toBe('idle');
  });

  it('ignores keys while a text field is focused', () => {
    const inp = $('custom-green');
    inp.focus();
    keydown(' ');
    expect(app.mode).toBe('idle');
    inp.blur();
  });
});

describe('listCameras', () => {
  it('populates the camera select from enumerated devices', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam-a', label: 'Cam A' },
          { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
          { kind: 'videoinput', deviceId: 'cam-b', label: '' },
        ]),
      },
    });
    window.localStorage.setItem('tmtimer.cameraId', 'cam-b');
    await listCameras();
    const sel = $('camera-select');
    expect(sel.options).toHaveLength(2);
    expect(sel.options[0].value).toBe('cam-a');
    expect(sel.value).toBe('cam-b'); // saved id reselected
  });
});

describe('render loop', () => {
  const video = () => $('video-source');
  function setVideoReady() {
    Object.defineProperty(video(), 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video(), 'paused', { configurable: true, value: false });
    Object.defineProperty(video(), 'ended', { configurable: true, value: false });
  }

  it('resizeOffscreenCanvases runs for sized and default video', () => {
    Object.defineProperty(video(), 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video(), 'videoHeight', { configurable: true, value: 480 });
    expect(() => resizeOffscreenCanvases()).not.toThrow();
    resizeOffscreenCanvases(); // second call hits the no-change branch
    Object.defineProperty(video(), 'videoWidth', { configurable: true, value: 0 });
    expect(() => resizeOffscreenCanvases()).not.toThrow(); // falls back to 1280x720
  });

  it('frameStep advances the clock and schedules the next frame while running', async () => {
    window.requestAnimationFrame = vi.fn();
    delete video().requestVideoFrameCallback;
    startTimer();
    app.lastTickMs = 1000;
    await frameStep(2000, null);
    expect(app.elapsed).toBeCloseTo(1, 1);
    expect($('clock-html').textContent).toBe('0:01');
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('frameStep segments in idle mode when the video is ready', async () => {
    window.requestAnimationFrame = vi.fn();
    setVideoReady();
    app.mode = 'idle';
    const close = vi.fn();
    app.segmenter = {
      segmentForVideo: () => ({
        categoryMask: {
          width: 4,
          height: 4,
          getAsUint8Array: () => Uint8Array.from({ length: 16 }, (_, i) => i % 2),
          close,
        },
        close,
      }),
    };
    await expect(frameStep(1000, { mediaTime: 0.5 })).resolves.toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('segmentFrame draws raw video when there is no segmenter', async () => {
    app.segmenter = null;
    await expect(segmentFrame(video(), 0)).resolves.toBeUndefined();
  });

  it('segmentFrame bails when the category mask is missing', async () => {
    app.segmenter = { segmentForVideo: () => ({ categoryMask: null, close: vi.fn() }) };
    await expect(segmentFrame(video(), 0)).resolves.toBeUndefined();
  });

  it('segmentFrame keeps the last box through brief dropouts, then releases it', async () => {
    // Segmenter that reports an all-background mask (no person detected).
    app.segmenter = {
      segmentForVideo: () => ({
        categoryMask: {
          width: 4,
          height: 4,
          getAsUint8Array: () => new Uint8Array(16), // all zeros => no person
          close: vi.fn(),
        },
        close: vi.fn(),
      }),
    };
    app.personBox = { x: 0.2, y: 0.1, w: 0.5, h: 0.8 };
    // Up to the threshold the stale box is retained (smooths tracking blips).
    // Frames run sequentially so the missed-frame counter advances in order.
    await Array.from({ length: 60 }).reduce(
      (p) => p.then(() => segmentFrame(video(), 0)),
      Promise.resolve()
    );
    expect(app.personBox).not.toBeNull();
    // One frame past it, the box is released so framing can reset / re-enter.
    await segmentFrame(video(), 0);
    expect(app.personBox).toBeNull();
  });

  it('scheduleNext prefers requestVideoFrameCallback when available', () => {
    video().requestVideoFrameCallback = vi.fn();
    scheduleNext();
    expect(video().requestVideoFrameCallback).toHaveBeenCalled();
  });

  it('scheduleNext falls back to requestAnimationFrame', () => {
    delete video().requestVideoFrameCallback;
    window.requestAnimationFrame = vi.fn();
    scheduleNext();
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });
});

describe('startCamera', () => {
  function fakeStream(trackSettings) {
    const track = { stop: vi.fn(), getSettings: () => trackSettings };
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  }

  it('acquires a stream, lists cameras, and persists the active device', async () => {
    const stream = fakeStream({ deviceId: 'cam-x' });
    mockCameraIO({ stream });

    await startCamera('cam-x');
    expect(app.stream).toBe(stream);
    expect(window.localStorage.getItem('tmtimer.cameraId')).toBe('cam-x');
  });

  it('surfaces a sidebar error when permission is denied', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(err) },
    });
    await startCamera();
    const errP = document.querySelector('#sidebar p.error');
    expect(errP).not.toBeNull();
    expect(errP.textContent).toMatch(/permission denied/);
  });

  it('stops the prior stream and falls back to the requested deviceId', async () => {
    const oldTrack = { stop: vi.fn() };
    app.stream = { getTracks: () => [oldTrack] };
    // New track exposes no resolved deviceId, so the requested id is persisted.
    const newTrack = { stop: vi.fn(), getSettings: () => ({}) };
    const stream = { getTracks: () => [newTrack], getVideoTracks: () => [newTrack] };
    mockCameraIO({ stream });

    await startCamera('cam-req');
    expect(oldTrack.stop).toHaveBeenCalled(); // stopStream ran
    expect(window.localStorage.getItem('tmtimer.cameraId')).toBe('cam-req');
  });

  it('listCameras swallows enumerateDevices failures', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await expect(listCameras()).resolves.toBeUndefined();
  });
});

describe('audio + wake lock', () => {
  function mockAudioContext() {
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const osc = { frequency: {}, connect: vi.fn(() => gain), start: vi.fn(), stop: vi.fn() };
    // ensureAudio does `new Ctor()`, so the stub must be constructable; expose the
    // node factories as instance fields.
    window.AudioContext = class {
      currentTime = 0;
      createOscillator = () => osc;
      createGain = () => gain;
      destination = {};
    };
    return { osc };
  }

  it('plays a bell beep on a running state transition', async () => {
    const { osc } = mockAudioContext();
    window.requestAnimationFrame = vi.fn();
    delete $('video-source').requestVideoFrameCallback;
    app.bellEnabled = true;
    app.mode = 'running';
    app.lastBgState = 'start';
    app.elapsed = 300; // crosses into "green" for the default prepared preset
    app.lastTickMs = 1000;
    await frameStep(1000, null);
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
  });

  it('acquires a wake lock on start and releases it on pause', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    startTimer();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    pauseTimer();
    await Promise.resolve();
    expect(release).toHaveBeenCalled();
  });

  it('re-acquires the wake lock when the tab becomes visible while running', async () => {
    const request = vi.fn().mockResolvedValue({ release: vi.fn() });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    app.mode = 'running';
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(request).toHaveBeenCalled();
  });
});

describe('event wiring', () => {
  it('preset-select change updates and persists the preset', () => {
    const sel = $('preset-select');
    sel.value = 'evaluation';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.preset).toBe('evaluation');
    expect(window.localStorage.getItem('tmtimer.preset')).toBe('evaluation');
  });

  it('custom time inputs persist when valid', () => {
    app.preset = 'custom';
    $('custom-green').value = '1:00';
    $('custom-yellow').value = '1:30';
    $('custom-red').value = '2:00';
    $('custom-red').dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.customTimes).toEqual({ green: 60, yellow: 90, red: 120 });
  });

  it('camera-select change starts the chosen camera', () => {
    const { getUserMedia } = mockCameraIO();
    const sel = $('camera-select');
    const opt = document.createElement('option');
    opt.value = 'cam-z';
    sel.appendChild(opt);
    sel.value = 'cam-z';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getUserMedia).toHaveBeenCalled();
  });

  it('control buttons dispatch their actions', () => {
    $('btn-start-pause').click();
    expect(app.mode).toBe('running');
    $('btn-reset').click();
    expect(app.mode).toBe('idle');
    $('btn-bell').click();
    expect(app.bellEnabled).toBe(true);
    const guide = $('setup-guide');
    guide.open = false;
    guide.showModal = vi.fn();
    $('btn-help').click();
    expect(guide.showModal).toHaveBeenCalled();
  });
});

describe('init boot', () => {
  it('preloads, wires the loop, and exposes the debug surface', async () => {
    const RealImage = window.Image;
    // Image stub: assigning src resolves loadImage via onload.
    window.Image = class {
      set src(_v) {
        queueMicrotask(() => this.onload?.());
      }
    };
    const stage = $('stage');
    stage.captureStream = vi.fn(() => ({ id: 'cap' }));
    const track = { stop: vi.fn(), getSettings: () => ({ deviceId: 'cam-x' }) };
    const { video } = mockCameraIO({
      stream: { getTracks: () => [track], getVideoTracks: () => [track] },
      devices: [{ kind: 'videoinput', deviceId: 'cam-x', label: 'X' }],
    });
    window.requestAnimationFrame = vi.fn();
    delete video.requestVideoFrameCallback;

    await init();

    expect(stage.captureStream).toHaveBeenCalledWith(30);
    expect(window.__tmtimer).toBeTruthy();

    // Debug surface: setElapsed clamps + pauses, getState reports framing state.
    window.__tmtimer.setElapsed(90);
    expect(app.elapsed).toBe(90);
    window.__tmtimer.setElapsed(-3);
    expect(app.elapsed).toBe(0);
    const st = window.__tmtimer.getState();
    expect(st).toMatchObject({ mode: expect.any(String), preset: expect.any(String) });
    expect(st).toHaveProperty('personBox');

    window.Image = RealImage;
  });
});
