// js/app.js
// Shows Input (baseband bits as NRZ), Carrier, Modulated & Demodulated signals
// BPSK: coherent demodulation (multiply by carrier + low-pass)
// FSK: energy-based demodulation over bit intervals

// ---------- helpers ----------
function linspace(a,b,n){
  const out=[]; const step=(b-a)/(n-1);
  for(let i=0;i<n;i++) out.push(a+step*i);
  return out;
}
function parseBits(str){
  const s = String(str).trim().replace(/[^01]/g,'');
  return s.length? s.split('').map(x=>+x) : [1,0,1,0,1,0,1,0];
}
function repeatBitsToSamples(bits, samplesPerBit){
  const out=new Array(bits.length*samplesPerBit);
  for(let i=0;i<bits.length;i++){
    for(let k=0;k<samplesPerBit;k++) out[i*samplesPerBit+k]=bits[i];
  }
  return out;
}
function movingAverage(arr, window){
  const out=new Array(arr.length).fill(0);
  let sum=0, w=window;
  for(let i=0;i<arr.length;i++){
    sum += arr[i];
    if(i>=w) sum -= arr[i-w];
    out[i] = sum / Math.min(w, i+1);
  }
  return out;
}

// ---------- SIGNAL GENERATORS ----------
function genInputNRZ(bits, samplesPerBit){
  return repeatBitsToSamples(bits, samplesPerBit).map(v=> v ? 1 : -1); // NRZ mapped to ±1
}

function genCarrier(fc, fs, N){
  const t = linspace(0, N/fs, N);
  const carrier = t.map(tt => Math.cos(2*Math.PI*fc*tt));
  return {t, carrier};
}

// BPSK: multiply carrier and ±1 baseband
function genBPSK(bits, amp, fc, fs, duration){
  const N = Math.floor(fs*duration);
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);
  const baseband = genInputNRZ(bits, samplesPerBit).map(x => x * amp); // ±amp
  const carrier = t.map(tt => Math.cos(2*Math.PI*fc*tt));
  const mod = baseband.map((b,i)=> b * carrier[i]);
  return {t, baseband, carrier, mod, samplesPerBit};
}

// FSK: use two carriers f0(for 0) and f1(for 1)
function genFSK(bits, amp, f0, f1, fs, duration){
  const N = Math.floor(fs*duration);
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);
  const bitSeq = repeatBitsToSamples(bits, samplesPerBit);
  const carrier = t.map((tt,i)=> Math.cos(2*Math.PI*(bitSeq[i]?f1:f0)*tt));
  const baseband = bitSeq.map(b=> b ? 1 : -1).map(x=> x*amp); // for display
  const mod = carrier.map((c,i)=> amp * c);
  return {t, baseband, carrier, mod, samplesPerBit, f0, f1};
}

// ---------- DEMODULATORS ----------
// BPSK coherent demod: multiply by local carrier, low-pass, sample per bit
function demodBPSK(modSignal, fc, fs, samplesPerBit){
  // local carrier (coherent)
  const N = modSignal.length;
  const t = linspace(0, N/fs, N);
  const local = t.map(tt=> Math.cos(2*Math.PI*fc*tt));
  const mixed = modSignal.map((s,i)=> s * local[i]); // product
  // low-pass: moving average - window = samplesPerBit (averaging over bit)
  const lp = movingAverage(mixed, samplesPerBit);
  // sample value per bit: take center sample of each bit window
  const demodBits = [];
  const recon = new Array(N).fill(0);
  for(let b=0;b<Math.floor(N/samplesPerBit);b++){
    const start = b*samplesPerBit;
    const mid = Math.min(N-1, start + Math.floor(samplesPerBit/2));
    const val = lp[mid];
    demodBits.push(val>0 ? 1 : 0);
    // reconstruct NRZ waveform for display (based on decided bits)
    for(let k=start;k<Math.min(N, (b+1)*samplesPerBit);k++){
      recon[k] = demodBits[b] ? 1 : -1;
    }
  }
  return {mixed, lp, demodBits, recon};
}

// FSK demod via energy detection per bit: correlate with sin/cos of f0 and f1
function demodFSK(modSignal, f0, f1, fs, samplesPerBit){
  const N = modSignal.length;
  const t = linspace(0, N/fs, N);
  const decisions = [];
  const recon = new Array(N).fill(0);
  for(let b=0;b<Math.floor(N/samplesPerBit);b++){
    const start = b*samplesPerBit;
    const end = Math.min(N, (b+1)*samplesPerBit);
    let e0=0, e1=0;
    for(let i=start;i<end;i++){
      const tt = t[i];
      // simple correlation with cosine (in-phase)
      e0 += modSignal[i] * Math.cos(2*Math.PI*f0*tt);
      e1 += modSignal[i] * Math.cos(2*Math.PI*f1*tt);
    }
    const bit = e1 > e0 ? 1 : 0;
    decisions.push(bit);
    for(let k=start;k<end;k++) recon[k] = bit ? 1 : -1;
  }
  return {decisions, recon};
}

