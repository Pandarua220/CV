// rPPG signal processing: a JavaScript port of the lab's MATLAB pipeline
// (extract_pulse.m / spec.m) with the POS, PBV and DIS core algorithms.
//
// Data flow per camera frame:
//   per-patch mean RGB (+ head motion) -> uniform resampling to FS
//   -> sliding window (L samples, hop STEP): preproc -> core (POS | PBV | DIS)
//   -> robust SNR patch selection -> overlap-add into the pulse signal
//   -> 10 s Hann-windowed spectrum -> heart rate (BPM)
// In every window the POS pulse also serves as the reference for calibrating
// the blood volume pulse signature used by PBV and DIS.

export const FS = 30;            // processing sample rate (Hz)
export const L = 64;             // sliding window length (samples, ~2.1 s)
export const STEP = 8;           // window hop (samples)
export const SPEC_SECONDS = 10;  // spec.m uses fps*10 samples
export const BPM_RANGE = [42, 180];

// butter(4, [0.7 3.0]/(FS/2), 'bandpass')
const BP_B = [0.001925636911814818, 0, -0.007702547647259272, 0, 0.011553821470888908,
  0, -0.007702547647259272, 0, 0.001925636911814818];
const BP_A = [1, -6.432190750328158, 18.387770585113262, -30.54002860873339, 32.2512441080423,
  -22.18130267725191, 9.703843532727497, -2.4691907685612398, 0.2798945271892947];
// filtfilt([1,1,1]/3, 1, x)
const MA_B = [1 / 3, 1 / 3, 1 / 3];
const MA_A = [1];

// Blood volume pulse signature measured for an RGB camera under white light
// (de Haan & van Leest, 2014). Starting point for the online calibration.
export const PBV_PRIOR = [0.33, 0.77, 0.53];

// ---------------------------------------------------------------------------
// Basic statistics

export function unit(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export function angleDeg(a, b) {
  const ua = unit(a), ub = unit(b);
  const dot = ua.reduce((s, x, i) => s + x * ub[i], 0);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

function mean(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

// MATLAB std (N-1 normalisation)
function std(x) {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m);
  return Math.sqrt(s / Math.max(1, x.length - 1));
}

function zscore(x) {
  const m = mean(x), s = std(x) + 1e-12;
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = (x[i] - m) / s;
  return y;
}

// ---------------------------------------------------------------------------
// Zero-phase filtering, equivalent to MATLAB filtfilt (odd reflection padding
// of 3*(nfilt-1) samples, steady-state initial conditions).

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

function makeFilter(bIn, aIn) {
  const n = Math.max(bIn.length, aIn.length);
  const b = Array.from({ length: n }, (_, i) => (bIn[i] || 0) / aIn[0]);
  const a = Array.from({ length: n }, (_, i) => (aIn[i] || 0) / aIn[0]);
  // lfilter_zi: solve (I - A^T) zi = b[1:] - a[1:] * b[0]
  const m = n - 1;
  const IA = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)));
  for (let j = 0; j < m; j++) IA[j][0] += a[j + 1];
  for (let i = 1; i < m; i++) IA[i - 1][i] -= 1;
  const rhs = Array.from({ length: m }, (_, i) => b[i + 1] - a[i + 1] * b[0]);
  const zi = m > 0 ? solve(IA, rhs) : [];
  return { b, a, zi, nfact: 3 * m };
}

function lfilter(f, x, x0) {
  const { b, a } = f;
  const m = b.length - 1;
  const z = f.zi.map((v) => v * x0);
  const y = new Float64Array(x.length);
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const yn = b[0] * xn + (m > 0 ? z[0] : 0);
    for (let i = 0; i < m - 1; i++) z[i] = b[i + 1] * xn + z[i + 1] - a[i + 1] * yn;
    if (m > 0) z[m - 1] = b[m] * xn - a[m] * yn;
    y[n] = yn;
  }
  return y;
}

