// js/app.js
// Final app.js — continuous-phase BPSK (global carrier) + clean per-bit FSK + demodulators + plotting

// ---------- Utilities ----------
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

// ---------- SIGNAL GENERATION ----------

// BPSK: continuous carrier across entire signal (carrier = cos(2πfc t)), baseband NRZ = ±1 (multiplied by amp)
function genBPSK(bits, amp, fc, fs, duration) {
  const N = Math.max(1, Math.floor(fs * duration));
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);

  // baseband NRZ ±1 repeated
  const baseRaw = repeatBitsToSamples(bits, samplesPerBit);
  const baseband = new Array(N);
  for (let i = 0; i < N; i++) {
    const b = baseRaw[i] === undefined ? bits[bits.length - 1] : baseRaw[i];
    baseband[i] = (b ? 1 : -1) * amp;
  }

  // continuous carrier cos(2π f t)
  const carrier = new Array(N);
  for (let i = 0; i < N; i++) carrier[i] = Math.cos(2 * Math.PI * fc * t[i]);

  // modulated
  const mod = new Array(N);
  for (let i = 0; i < N; i++) mod[i] = baseband[i] * carrier[i];

  return { t, baseband, carrier, mod, samplesPerBit };
}

// FSK: generate perfect sinusoid for each bit (restart phase per bit so each bit shows textbook sine)
function genFSK(bits, amp, f0, f1, fs, duration) {
  const N = Math.max(1, Math.floor(fs * duration));
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);

  const baseband = new Array(N);
  const carrier = new Array(N);
  const mod = new Array(N);

  for (let b = 0; b < bits.length; b++) {
    const f = bits[b] ? f1 : f0;
    for (let k = 0; k < samplesPerBit; k++) {
      const i = b * samplesPerBit + k;
      if (i >= N) break;
      const tt = k / fs; // restart phase at each bit start (tt from 0 to bit-length/fs)
      carrier[i] = Math.cos(2 * Math.PI * f * tt);
      mod[i] = amp * carrier[i];
      baseband[i] = bits[b] ? amp : -amp;
    }
  }

  // if N longer than bits*samplesPerBit, fill remaining with last bit's values
  const lastIdx = Math.min(N - 1, bits.length * samplesPerBit - 1);
  for (let i = bits.length * samplesPerBit; i < N; i++) {
    carrier[i] = carrier[lastIdx];
    mod[i] = mod[lastIdx];
    baseband[i] = baseband[lastIdx] || (bits[bits.length - 1] ? amp : -amp);
  }

  return { t, baseband, carrier, mod, samplesPerBit, f0, f1 };
}

// ---------- DEMODULATORS ----------

// Coherent BPSK demod: multiply by local cos(2πfc t) then low-pass (moving average over bit) and threshold
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

// FSK demod: correlate/energy per bit interval with cosines at f0 and f1 (choose larger)
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

// ---------- PLOTTING ----------
function plotFour(t, traces, title) {
  // traces: array of 4 {y, name}
  const data = [];
  for (let i = 0; i < 4; i++) {
    data.push({
      x: t,
      y: traces[i].y,
      name: traces[i].name,
      xaxis: 'x' + (i + 1),
      yaxis: 'y' + (i + 1),
      mode: 'lines',
      line: { width: 2 }
    });
  }
  const layout = {
    title: title,
    grid: { rows: 4, columns: 1, pattern: 'independent' },
    height: 760,
    margin: { t: 70, l: 70, r: 30, b: 70 },
    showlegend: true
  };
  layout['yaxis1'] = { title: 'Input (NRZ ±1)', range: [-1.5, 1.5] };
  layout['yaxis2'] = { title: 'Carrier' };
  layout['yaxis3'] = { title: 'Modulated' };
  layout['yaxis4'] = { title: 'Demodulated (NRZ)', range: [-1.5, 1.5] };
  layout['xaxis4'] = { title: 'Time (s)' };

  Plotly.react('plotArea', data, layout, { responsive: true });
}

// ---------- UI wiring ----------
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

// Main generation + demodulate
btnRun.addEventListener('click', () => {
  const ex = expSelect.value;
  const amp = Number(document.getElementById('amp').value);
  const fs = Math.max(100, Number(document.getElementById('fs').value));
  const dur = Math.max(0.001, Number(document.getElementById('duration').value));
  const bits = parseBits(document.getElementById('bits').value);

  if (ex === 'bpsk') {
    const fc = Number(document.getElementById('fc').value);
    const { t, baseband, carrier, mod, samplesPerBit } = genBPSK(bits, amp, fc, fs, dur);
    const dem = demodBPSK(mod, fc, fs, samplesPerBit);
    const traces = [
      { y: baseband, name: 'Input (NRZ ±1)' },
      { y: carrier, name: `Carrier ${fc} Hz` },
      { y: mod, name: 'BPSK Modulated' },
      { y: dem.recon, name: 'Demodulated (NRZ decision)' }
    ];
    plotFour(t, traces, `BPSK — fc=${fc}Hz, fs=${fs}Hz`);
  } else {
    const f0 = Number(document.getElementById('f0').value);
    const f1 = Number(document.getElementById('f1').value);
    const { t, baseband, carrier, mod, samplesPerBit } = genFSK(bits, amp, f0, f1, fs, dur);
    const dem = demodFSK(mod, f0, f1, fs, samplesPerBit);
    const traces = [
      { y: baseband, name: 'Input (NRZ ±1)' },
      { y: carrier, name: `Carrier (f0/f1)` },
      { y: mod, name: 'FSK Modulated' },
      { y: dem.recon, name: 'Demodulated (NRZ decision)' }
    ];
    plotFour(t, traces, `FSK — f0=${f0}Hz / f1=${f1}Hz, fs=${fs}Hz`);
  }
});

// initial run for convenience
window.addEventListener('load', () => { setTimeout(()=>btnRun.click(), 150); });
