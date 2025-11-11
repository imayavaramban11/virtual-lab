// js/app.js
// Complete app.js — shows Input (NRZ), Carrier, Modulated, Demodulated for BPSK & FSK
// - BPSK: continuous carrier cos(2πfc t), mod = ±1 * carrier, coherent demod
// - FSK: textbook per-bit sinusoid (each bit restarts phase), mod = amp * carrier, correlation demod
// - Adds vertical bit-boundary markers on plots for clarity

// ------------------ Utilities ------------------
function linspace(a, b, n) {
  const out = [];
  if (n <= 1) { out.push(a); return out; }
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out.push(a + step * i);
  return out;
}

function parseBits(str) {
  if (!str) return [1,0,1,0];
  const s = String(str).trim().replace(/[^01]/g, '');
  if (!s) return [1,0,1,0];
  return s.split('').map(x => Number(x));
}

function repeatBitsToSamples(bits, samplesPerBit) {
  const out = new Array(bits.length * samplesPerBit);
  for (let i = 0; i < bits.length; i++) {
    for (let k = 0; k < samplesPerBit; k++) {
      out[i * samplesPerBit + k] = bits[i];
    }
  }
  return out;
}

function movingAverage(arr, window) {
  const out = new Array(arr.length).fill(0);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= window) sum -= arr[i - window];
    out[i] = sum / Math.min(window, i + 1);
  }
  return out;
}

// clamp helper
function clampInt(v, minVal) { return Math.max(minVal, Math.floor(v)); }

// ------------------ Signal Generators ------------------

// BPSK: continuous carrier across entire duration, baseband NRZ ±1 (amplitude applied)
function genBPSK(bits, amp, fc, fs, duration) {
  const N = Math.max(1, Math.floor(fs * duration));
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);

  // baseband NRZ ±1 repeated
  const raw = repeatBitsToSamples(bits, samplesPerBit);
  const baseband = new Array(N);
  for (let i = 0; i < N; i++) {
    const b = raw[i] === undefined ? bits[bits.length - 1] : raw[i];
    baseband[i] = (b ? 1 : -1) * amp;
  }

  // continuous carrier cos(2π f t)
  const carrier = t.map(tt => Math.cos(2 * Math.PI * fc * tt));

  // modulated
  const mod = new Array(N);
  for (let i = 0; i < N; i++) mod[i] = baseband[i] * carrier[i];

  // bit boundaries times
  const bitDur = duration / bits.length;
  const boundaries = [];
  for (let b = 0; b <= bits.length; b++) boundaries.push(b * bitDur);

  return { t, baseband, carrier, mod, samplesPerBit, bitDur, boundaries };
}

// FSK: textbook per-bit sinusoid (phase restarts each bit) — clean visual per-bit sine
function genFSK(bits, amp, f0, f1, fs, duration) {
  const N = Math.max(1, Math.floor(fs * duration));
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);

  const baseband = new Array(N);
  const carrier = new Array(N);
  const mod = new Array(N);

  for (let b = 0; b < bits.length; b++) {
    const f = bits[b] ? f1 : f0;
    const start = b * samplesPerBit;
    const end = Math.min(N, (b + 1) * samplesPerBit);
    for (let i = start; i < end; i++) {
      const local_t = (i - start) / fs; // restart phase at each bit start
      const val = Math.cos(2 * Math.PI * f * local_t);
      carrier[i] = val;
      mod[i] = amp * val;
      baseband[i] = bits[b] ? amp : -amp;
    }
  }

  // fill any leftover samples if N > bits*samplesPerBit
  const lastIdx = Math.min(N - 1, bits.length * samplesPerBit - 1);
  for (let i = bits.length * samplesPerBit; i < N; i++) {
    carrier[i] = carrier[lastIdx];
    mod[i] = mod[lastIdx];
    baseband[i] = baseband[lastIdx] || (bits[bits.length - 1] ? amp : -amp);
  }

  const bitDur = duration / bits.length;
  const boundaries = [];
  for (let b = 0; b <= bits.length; b++) boundaries.push(b * bitDur);

  return { t, baseband, carrier, mod, samplesPerBit, bitDur, boundaries };
}