function filtfilt(f, x) {
  const N = x.length, nf = f.nfact;
  const ext = new Float64Array(N + 2 * nf);
  for (let i = 0; i < nf; i++) ext[i] = 2 * x[0] - x[nf - i];
  ext.set(x, nf);
  for (let i = 0; i < nf; i++) ext[nf + N + i] = 2 * x[N - 1] - x[N - 2 - i];
  let y = lfilter(f, ext, ext[0]);
  y.reverse();
  y = lfilter(f, y, y[0]);
  y.reverse();
  return y.subarray(nf, nf + N);
}

const BANDPASS = makeFilter(BP_B, BP_A);
const SMOOTH = makeFilter(MA_B, MA_A);

// preproc.m: DC normalisation, band-pass filtering, 3-tap average filtering
export function preproc(x) {
  const m = mean(x) + 1e-6;
  const cn = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) cn[i] = x[i] / m - 1;
  const cf = filtfilt(BANDPASS, cn);
  const mf = mean(cf);
  for (let i = 0; i < cf.length; i++) cf[i] -= mf;
  return filtfilt(SMOOTH, cf);
}

// ---------------------------------------------------------------------------
// Pseudo-inverse of a symmetric matrix (Jacobi eigen-decomposition),
// using MATLAB's default tolerance max(size(A)) * norm(A) * eps.

export function pinvSym(A) {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (a[p][q] === 0) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const eig = a.map((r, i) => r[i]);
  const tol = n * Math.max(...eig.map(Math.abs)) * 2.220446049250313e-16;
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let k = 0; k < n; k++) {
    if (Math.abs(eig[k]) <= tol) continue;
    const inv = 1 / eig[k];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) P[i][j] += V[i][k] * V[j][k] * inv;
  }
  return P;
}

// ---------------------------------------------------------------------------
// Core rPPG algorithms (extract_core.m). c: [r, g, b] rows, m: motion rows.

export function pos(c) {
  const [r, g, b] = c;
  const n = r.length;
  const s1 = new Float64Array(n), s2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    s1[i] = g[i] - b[i];
    s2[i] = -2 * r[i] + g[i] + b[i];
  }
  const alpha = std(s1) / (std(s2) + 1e-12);
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = s1[i] + alpha * s2[i];
  return p;
}

// PBV: p = pbv * pinv(c c') * c
export function pbv(c, signature) {
  return signatureProjection(c, signature);
}

// DIS: p = [pbv, 0, ...] * pinv(X X') * X, with X = [c; m]
export function dis(c, m, signature) {
  return signatureProjection([...c, ...m], [...signature, ...new Array(m.length).fill(0)]);
}

// Minimum output energy subject to a unit response along the signature e.
function signatureProjection(X, e) {
  const k = X.length, n = X[0].length;
  const R = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let s = 0;
      for (let t = 0; t < n; t++) s += X[i][t] * X[j][t];
      R[i][j] = R[j][i] = s;
    }
  }
  const Rp = pinvSym(R);
  const w = new Array(k).fill(0);
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) w[j] += e[i] * Rp[i][j];
  const p = new Float64Array(n);
  for (let j = 0; j < k; j++) for (let t = 0; t < n; t++) p[t] += w[j] * X[j][t];
  return p;
}

// ---------------------------------------------------------------------------
// Spectral helpers

const DFT_BINS = Math.floor(L / 2) - 1; // MATLAB: F(:, 1:floor(end/2)-1)
const DFT_COS = [], DFT_SIN = [];
for (let k = 0; k < DFT_BINS; k++) {
  DFT_COS.push(Float64Array.from({ length: L }, (_, t) => Math.cos((2 * Math.PI * k * t) / L)));
  DFT_SIN.push(Float64Array.from({ length: L }, (_, t) => Math.sin((2 * Math.PI * k * t) / L)));
}

function magSpectrum(x) {
  const S = new Float64Array(DFT_BINS);
  for (let k = 0; k < DFT_BINS; k++) {
    let re = 0, im = 0;
    const ck = DFT_COS[k], sk = DFT_SIN[k];
    for (let t = 0; t < L; t++) { re += x[t] * ck[t]; im -= x[t] * sk[t]; }
    S[k] = Math.hypot(re, im);
  }
  return S;
}

