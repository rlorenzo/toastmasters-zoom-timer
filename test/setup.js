// Shared test setup, run before each test file.

// jsdom does not implement the canvas 2D context. Return a minimal recording stub
// so the compositing pipeline (renderFrame, segmentFrame) can run under test
// instead of jsdom logging a noisy "Not implemented: getContext" line. Methods are
// no-ops; measureText/createImageData return the shapes the code reads.
function makeCtxStub() {
  const ctx = {
    measureText: (t) => ({ width: String(t).length * 10 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  const noops = [
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'arcTo',
    'rect',
    'clip',
    'closePath',
    'fill',
    'stroke',
    'drawImage',
    'fillRect',
    'strokeText',
    'fillText',
    'clearRect',
    'putImageData',
    'strokeRect',
  ];
  for (const m of noops) ctx[m] = () => {};
  // The plain theme paints a radial flood; the stub gradient just has to accept
  // color stops and be assignable to fillStyle.
  ctx.createRadialGradient = () => ({ addColorStop: () => {} });
  return ctx;
}
HTMLCanvasElement.prototype.getContext = () => makeCtxStub();

// app.js binds module-level DOM refs and registers listeners at import time, so
// the index.html DOM contract must exist before it is statically imported. This
// fixture mirrors the element IDs app.js reads. Tests reset element state (values,
// classes, injected error nodes) in beforeEach rather than replacing the nodes, so
// the bound references stay valid.
document.body.innerHTML = `
  <video id="video-source"></video>
  <div id="stage-wrap"><canvas id="stage"></canvas></div>
  <dialog id="setup-guide"></dialog>
  <aside id="sidebar"></aside>
  <button id="btn-start-pause"><span class="btn-label">Start</span></button>
  <button id="btn-reset"></button>
  <button id="btn-bell"></button>
  <button id="btn-help"></button>
  <button id="btn-theme"></button>
  <select id="camera-select"></select>
  <select id="preset-select">
    <option value="table-topics"></option>
    <option value="evaluation"></option>
    <option value="ice-breaker"></option>
    <option value="prepared"></option>
    <option value="long-speech"></option>
    <option value="custom"></option>
  </select>
  <div id="custom-fields">
    <input id="custom-green" />
    <input id="custom-yellow" />
    <input id="custom-red" />
  </div>
  <div id="clock-html"></div>
  <div id="state-label-html"></div>
`;
