import { RPPGEngine, SignatureCalibrator, FS, BPM_RANGE } from './rppg.js';

// Face ROI is split into a 4 x 7 grid of skin patches (28 areas, as in the
// lab dataset); the robust SNR selection keeps the 5 best ones per window.
const GRID_COLS = 4;
const GRID_ROWS = 7;
const N_PATCHES = GRID_COLS * GRID_ROWS;
const PROC_WIDTH = 320;
const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const METHODS = { pos: 'POS', pbv: 'PBV', dis: 'DIS' };

// all element ids in the demo section carry an `rppg-` prefix
const $ = (id) => document.getElementById(`rppg-${id}`);
const els = {
  start: $('start'), stop: $('stop'), video: $('video'), view: $('view'), placeholder: $('placeholder'),
  status: $('status'), tracker: $('tracker'), fps: $('fps'), progress: $('progress'), progressBar: $('progress-bar'),
  spectrum: $('spectrum'), spectrogram: $('spectrogram'), specMethod: $('spec-method'),
  sigStatus: $('sig-status'), sigMeta: $('sig-meta'), sigReset: $('sig-reset'),
};
for (const m of Object.keys(METHODS)) {
  els[m] = { bpm: $(`${m}-bpm`), quality: $(`${m}-quality`), wave: $(`${m}-wave`) };
}

const proc = document.createElement('canvas');
const procCtx = proc.getContext('2d', { willReadFrequently: true });
const viewCtx = els.view.getContext('2d');

let engine = null;
// the signature belongs to the camera and lighting, so it survives restarts
const calibrator = new SignatureCalibrator();
let useCalibrated = true;
let stream = null;
let detector = null;
let detectorState = 'none';
let running = false;
let face = null;          // smoothed face box in video pixels
let lastFaceT = 0;
let lastDetectT = 0;
let lastUiT = 0;
let lastEstimateT = 0;
let history = emptyHistory();
let estimates = {};
let spectrogram = [];
let specMethod = 'dis';

function css(name) {
  return getComputedStyle(els.view).getPropertyValue(name).trim();
}

function emptyHistory() {
  return Object.fromEntries(Object.keys(METHODS).map((m) => [m, []]));
}

function setStatus(text) {
  els.status.textContent = text;
}

// ---------------------------------------------------------------------------
// Face detection (MediaPipe BlazeFace). If it cannot be loaded, the demo falls
// back to a fixed ROI in the centre of the frame.

async function loadDetector() {
  detectorState = 'loading';
  updateTracker();
  try {
    const vision = await import(`${MEDIAPIPE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE}/wasm`);
    const make = (delegate) => vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });
    try {
      detector = await make('GPU');
    } catch {
      detector = await make('CPU');
    }
    detectorState = 'ready';
  } catch (err) {
    console.warn('Face detector unavailable, using fixed ROI', err);
    detectorState = 'failed';
  }
  updateTracker();
}

function updateTracker() {
  const text = {
    none: '',
    loading: 'Loading face tracker…',
    ready: face && performance.now() - lastFaceT < 1000 ? 'Face tracked' : 'Looking for a face…',
    failed: 'Fixed ROI (face tracker unavailable)',
  }[detectorState];
  els.tracker.textContent = text;
  els.tracker.dataset.state = detectorState === 'ready' && face && performance.now() - lastFaceT < 1000 ? 'ok' : detectorState;
}

function defaultBox(w, h) {
  const bw = Math.min(w, h) * 0.42;
  return { x: (w - bw) / 2, y: h * 0.25, w: bw, h: bw * 1.1 };
}

function trackFace(now) {
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (detector && now > lastDetectT) {
    lastDetectT = now;
    const res = detector.detectForVideo(els.video, now);
    const det = res.detections && res.detections[0];
    if (det) {
      const b = det.boundingBox;
      const box = { x: b.originX, y: b.originY, w: b.width, h: b.height };
      if (!face) face = box;
      else {
        // light smoothing: detector jitter would otherwise leak into the colour traces
        const a = 0.3;
        for (const k of ['x', 'y', 'w', 'h']) face[k] += a * (box[k] - face[k]);
      }
      lastFaceT = now;
    }
  }
  if (face && (now - lastFaceT < 1500 || detectorState !== 'ready')) return face;
  if (detectorState === 'ready') face = null;
  return defaultBox(vw, vh);
}