function argmax(x, from = 0, to = x.length) {
  let best = from;
  for (let i = from; i < to; i++) if (x[i] > x[best]) best = i;
  return best;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

// 'snr_rob' global selection: average the 5 patches with the best SNR at the
// median dominant frequency across patches.
export function selectSnrRob(P, topK = 5) {
  const S = P.map(magSpectrum);
  const hrIdx = Math.round(median(S.map((s) => argmax(s))));
  const snr = S.map((s) => {
    let tot = 0;
    for (let i = 0; i < s.length; i++) tot += s[i];
    return s[hrIdx] / (tot - s[hrIdx] + 1e-12);
  });
  const order = snr.map((v, i) => i).sort((a, b) => snr[b] - snr[a]).slice(0, Math.min(topK, P.length));
  const h = new Float64Array(P[0].length);
  for (const i of order) for (let t = 0; t < h.length; t++) h[t] += P[i][t] / order.length;
  return { h, selected: order };
}

// spec.m on the most recent window: normalise, Hann window, |FFT| with
// fps*60 points (1 BPM per bin), then peak picking inside BPM_RANGE.
export function heartRate(pulse, fs = FS) {
  const n = pulse.length;
  const x = zscore(pulse);
  const mx = mean(x);
  const bpmMin = 30, bpmMax = 210;
  const spectrum = new Float64Array(bpmMax - bpmMin + 1);
  const win = new Float64Array(n);
  for (let t = 0; t < n; t++) win[t] = (x[t] - mx) * 0.5 * (1 - Math.cos((2 * Math.PI * t) / (n - 1)));
  for (let bpm = bpmMin; bpm <= bpmMax; bpm++) {
    const w = (2 * Math.PI * bpm) / 60 / fs;
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) { re += win[t] * Math.cos(w * t); im -= win[t] * Math.sin(w * t); }
    spectrum[bpm - bpmMin] = Math.hypot(re, im);
  }
  const peak = argmax(spectrum, BPM_RANGE[0] - bpmMin, BPM_RANGE[1] - bpmMin + 1);
  const bpm = peak + bpmMin;
  // de Haan-style SNR: power around the fundamental and its first harmonic
  // versus the rest of the band.
  let sig = 0, noise = 0;
  for (let i = BPM_RANGE[0] - bpmMin; i <= BPM_RANGE[1] - bpmMin; i++) {
    const f = i + bpmMin;
    const p = spectrum[i] * spectrum[i];
    if (Math.abs(f - bpm) <= 6 || Math.abs(f - 2 * bpm) <= 6) sig += p; else noise += p;
  }
  return { bpm, spectrum, bpmMin, snrDb: 10 * Math.log10((sig + 1e-12) / (noise + 1e-12)) };
}

// ---------------------------------------------------------------------------
// Online calibration of the blood volume pulse signature.
//
// The signature depends on the camera's spectral response and the light
// source, so the prior is only approximately right for an unknown webcam.
// POS needs no signature, so its pulse is used as the reference: the colour
// traces of each good patch are regressed onto the POS pulse of the *other*
// good patches. The resulting channel gains are a direct measurement of the
// signature. To keep noise from biasing the direction of the estimate:
//  - sensor noise is independent across patches, so a patch never serves as
//    its own reference;
//  - the good patches are those picked in a non-overlapping earlier window,
//    so a patch is never chosen because of its noise in the current window;
//  - raw gains are averaged and only the average is normalised.
// Windows with head motion are skipped: a motion residual in the POS pulse
// would otherwise pull the estimate towards the colour direction of motion.

function correlation(a, b) {
  const ma = mean(a), mb = mean(b);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb + 1e-30);
}

export class SignatureCalibrator {
  constructor(prior = PBV_PRIOR, { tau = 75, minR2 = 0.1, priorWeight = 10, maxMotionCorr = 0.3, maxVarRatio = 2.5 } = {}) {
    this.prior = unit(prior);
    this.tau = tau;                      // memory of the running average (windows)
    this.minR2 = minR2;                  // min. share of colour variance explained by the pulse
    this.priorWeight = priorWeight;      // the prior counts as this many good windows
    this.maxMotionCorr = maxMotionCorr;  // max. |correlation| of the POS pulse with motion
    this.maxVarRatio = maxVarRatio;      // max. colour variance relative to the recent median
    this.reset();
  }