// ------------------ Demodulators ------------------

// BPSK coherent demod: multiply by local cos(2πfc t), low-pass (moving average), threshold per bit
function demodBPSK(modSignal, fc, fs, samplesPerBit) {
  const N = modSignal.length;
  const t = linspace(0, N / fs, N);
  const mixed = new Array(N);
  for (let i = 0; i < N; i++) mixed[i] = modSignal[i] * Math.cos(2 * Math.PI * fc * t[i]);

  const lp = movingAverage(mixed, samplesPerBit);
  const numBits = Math.floor(N / samplesPerBit);
  const demodBits = [];
  const recon = new Array(N).fill(0);
  for (let b = 0; b < numBits; b++) {
    const start = b * samplesPerBit;
    const mid = Math.min(N - 1, start + Math.floor(samplesPerBit / 2));
    const val = lp[mid];
    const bit = val > 0 ? 1 : 0;
    demodBits.push(bit);
    for (let i = start; i < Math.min(N, (b + 1) * samplesPerBit); i++) recon[i] = bit ? 1 : -1;
  }
  return { mixed, lp, demodBits, recon };
}

// FSK demod: correlate received signal with cos(2π f0 t) & cos(2π f1 t) over each bit interval
function demodFSK(modSignal, f0, f1, fs, samplesPerBit) {
  const N = modSignal.length;
  const t = linspace(0, N / fs, N);
  const numBits = Math.floor(N / samplesPerBit);
  const decisions = [];
  const recon = new Array(N).fill(0);

  for (let b = 0; b < numBits; b++) {
    const start = b * samplesPerBit;
    const end = Math.min(N, (b + 1) * samplesPerBit);
    let corr0 = 0, corr1 = 0;
    for (let i = start; i < end; i++) {
      corr0 += modSignal[i] * Math.cos(2 * Math.PI * f0 * t[i]);
      corr1 += modSignal[i] * Math.cos(2 * Math.PI * f1 * t[i]);
    }
    const bit = corr1 > corr0 ? 1 : 0;
    decisions.push(bit);
    for (let i = start; i < end; i++) recon[i] = bit ? 1 : -1;
  }

  return { decisions, recon };
}

// ------------------ Plotting (4 stacked subplots + bit boundary lines) ------------------
function plotFour(t, traces, boundaries, title) {
  // traces: [{y,name,color}, ...] length 4
  const data = [];
  for (let i = 0; i < 4; i++) {
    data.push({
      x: t,
      y: traces[i].y,
      name: traces[i].name || '',
      xaxis: 'x' + (i + 1),
      yaxis: 'y' + (i + 1),
      mode: 'lines',
      line: { width: 2, color: traces[i].color || undefined }
    });
  }

  // shapes for bit boundaries (vertical lines)
  const shapes = [];
  for (let i = 0; i < boundaries.length; i++) {
    const x = boundaries[i];
    shapes.push({
      type: 'line',
      x0: x, x1: x, yref: 'paper', y0: 0, y1: 1,
      line: { color: '#888', width: 1, dash: 'dot' },
      opacity: 0.35
    });
  }

  const layout = {
    title: title,
    grid: { rows: 4, columns: 1, pattern: 'independent' },
    height: 760,
    margin: { t: 60, l: 70, r: 30, b: 60 },
    shapes: shapes,
    showlegend: true
  };

  layout['yaxis1'] = { title: 'Input (NRZ ±1)', range: [-1.5, 1.5] };
  layout['yaxis2'] = { title: 'Carrier' };
  layout['yaxis3'] = { title: 'Modulated' };
  layout['yaxis4'] = { title: 'Demodulated (NRZ)', range: [-1.5, 1.5] };
  layout['xaxis4'] = { title: 'Time (s)' };

  Plotly.react('plotArea', data, layout, { responsive: true });
}