// Skin ROI derived from the face box: extends slightly upward to include the
// forehead and is trimmed at the sides to avoid hair and background.
function roiFromFace(box) {
  return { x: box.x + box.w * 0.12, y: box.y - box.h * 0.12, w: box.w * 0.76, h: box.h * 1.05 };
}

function patchMeans(roi, scale) {
  const x0 = Math.max(0, Math.floor(roi.x * scale));
  const y0 = Math.max(0, Math.floor(roi.y * scale));
  const x1 = Math.min(proc.width, Math.ceil((roi.x + roi.w) * scale));
  const y1 = Math.min(proc.height, Math.ceil((roi.y + roi.h) * scale));
  const colors = new Float64Array(N_PATCHES * 3);
  if (x1 - x0 < GRID_COLS || y1 - y0 < GRID_ROWS) return null;
  const data = procCtx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const W = x1 - x0, H = y1 - y0;
  for (let r = 0; r < GRID_ROWS; r++) {
    const ya = Math.floor((r * H) / GRID_ROWS), yb = Math.floor(((r + 1) * H) / GRID_ROWS);
    for (let c = 0; c < GRID_COLS; c++) {
      const xa = Math.floor((c * W) / GRID_COLS), xb = Math.floor(((c + 1) * W) / GRID_COLS);
      let R = 0, G = 0, B = 0, n = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * W + x) * 4;
          R += data[i]; G += data[i + 1]; B += data[i + 2]; n++;
        }
      }
      const p = r * GRID_COLS + c;
      colors[3 * p] = R / n + 1e-3;
      colors[3 * p + 1] = G / n + 1e-3;
      colors[3 * p + 2] = B / n + 1e-3;
    }
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Frame loop

function onFrame(now, meta) {
  if (!running) return;
  const t = meta && meta.captureTime ? meta.captureTime : now;
  processFrame(t, performance.now());
  scheduleFrame();
}

let lastVideoTime = -1;
function onAnimationFrame(now) {
  if (!running) return;
  if (els.video.currentTime !== lastVideoTime) {
    lastVideoTime = els.video.currentTime;
    processFrame(now, now);
  }
  scheduleFrame();
}

function scheduleFrame() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) els.video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onAnimationFrame);
}

function processFrame(t, now) {
  const video = els.video;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = PROC_WIDTH / vw;
  if (proc.width !== PROC_WIDTH) {
    proc.width = PROC_WIDTH;
    proc.height = Math.round(vh * scale);
  }
  procCtx.drawImage(video, 0, 0, proc.width, proc.height);

  const box = trackFace(now);
  const roi = roiFromFace(box);
  const colors = patchMeans(roi, scale);
  if (colors) engine.push(t, colors, [box.x + box.w / 2, box.y + box.h / 2]);

  drawView(roi);
  if (now - lastEstimateT > 500) {
    lastEstimateT = now;
    updateEstimates();
  }
  if (now - lastUiT > 66) {
    lastUiT = now;
    updateUi();
  }
}

function updateEstimates() {
  for (const m of Object.keys(METHODS)) {
    const est = engine.estimate(m);
    estimates[m] = est;
    if (!est) { history[m] = []; continue; }
    history[m].push(est.bpm);
    if (history[m].length > 6) history[m].shift();
  }
  const est = estimates[specMethod];
  if (est) {
    spectrogram.push(normalise(est.spectrum));
    if (spectrogram.length > 120) spectrogram.shift();
  }
}

function normalise(x) {
  const max = Math.max(...x) || 1;
  return Float64Array.from(x, (v) => v / max);
}

// ---------------------------------------------------------------------------
// Rendering