  reset() {
    this.signature = this.prior.slice();
    this.gain = [0, 0, 0];  // running average of the measured channel gains
    this.accepted = 0;
    this.windows = 0;
    this.lastR2 = 0;
    this.lastReason = '';
    this.variances = [];    // colour variance of recent windows
  }

  // P: z-scored POS pulse of every patch; patches: good patches chosen in an
  // earlier, non-overlapping window; colorRows: pre-processed [r, g, b]
  // traces of every patch; motion: pre-processed motion traces.
  update(P, patches, colorRows, motion = []) {
    this.windows++;
    if (patches.length < 2) return false;
    const n = P[0].length;

    const pulse = new Float64Array(n);
    for (const q of patches) for (let t = 0; t < n; t++) pulse[t] += P[q][t];
    if (motion.some((m) => Math.abs(correlation(pulse, m)) > this.maxMotionCorr)) {
      this.lastReason = 'motion';
      return false;
    }
    let variance = 0;
    for (const p of patches) for (const x of colorRows[p]) for (let t = 0; t < n; t++) variance += x[t] * x[t];
    this.variances.push(variance);
    if (this.variances.length > 60) this.variances.shift();
    if (this.variances.length >= 10 && variance > this.maxVarRatio * median(this.variances)) {
      this.lastReason = 'motion';
      return false;
    }

    const gain = [0, 0, 0];
    let explained = 0, total = 0;
    for (const p of patches) {
      const ref = new Float64Array(n);
      for (const q of patches) if (q !== p) for (let t = 0; t < n; t++) ref[t] += P[q][t];
      let rr = 0;
      for (let t = 0; t < n; t++) rr += ref[t] * ref[t];
      for (let k = 0; k < 3; k++) {
        const x = colorRows[p][k];
        let xr = 0, xx = 0;
        for (let t = 0; t < n; t++) { xr += x[t] * ref[t]; xx += x[t] * x[t]; }
        gain[k] += xr / rr / patches.length;
        explained += (xr * xr) / rr;
        total += xx;
      }
    }
    const r2 = explained / (total + 1e-30);
    this.lastR2 = r2;
    if (r2 < this.minR2) {
      this.lastReason = 'weak';
      return false;
    }
    this.lastReason = '';
    if (gain.reduce((s, g, k) => s + g * this.signature[k], 0) < 0) for (let k = 0; k < 3; k++) gain[k] = -gain[k];
    const beta = Math.max(1 / (this.accepted + 1), 1 / this.tau);
    this.gain = this.gain.map((g, k) => (1 - beta) * g + beta * gain[k]);
    this.accepted++;
    // shrink towards the prior until enough good windows have been seen; a
    // blood volume pulse modulates all channels in the same direction
    const w = this.priorWeight / (this.priorWeight + this.accepted);
    const measured = unit(this.gain);
    this.signature = unit(measured.map((g, k) => Math.max(0.01, w * this.prior[k] + (1 - w) * g)));
    return true;
  }

  get deviation() {
    return angleDeg(this.signature, this.prior);
  }
}

// ---------------------------------------------------------------------------
// Streaming engine

export class RPPGEngine {
  constructor(nPatches, { methods = ['pos', 'pbv', 'dis'], calibrator = new SignatureCalibrator() } = {}) {
    this.nPatches = nPatches;
    this.methods = methods;
    this.calibrator = calibrator;
    this.useCalibrated = true;  // PBV/DIS use the calibrated signature, else the prior
    this.capacity = FS * 30;
    this.reset();
  }