// ------------------ UI Wiring ------------------
const expSelect = document.getElementById('experimentSelect');
const controlsArea = document.getElementById('controlsArea');
const btnRun = document.getElementById('btnRun');
const btnRandomBits = document.getElementById('btnRandomBits');

function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
function addInput(id, label, val) {
  const div = el(`<div style="margin-bottom:10px"><label for="${id}">${label}</label><input id="${id}" type="text" value="${val}"></div>`);
  controlsArea.appendChild(div);
}
function addNumber(id, label, val) {
  const div = el(`<div style="margin-bottom:10px"><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}"></div>`);
  controlsArea.appendChild(div);
}

function showBPSKControls() {
  controlsArea.innerHTML = '';
  addNumber('amp','Amplitude (V)',1);
  addNumber('fc','Carrier freq (Hz)',10);
  addNumber('fs','Sample rate (Hz)',10000);
  addNumber('duration','Duration (s)',0.1);
  addInput('bits','Bit pattern (e.g. 101010)', '101011');
}
function showFSKControls() {
  controlsArea.innerHTML = '';
  addNumber('amp','Amplitude (V)',1);
  addNumber('f0','Freq for bit 0 (Hz)',8);
  addNumber('f1','Freq for bit 1 (Hz)',12);
  addNumber('fs','Sample rate (Hz)',10000);
  addNumber('duration','Duration (s)',0.1);
  addInput('bits','Bit pattern (e.g. 101010)', '101011');
}

function renderControls() {
  if (expSelect.value === 'bpsk') showBPSKControls();
  else showFSKControls();
}
expSelect.addEventListener('change', renderControls);
renderControls();

btnRandomBits.addEventListener('click', () => {
  const len = 8 + Math.floor(Math.random() * 8);
  const bits = Array.from({ length: len }, () => Math.random() > 0.5 ? '1' : '0').join('');
  const f = document.getElementById('bits');
  if (f) f.value = bits;
});

// Main run
btnRun.addEventListener('click', () => {
  const ex = expSelect.value;
  const amp = Number(document.getElementById('amp').value) || 1;
  const fs = clampInt(Number(document.getElementById('fs').value) || 1000, 100);
  const dur = Math.max(0.001, Number(document.getElementById('duration').value) || 0.1);
  const bits = parseBits(document.getElementById('bits').value);

  if (ex === 'bpsk') {
    const fc = Number(document.getElementById('fc').value) || 10;
    const { t, baseband, carrier, mod, samplesPerBit, boundaries } = genBPSK(bits, amp, fc, fs, dur);
    const dem = demodBPSK(mod, fc, fs, samplesPerBit);

    const traces = [
      { y: baseband, name: 'Input (NRZ ±1)', color: '#1f77b4' },
      { y: carrier, name: `Carrier ${fc} Hz`, color: '#ff7f0e' },
      { y: mod, name: 'BPSK Modulated', color: '#2ca02c' },
      { y: dem.recon, name: 'Demodulated (NRZ)', color: '#d62728' }
    ];
    plotFour(t, traces, boundaries, `BPSK — fc=${fc}Hz, fs=${fs}Hz`);
  } else {
    const f0 = Number(document.getElementById('f0').value) || 8;
    const f1 = Number(document.getElementById('f1').value) || 12;
    const { t, baseband, carrier, mod, samplesPerBit, boundaries } = genFSK(bits, amp, f0, f1, fs, dur);
    const dem = demodFSK(mod, f0, f1, fs, samplesPerBit);

    const traces = [
      { y: baseband, name: 'Input (NRZ ±1)', color: '#1f77b4' },
      { y: carrier, name: `Carrier (f0/f1)`, color: '#ff7f0e' },
      { y: mod, name: 'FSK Modulated', color: '#2ca02c' },
      { y: dem.recon, name: 'Demodulated (NRZ)', color: '#d62728' }
    ];
    plotFour(t, traces, boundaries, `FSK — f0=${f0}Hz / f1=${f1}Hz, fs=${fs}Hz`);
  }
});

// initial run for convenience
window.addEventListener('load', () => { setTimeout(()=>btnRun.click(), 150); });
