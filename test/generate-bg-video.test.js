import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET, PRESETS } from '../timer-core.js';
import {
  parseArgs,
  resolveLayouts,
  selectJobs,
  timerZone,
  totalSeconds,
  writeFrame,
} from '../tools/generate-bg-video.mjs';

// Minimal stand-in for ffmpeg's stdin: write() returns a fixed backpressure
// signal, and drain/close/error are driven by the test via emit().
function fakeStdin(writeReturns) {
  const s = new EventEmitter();
  s.write = () => writeReturns;
  return s;
}

describe('parseArgs', () => {
  it('returns defaults with no args', () => {
    const { opts, custom, positional } = parseArgs([]);
    expect(opts).toMatchObject({ tail: 60, fps: 15, layout: null });
    expect(custom).toEqual({});
    expect(positional).toEqual([]);
  });

  it('collects positionals and applies value flags', () => {
    const { opts, positional } = parseArgs([
      'prepared',
      '--tail=30',
      '--fps=24',
      '--layout=center',
    ]);
    expect(positional).toEqual(['prepared']);
    expect(opts).toMatchObject({ tail: 30, fps: 24, layout: 'center' });
  });

  it('parses custom thresholds to seconds', () => {
    expect(parseArgs(['--green=1:00', '--yellow=1:30', '--red=2:00']).custom).toEqual({
      green: 60,
      yellow: 90,
      red: 120,
    });
  });

  it('rejects a bad --layout', () => {
    expect(() => parseArgs(['--layout=top'])).toThrow(/corner\|center/);
  });

  it('rejects a non-numeric --fps', () => {
    expect(() => parseArgs(['--fps=foo'])).toThrow(/--fps must be a number/);
  });

  it('rejects a malformed custom time instead of silently ignoring it', () => {
    expect(() => parseArgs(['--green=abc'])).toThrow(/--green must be m:ss/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown flag: --nope/);
  });
});

describe('selectJobs', () => {
  it('defaults to the prepared preset', () => {
    expect(selectJobs({}, [])).toEqual([[DEFAULT_PRESET, PRESETS[DEFAULT_PRESET]]]);
  });

  it('maps "all" to every preset', () => {
    expect(selectJobs({}, ['all']).map(([name]) => name)).toEqual(Object.keys(PRESETS));
  });

  it('selects a single named preset', () => {
    expect(selectJobs({}, ['evaluation'])).toEqual([['evaluation', PRESETS.evaluation]]);
  });

  it('throws on an unknown preset', () => {
    expect(() => selectJobs({}, ['nope'])).toThrow(/Unknown preset "nope"/);
  });

  it('builds a custom job from valid thresholds', () => {
    expect(selectJobs({ green: 60, yellow: 90, red: 120 }, [])).toEqual([
      ['custom', { green: 60, yellow: 90, red: 120 }],
    ]);
  });

  it('rejects out-of-order custom thresholds', () => {
    expect(() => selectJobs({ green: 90, yellow: 60, red: 120 }, [])).toThrow(
      /green < yellow < red/
    );
  });
});

describe('resolveLayouts', () => {
  it('renders both layouts by default', () => {
    expect(resolveLayouts({ layout: null })).toEqual(['corner', 'center']);
  });

  it('renders just the requested layout', () => {
    expect(resolveLayouts({ layout: 'center' })).toEqual(['center']);
  });
});

describe('timerZone', () => {
  it('gives the big centered zone for center', () => {
    expect(timerZone('center')).toMatchObject({ x: 140, w: 1640 });
  });

  it('gives a compact top-right zone for corner', () => {
    const z = timerZone('corner');
    expect(z.x + z.w).toBeLessThanOrEqual(1920);
    expect(z.w).toBeLessThan(timerZone('center').w);
  });
});

describe('totalSeconds', () => {
  it('is red plus the overtime tail', () => {
    expect(totalSeconds({ green: 300, yellow: 360, red: 420 }, 60)).toBe(480);
  });
});

describe('writeFrame', () => {
  const buf = Buffer.alloc(4);

  it('resolves immediately when the write is accepted', async () => {
    await expect(writeFrame(fakeStdin(true), buf)).resolves.toBeUndefined();
  });

  it('waits for drain under backpressure, then resolves', async () => {
    const s = fakeStdin(false);
    const p = writeFrame(s, buf);
    s.emit('drain');
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects (does not hang) if the stream closes before draining', async () => {
    const s = fakeStdin(false);
    const p = writeFrame(s, buf);
    s.emit('close');
    await expect(p).rejects.toThrow(/closed before a frame/);
  });
});
