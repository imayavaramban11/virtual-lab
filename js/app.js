// js/app.js
// Continuous-phase BPSK and FSK generators + demodulators + plotting

// ---------- helpers ----------
function linspace(a, b, n) {
  const out = [];
  if (n === 1) return [a];
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

// ---------- BPSK (continuous phase) ----------
function genBPSK(bits, amp, fc, fs, duration) {
  const N = Math.floor(fs * duration);
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);
  // NRZ baseband ±1 repeated
  const baseband = repeatBitsToSamples(bits, samplesPerBit).map(b => b ? 1 : -1).map(x => x * amp);

  // generate carrier with continuous phase (single freq fc)
  const carrier = new Array(N);
  let phase = 0;
  const phaseStep = 2 * Math.PI * fc / fs;
  for (let i = 0; i < N; i++) {
    carrier[i] = Math.cos(phase);
    phase += phaseStep;
  }
  // modulated = baseband * carrier (BPSK)
  const mod = new Array(N);
  for (let i = 0; i < N; i++) mod[i] = baseband[i] * carrier[i];

  return { t, baseband, carrier, mod, samplesPerBit };
}

// FSK: separate sinusoidal waves per bit (perfect textbook style)
function genFSK(bits, amp, f0, f1, fs, duration) {
  const N = Math.floor(fs * duration);
  const samplesPerBit = Math.floor(N / bits.length);
  const t = linspace(0, duration, N);

  const baseband = repeatBitsToSamples(bits, samplesPerBit).map(b => b ? 1 : -1);
  const carrier = new Array(N);
  const mod = new Array(N);

  for (let b = 0; b < bits.length; b++) {
    const f = bits[b] ? f1 : f0;
    for (let k = 0; k < samplesPerBit; k++) {
      const i = b * samplesPerBit + k;
      if (i >= N) break;
      const tt = (k / fs); // restart phase at each bit
      carrier[i] = Math.cos(2 * Math.PI * f * tt);
      mod[i] = amp * carrier[i];
    }
  }

  return { t, baseband, carrier, mod, samplesPerBit, f0, f1 };
}


// ---------- Demodulators ----------
// BPSK coherent demod: multiply by local carrier (same fc), low-pass by moving average, decision per bit
function demodBPSK(modSignal, fc, fs, samplesPerBit) {
  const N = modSignal.length;
  const mixed = new Array(N);
  let phase = 0;
  const step = 2 * Math.PI * fc / fs;
  for (let i = 0; i < N; i++) {
    const local = Math.cos(phase);
    mixed[i] = modSignal[i] * local;
    phase += step;
  }
  const lp = movingAverage(mixed, samplesPerBit); // crude low-pass
  const demodBits = [];
  const recon = new Array(N).fill(0);
  const numBits = Math.floor(N / samplesPerBit);
  for (let b = 0; b < numBits; b++) {
    const start = b * samplesPerBit;
    const mid = Math.min(N - 1, start + Math.floor(samplesPerBit / 2));
    const val = lp[mid];
    const bit = val > 0 ? 1 : 0;
    demodBits.push(bit);
    for (let k = start; k < Math.min(N, (b + 1) * samplesPerBit); k++) {
      recon[k] = bit ? 1 : -1;
    }
  }
  return { mixed, lp, demodBits, recon };
}

// FSK demod: energy/correlation per bit interval comparing f0 & f1
function demodFSK(modSignal, f0, f1, fs, samplesPerBit) {
  const N = modSignal.length;
  const t = linspace(0, N / fs, N);
  const decisions = [];
  const recon = new Array(N).fill(0);
  const numBits = Math.floor(N / samplesPerBit);

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
    for (let k = start; k < end; k++) recon[k] = bit ? 1 : -1;
  }

  return { decisions, recon };
}

// ---------- Plotting ----------
function plotFour(t, traces, title) {
  // traces: array of 4 {x (optional), y, name}
  const data = [];
  // Create 4 subplots stacked
  for (let i = 0; i < 4; i++) {
    const xaxis = 'x' + (i + 1);
    const yaxis = 'y' + (i + 1);
    const trace = {
      x: t,
      y: traces[i].y,
      name: traces[i].name || '',
      xaxis, yaxis,
      mode: 'lines'
    };
    data.push(trace);
  }
  const layout = {
    title: title,
    grid: { rows: 4, columns: 1, pattern: 'independent' },
    height: 760,
    margin: { t: 60, l: 70, r: 20, b: 60 },
    showlegend: true
  };
  // Axis labels and ranges
  layout['yaxis1'] = { title: 'Input (NRZ ±1)', range: [-1.5, 1.5] };
  layout['yaxis2'] = { title: 'Carrier' };
  layout['yaxis3'] = { title: 'Modulated' };
  layout['yaxis4'] = { title: 'Demodulated (NRZ decision)', range: [-1.5, 1.5] };
  layout['xaxis4'] = { title: 'Time (s)' };

  Plotly.newPlot('plotArea', data, layout, { responsive: true });
}

// ---------- UI wiring ----------
const expSelect = document.getElementById('experimentSelect');
const controlsArea = document.getElementById('controlsArea');
const btnRun = document.getElementById('btnRun');
const btnRandomBits = document.getElementById('btnRandomBits');

function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
function addInput(id, label, val) {
  const div = el(`<div style="margin-bottom:8px"><label for="${id}">${label}</label><input id="${id}" type="text" value="${val}"></div>`);
  controlsArea.appendChild(div);
}
function addNumber(id, label, val) {
  const div = el(`<div style="margin-bottom:8px"><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}"></div>`);
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
  const bits = Array.from({length:8 + Math.floor(Math.random()*8)}, () => Math.random() > 0.5 ? '1' : '0').join('');
  const f = document.getElementById('bits');
  if (f) f.value = bits;
});

// Run handler
btnRun.addEventListener('click', () => {
  const ex = expSelect.value;
  const amp = Number(document.getElementById('amp').value);
  const fs = Number(document.getElementById('fs').value);
  const dur = Number(document.getElementById('duration').value);
  const bits = parseBits(document.getElementById('bits').value);

  if (ex === 'bpsk') {
    const fc = Number(document.getElementById('fc').value);
    const {t, baseband, carrier, mod, samplesPerBit} = genBPSK(bits, amp, fc, fs, dur);
    const dem = demodBPSK(mod, fc, fs, samplesPerBit);

    const traces = [
      { y: baseband, name: 'Input (NRZ ±1)' },
      { y: carrier, name: `Carrier ${fc}Hz` },
      { y: mod, name: 'BPSK Modulated' },
      { y: dem.recon, name: 'Demodulated (NRZ decision)' }
    ];
    plotFour(t, traces, `BPSK Waveform — fc=${fc}Hz, fs=${fs}Hz`);
  } else if (ex === 'fsk') {
    const f0 = Number(document.getElementById('f0').value);
    const f1 = Number(document.getElementById('f1').value);
    const {t, baseband, carrier, mod, samplesPerBit} = genFSK(bits, amp, f0, f1, fs, dur);
    const dem = demodFSK(mod, f0, f1, fs, samplesPerBit);

    const traces = [
      { y: baseband, name: 'Input (NRZ ±1)' },
      { y: carrier, name: `Instant Carrier (f0/f1)` },
      { y: mod, name: 'FSK Modulated' },
      { y: dem.recon, name: 'Demodulated (NRZ decision)' }
    ];
    plotFour(t, traces, `FSK Waveform — f0=${f0}Hz / f1=${f1}Hz, fs=${fs}Hz`);
  }
});

// Initial run
window.addEventListener('load', () => { btnRun.click(); });