// ---------- PLOTTING ----------
function plotFour(t, traces, title){
  // traces: array of 4 objects: {x,y,name}
  const subplotTitles = ['Input (NRZ baseband)','Carrier','Modulated','Demodulated'];
  const layout = {
    title: title,
    grid:{rows:4, columns:1, pattern:'independent'},
    height:700,
    margin:{t:60,l:60,r:20,b:60}
  };
  const data = [];
  for(let i=0;i<4;i++){
    data.push(Object.assign({}, traces[i], {x: t, y: traces[i].y, xaxis:`x${i+1}`, yaxis:`y${i+1}`}));
  }
  // axes config
  layout['xaxis1'] = {title:'Time (s)'};
  layout['yaxis1'] = {title:'Amplitude', range:[-1.5,1.5]};
  layout['xaxis2'] = {title:'Time (s)'};
  layout['yaxis2'] = {title:'Carrier'};
  layout['xaxis3'] = {title:'Time (s)'};
  layout['yaxis3'] = {title:'Modulated'};
  layout['xaxis4'] = {title:'Time (s)'};
  layout['yaxis4'] = {title:'Demodulated', range:[-1.5,1.5]};
  Plotly.newPlot('plotArea', data, layout, {responsive:true});
}

// ---------- UI wiring ----------
const expSelect = document.getElementById('experimentSelect');
const controlsArea = document.getElementById('controlsArea');
const btnRun = document.getElementById('btnRun');
const btnRandomBits = document.getElementById('btnRandomBits');

function el(html){ const d=document.createElement('div'); d.innerHTML=html; return d.firstChild; }
function addInput(id,label,def){
  const div = el(`<div><label for="${id}">${label}</label><input id="${id}" type="text" value="${def}"></div>`);
  controlsArea.appendChild(div);
}
function addNumber(id,label,def){
  const div = el(`<div><label for="${id}">${label}</label><input id="${id}" type="number" value="${def}"></div>`);
  controlsArea.appendChild(div);
}

function showBPSKControls(){
  controlsArea.innerHTML='';
  addNumber('amp','Amplitude (V)',1);
  addNumber('fc','Carrier freq (Hz)',10);
  addNumber('fs','Sample rate (Hz)',10000);
  addNumber('duration','Duration (s)',0.1);
  addInput('bits','Bit pattern (e.g. 101010)', '101011');
}
function showFSKControls(){
  controlsArea.innerHTML='';
  addNumber('amp','Amplitude (V)',1);
  addNumber('f0','Freq for bit 0 (Hz)',8);
  addNumber('f1','Freq for bit 1 (Hz)',12);
  addNumber('fs','Sample rate (Hz)',10000);
  addNumber('duration','Duration (s)',0.1);
  addInput('bits','Bit pattern (e.g. 101010)', '101011');
}

function renderControls(){
  if(expSelect.value === 'bpsk') showBPSKControls();
  else showFSKControls();
}
expSelect.addEventListener('change', renderControls);
renderControls();

btnRandomBits.addEventListener('click', ()=>{
  const bits = Array.from({length:8+Math.floor(Math.random()*8)}, ()=> Math.random()>0.5 ? '1':'0').join('');
  const bitsField = document.getElementById('bits');
  if(bitsField) bitsField.value = bits;
});

// Main run handler
btnRun.addEventListener('click', ()=>{
  const ex = expSelect.value;
  const amp = Number(document.getElementById('amp').value);
  const fs = Number(document.getElementById('fs').value);
  const dur = Number(document.getElementById('duration').value);
  const bits = parseBits(document.getElementById('bits').value);

  if(ex === 'bpsk'){
    const fc = Number(document.getElementById('fc').value);
    const {t, baseband, carrier, mod, samplesPerBit} = genBPSK(bits, amp, fc, fs, dur);

    // demodulate
    // mixed and lowpass + decision
    const dem = demodBPSK(mod, fc, fs, samplesPerBit);

    // Prepare traces: Input(baseband), Carrier, Modulated, Demodulated reconstruction
    const traces = [
      {y: baseband, mode:'lines', name:'Input (NRZ ±1)'},
      {y: carrier, mode:'lines', name:`Carrier ${fc}Hz`},
      {y: mod, mode:'lines', name:'BPSK Modulated'},
      {y: dem.recon, mode:'lines', name:'Demodulated (NRZ decision)'}
    ];
    plotFour(t, traces, `BPSK Waveform — fc=${fc}Hz, fs=${fs}Hz`);
  } else if(ex === 'fsk'){
    const f0 = Number(document.getElementById('f0').value);
    const f1 = Number(document.getElementById('f1').value);
    const {t, baseband, carrier, mod, samplesPerBit} = genFSK(bits, amp, f0, f1, fs, dur);

    // demodulate by energy detection over bit intervals
    const dem = demodFSK(mod, f0, f1, fs, samplesPerBit);

    const traces = [
      {y: baseband, mode:'lines', name:'Input (NRZ ±1)'},
      {y: carrier, mode:'lines', name:`Instant Carrier (f0/f1)`},
      {y: mod, mode:'lines', name:'FSK Modulated'},
      {y: dem.recon, mode:'lines', name:'Demodulated (NRZ decision)'}
    ];
    plotFour(t, traces, `FSK Waveform — f0=${f0}Hz / f1=${f1}Hz, fs=${fs}Hz`);
  }
});