function drawView(roi) {
  const video = els.video;
  const canvas = els.view;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = Math.round((cw * video.videoHeight) / video.videoWidth);
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const s = canvas.width / video.videoWidth;
  const ctx = viewCtx;
  ctx.save();
  ctx.setTransform(-1, 0, 0, 1, canvas.width, 0); // mirror like a selfie camera
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.scale(s, s);

  const selected = new Set(engine.selected[specMethod] || []);
  const accent = css('--accent');
  ctx.lineWidth = 1 / s * dpr;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const p = r * GRID_COLS + c;
      const x = roi.x + (c * roi.w) / GRID_COLS, y = roi.y + (r * roi.h) / GRID_ROWS;
      const w = roi.w / GRID_COLS, h = roi.h / GRID_ROWS;
      if (selected.has(p)) {
        ctx.fillStyle = accent + '55';
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.strokeRect(x, y, w, h);
    }
  }
  ctx.lineWidth = 2.5 / s * dpr;
  ctx.strokeStyle = accent;
  ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
  ctx.restore();
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawWave(canvas, pulse, color) {
  const { ctx, w, h } = setupCanvas(canvas);
  const n = Math.min(pulse.length, FS * 8);
  if (n < 2) return;
  const seg = pulse.slice(pulse.length - n);
  let max = 1e-6;
  for (const v of seg) max = Math.max(max, Math.abs(v));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const total = FS * 8;
  seg.forEach((v, i) => {
    const x = ((total - n + i) / (total - 1)) * w;
    const y = h / 2 - (v / max) * (h / 2 - 4);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawAxisLabels(ctx, w, h, pad) {
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let bpm = 60; bpm <= 180; bpm += 30) {
    const x = pad.l + ((bpm - BPM_RANGE[0]) / (BPM_RANGE[1] - BPM_RANGE[0])) * (w - pad.l - pad.r);
    ctx.fillText(String(bpm), x, h - 4);
  }
}

function drawSpectrum() {
  const { ctx, w, h } = setupCanvas(els.spectrum);
  const pad = { l: 8, r: 8, t: 8, b: 20 };
  ctx.strokeStyle = css('--grid');
  ctx.lineWidth = 1;
  for (let bpm = 60; bpm <= 180; bpm += 30) {
    const x = pad.l + ((bpm - BPM_RANGE[0]) / (BPM_RANGE[1] - BPM_RANGE[0])) * (w - pad.l - pad.r);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
  }
  drawAxisLabels(ctx, w, h, pad);
  for (const m of Object.keys(METHODS)) {
    const est = estimates[m];
    if (!est) continue;
    const lo = BPM_RANGE[0] - est.bpmMin, hi = BPM_RANGE[1] - est.bpmMin;
    const seg = est.spectrum.slice(lo, hi + 1);
    const max = Math.max(...seg) || 1;
    ctx.strokeStyle = css(`--${m}`);
    ctx.lineWidth = 2;
    ctx.beginPath();
    seg.forEach((v, i) => {
      const x = pad.l + (i / (seg.length - 1)) * (w - pad.l - pad.r);
      const y = h - pad.b - (v / max) * (h - pad.t - pad.b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

// Perceptual colour ramp for the spectrogram (dark -> accent -> light)
function ramp(v) {
  const stops = [[13, 17, 40], [42, 52, 140], [16, 148, 140], [120, 210, 90], [250, 240, 120]];
  const x = Math.min(0.9999, Math.max(0, v)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return `rgb(${a.map((c, k) => Math.round(c + f * (b[k] - c))).join(',')})`;
}

function drawSpectrogram() {
  const { ctx, w, h } = setupCanvas(els.spectrogram);
  const pad = { l: 32, b: 4, t: 4 };
  ctx.fillStyle = ramp(0);
  ctx.fillRect(pad.l, pad.t, w - pad.l, h - pad.t - pad.b);
  const cols = 120;
  const colW = (w - pad.l) / cols;
  const est = estimates[specMethod];
  const bpmMin = est ? est.bpmMin : 30;
  const lo = BPM_RANGE[0] - bpmMin, hi = BPM_RANGE[1] - bpmMin;
  const rowH = (h - pad.t - pad.b) / (hi - lo + 1);
  spectrogram.forEach((col, j) => {
    const x = pad.l + (cols - spectrogram.length + j) * colW;
    for (let i = lo; i <= hi; i++) {
      ctx.fillStyle = ramp(col[i]);
      ctx.fillRect(x, h - pad.b - (i - lo + 1) * rowH, colW + 0.5, rowH + 0.5);
    }
  });
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let bpm = 60; bpm <= 180; bpm += 30) {
    ctx.fillText(String(bpm), pad.l - 6, h - pad.b - (bpm - BPM_RANGE[0] + 0.5) * rowH);
  }
}

function updateSignature() {
  const sig = calibrator.signature;
  ['r', 'g', 'b'].forEach((ch, k) => {
    $(`sig-${ch}`).style.width = `${sig[k] * 100}%`;
    $(`prior-${ch}`).style.left = `${calibrator.prior[k] * 100}%`;
    $(`sig-${ch}-val`).textContent = sig[k].toFixed(2);
  });
  const n = calibrator.accepted;
  let status = 'Prior';
  if (n >= calibrator.tau) status = 'Calibrated';
  else if (n > 0) status = `Calibrating ${Math.round((100 * n) / calibrator.tau)}%`;
  if (running && calibrator.lastReason === 'motion') status += ' · paused (motion)';
  els.sigStatus.textContent = status;
  els.sigStatus.dataset.state = n >= calibrator.tau ? 'ok' : '';
  els.sigMeta.textContent = `${calibrator.deviation.toFixed(1)}° from prior · ${n} of ${calibrator.windows} windows used`;
}

function quality(snrDb) {
  if (snrDb >= 2) return ['Good signal', 'good'];
  if (snrDb >= -3) return ['Fair signal', 'fair'];
  return ['Weak signal — hold still', 'poor'];
}

function updateUi() {
  const secs = engine.seconds;
  const pct = Math.min(1, secs / 10);
  els.progressBar.style.width = `${pct * 100}%`;
  els.progress.hidden = pct >= 1;
  els.fps.textContent = engine.frameRate ? `${engine.frameRate.toFixed(0)} fps camera` : '';
  if (secs < 5) setStatus(`Collecting signal… ${Math.max(0, 5 - secs).toFixed(0)} s`);
  else if (secs < 10) setStatus('Measuring (refining with a 10 s window)…');
  else setStatus('Measuring — keep still and breathe normally');
  updateTracker();

  for (const m of Object.keys(METHODS)) {
    const ui = els[m];
    drawWave(ui.wave, engine.pulse[m], css(`--${m}`));
    const est = estimates[m];
    if (!est || !history[m].length) {
      ui.bpm.textContent = '--';
      ui.quality.textContent = 'Waiting for signal';
      ui.quality.dataset.level = '';
      continue;
    }
    const sorted = [...history[m]].sort((a, b) => a - b);
    ui.bpm.textContent = String(sorted[sorted.length >> 1]);
    const [label, level] = quality(est.snrDb);
    ui.quality.textContent = label;
    ui.quality.dataset.level = level;
  }
  drawSpectrum();
  drawSpectrogram();
  updateSignature();
}

// ---------------------------------------------------------------------------
// Start / stop

async function start() {
  els.start.disabled = true;
  setStatus('Requesting camera access…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
  } catch (err) {
    els.start.disabled = false;
    setStatus(err && err.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
      : 'Could not open a camera on this device.');
    return;
  }
  els.video.srcObject = stream;
  await els.video.play();
  engine = new RPPGEngine(N_PATCHES, { methods: Object.keys(METHODS), calibrator });
  engine.useCalibrated = useCalibrated;
  history = emptyHistory();
  estimates = {};
  spectrogram = [];
  face = null;
  running = true;
  els.placeholder.hidden = true;
  els.stop.hidden = false;
  els.start.hidden = true;
  els.progress.hidden = false;
  if (detectorState === 'none' || detectorState === 'failed') loadDetector();
  scheduleFrame();
}

function stop() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  els.video.srcObject = null;
  els.placeholder.hidden = false;
  els.stop.hidden = true;
  els.start.hidden = false;
  els.start.disabled = false;
  els.progress.hidden = true;
  setStatus('Stopped. Press start to measure again.');
}

els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);
els.specMethod.addEventListener('change', (e) => {
  specMethod = e.target.value;
  spectrogram = [];
});
document.querySelectorAll('input[name="rppg-sig-mode"]').forEach((input) => {
  input.addEventListener('change', () => {
    useCalibrated = input.value === 'calibrated';
    if (engine) engine.useCalibrated = useCalibrated;
  });
});
els.sigReset.addEventListener('click', () => {
  calibrator.reset();
  updateSignature();
});
updateSignature();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stop();
});

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  els.start.disabled = true;
  setStatus(window.isSecureContext
    ? 'This browser does not support camera access.'
    : 'Camera access requires HTTPS.');
}