  reset() {
    this.prev = null;       // last raw frame {t, v}
    this.nextT = 0;         // next uniform sample time (ms)
    this.samples = [];      // uniform samples (Float64Array per sample)
    this.offset = 0;        // absolute index of samples[0]
    this.total = 0;         // number of uniform samples emitted
    this.nextWin = 0;       // absolute start index of the next window
    this.acc = {};          // overlap-add accumulators, keyed by method
    this.pulse = {};        // finalised pulse samples, keyed by method
    for (const m of this.methods) { this.acc[m] = new Map(); this.pulse[m] = []; }
    this.selected = {};
    this.posHistory = [];   // POS patch selections of recent windows
    this.rawFrames = 0;
    this.firstFrameT = null;
  }

  // t: timestamp (ms); colors: Float64Array [r0,g0,b0, r1,g1,b1, ...];
  // motion: [x, y] of the face ROI centre.
  push(t, colors, motion) {
    const v = new Float64Array(colors.length + motion.length);
    v.set(colors);
    v.set(motion, colors.length);
    if (this.prev && t - this.prev.t > 500) this.reset(); // camera stalled / tab hidden
    if (!this.prev) {
      this.prev = { t, v };
      this.nextT = t;
      this.firstFrameT = t;
    }
    this.rawFrames++;
    const dt = 1000 / FS;
    const { t: t0, v: v0 } = this.prev;
    while (this.nextT <= t) {
      const a = t > t0 ? (this.nextT - t0) / (t - t0) : 1;
      const s = new Float64Array(v.length);
      for (let i = 0; i < v.length; i++) s[i] = v0[i] + a * (v[i] - v0[i]);
      this.emit(s);
      this.nextT += dt;
    }
    this.prev = { t, v };
  }

  emit(sample) {
    this.samples.push(sample);
    this.total++;
    if (this.samples.length > this.capacity) {
      this.samples.shift();
      this.offset++;
    }
    while (this.total - this.nextWin >= L) {
      this.processWindow(this.nextWin);
      this.nextWin += STEP;
    }
  }

  processWindow(start) {
    const K = this.nPatches;
    const rows = this.samples.slice(start - this.offset, start - this.offset + L);
    const channel = (idx) => Float64Array.from(rows, (s) => s[idx]);
    const motion = [preproc(channel(3 * K)), preproc(channel(3 * K + 1))];
    const colorRows = [];
    for (let p = 0; p < K; p++) {
      colorRows.push([preproc(channel(3 * p)), preproc(channel(3 * p + 1)), preproc(channel(3 * p + 2))]);
    }
    // POS runs first: it is one of the outputs and the calibration reference.
    const posP = colorRows.map((c) => zscore(pos(c)));
    const posSel = selectSnrRob(posP);
    this.posHistory.push(posSel.selected);
    if (this.posHistory.length > L / STEP) {
      // patches selected in the window that ended where this one starts
      this.calibrator.update(posP, this.posHistory.shift(), colorRows, motion);
    }
    const signature = this.useCalibrated ? this.calibrator.signature : this.calibrator.prior;
    const core = {
      pbv: (c) => pbv(c, signature),
      dis: (c) => dis(c, motion, signature),
    };
    for (const method of this.methods) {
      const { h, selected } = method === 'pos' ? posSel : selectSnrRob(colorRows.map((c) => zscore(core[method](c))));
      this.selected[method] = selected;
      const hn = zscore(h);
      const acc = this.acc[method];
      for (let t = 0; t < L; t++) acc.set(start + t, (acc.get(start + t) || 0) + hn[t]);
      // samples before the next window start will receive no more contributions
      for (let i = start; i < start + STEP; i++) {
        this.pulse[method].push(acc.get(i));
        acc.delete(i);
      }
      if (this.pulse[method].length > this.capacity) this.pulse[method].splice(0, this.pulse[method].length - this.capacity);
    }
  }

  get seconds() {
    return this.pulse[this.methods[0]].length / FS;
  }

  get frameRate() {
    if (!this.prev || this.rawFrames < 2) return 0;
    return ((this.rawFrames - 1) * 1000) / (this.prev.t - this.firstFrameT);
  }

  estimate(method) {
    const p = this.pulse[method];
    const n = Math.min(p.length, SPEC_SECONDS * FS);
    if (n < 5 * FS) return null;
    return heartRate(p.slice(p.length - n), FS);
  }
}
