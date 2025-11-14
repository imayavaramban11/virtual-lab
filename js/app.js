// js/app.js
//
// Virtual Lab app.js
// Features:
// - UI controls for BPSK and FSK
// - Generate: Data bits (NRZ), Carrier, Modulated, Demodulated
// - Constellation (I/Q for BPSK; energy scatter for FSK)
// - Theory & Procedure text per experiment
// - Random bits & CSV download
// - Easily extendable for future experiments

// ----------- Utilities -----------
function linspace(a,b,n){const out=[]; if(n<=1){out.push(a); return out;} const step=(b-a)/(n-1); for(let i=0;i<n;i++) out.push(a+step*i); return out;}
function clampInt(v,min){return Math.max(min,Math.floor(v));}
function parseBits(str){if(!str) return [1,0,1,0]; const s=String(str).trim().replace(/[^01]/g,''); return s.length? s.split('').map(x=>+x) : [1,0,1,0];}
function repeatBitsToSamples(bits,samplesPerBit){const out=new Array(bits.length*samplesPerBit); for(let i=0;i<bits.length;i++) for(let k=0;k<samplesPerBit;k++) out[i*samplesPerBit + k] = bits[i]; return out;}
function movingAverage(arr,win){const out=new Array(arr.length).fill(0); let sum=0; for(let i=0;i<arr.length;i++){sum += arr[i]; if(i>=win) sum -= arr[i-win]; out[i] = sum/Math.min(win,i+1);} return out;}

// ----------- Plot helpers -----------
function plotFourSubplots(t,traces,boundaries,title){
  // traces: array of 4 objects {y, name, color}
  const data=[];
  for(let i=0;i<4;i++){
    data.push({
      x:t, y:traces[i].y, name:traces[i].name || '', xaxis:'x'+(i+1), yaxis:'y'+(i+1),
      mode:'lines', line:{width:2, color:traces[i].color}
    });
  }
  const shapes = boundaries.map(x=>({
    type:'line', x0:x, x1:x, yref:'paper', y0:0, y1:1, line:{color:'#666',width:1,dash:'dot'}, opacity:0.25
  }));
  const layout = {
    title:title,
    grid:{rows:4, columns:1, pattern:'independent'},
    height:700, margin:{t:70,l:70,r:30,b:60},
    shapes:shapes, showlegend:true
  };
  layout['yaxis1'] = {title:'Input (NRZ ±1)', range:[-1.5,1.5]};
  layout['yaxis2'] = {title:'Carrier'};
  layout['yaxis3'] = {title:'Modulated'};
  layout['yaxis4'] = {title:'Demodulated (NRZ)', range:[-1.5,1.5]};
  layout['xaxis4'] = {title:'Time (s)'};
  Plotly.react('plotArea', data, layout, {responsive:true});
}
function plotConstellationIQ(I,Q,title){
  Plotly.react('constellation', [{x:I, y:Q, mode:'markers', marker:{size:6}}], {title:title, xaxis:{title:'I'}, yaxis:{title:'Q'}, height:360});
}

// ----------- Signal Generators & Demodulators -----------

// BPSK: continuous carrier across whole signal
function genBPSK(bits, amp, fc, fs, duration){
  const N = Math.max(1, Math.floor(fs*duration));
  const samplesPerBit = Math.max(1, Math.floor(N / bits.length));
  const t = linspace(0, duration, N);
  const baseRaw = repeatBitsToSamples(bits,samplesPerBit);
  const baseband = new Array(N);
  for(let i=0;i<N;i++){ const b = baseRaw[i]===undefined? bits[bits.length-1] : baseRaw[i]; baseband[i] = (b?1:-1) * amp; }
  // continuous carrier cos(2π f t)
  const carrier = t.map(tt => Math.cos(2*Math.PI*fc*tt));
  const mod = new Array(N);
  for(let i=0;i<N;i++) mod[i] = baseband[i] * carrier[i];
  const bitDur = duration / bits.length;
  const boundaries = []; for(let b=0;b<=bits.length;b++) boundaries.push(b*bitDur);
  return {t, baseband, carrier, mod, samplesPerBit, boundaries};
}
function demodBPSK(modSignal, fc, fs, samplesPerBit){
  const N = modSignal.length;
  const t = linspace(0, N/fs, N);
  const mixed = new Array(N);
  for(let i=0;i<N;i++) mixed[i] = modSignal[i] * Math.cos(2*Math.PI*fc*t[i]);
  const lp = movingAverage(mixed, samplesPerBit);
  const numBits = Math.floor(N/samplesPerBit);
  const recon = new Array(N).fill(0);
  const decisions = [];
  for(let b=0;b<numBits;b++){
    const start = b*samplesPerBit;
    const mid = Math.min(N-1, start + Math.floor(samplesPerBit/2));
    const val = lp[mid];
    const bit = val > 0 ? 1 : 0;
    decisions.push(bit);
    for(let i=start;i<Math.min(N,(b+1)*samplesPerBit);i++) recon[i] = bit?1:-1;
  }
  // constellation points: compute I,Q = received * cos, received * sin average per sample (scaled)
  const I = [], Q = [];
  for(let i=0;i<N;i++){
    I.push(modSignal[i] * Math.cos(2*Math.PI*fc*t[i]));
    Q.push(modSignal[i] * Math.sin(2*Math.PI*fc*t[i]));
  }
  return {mixed, lp, recon, decisions, I, Q};
}

// FSK: textbook per-bit sinusoid (restart phase each bit)
function genFSK(bits, amp, f0, f1, fs, duration){
  const N = Math.max(1, Math.floor(fs*duration));
  const samplesPerBit = Math.max(1, Math.floor(N/bits.length));
  const t = linspace(0, duration, N);
  const baseband = new Array(N);
  const carrier = new Array(N);
  const mod = new Array(N);
  for(let b=0;b<bits.length;b++){
    const f = bits[b]? f1 : f0;
    const start = b*samplesPerBit;
    const end = Math.min(N, (b+1)*samplesPerBit);
    for(let i=start;i<end;i++){
      const local_t = (i - start)/fs;
      const val = Math.cos(2*Math.PI*f*local_t);
      carrier[i] = val;
      mod[i] = amp * val;
      baseband[i] = bits[b]? amp : -amp;
    }
  }
  // fill leftovers
  const lastIdx = Math.min(N-1, bits.length*samplesPerBit - 1);
  for(let i=bits.length*samplesPerBit;i<N;i++){
    carrier[i] = carrier[lastIdx];
    mod[i] = mod[lastIdx];
    baseband[i] = baseband[lastIdx] || (bits[bits.length-1]?amp:-amp);
  }
  const bitDur = duration / bits.length;
  const boundaries = []; for(let b=0;b<=bits.length;b++) boundaries.push(b*bitDur);
  return {t, baseband, carrier, mod, samplesPerBit, boundaries, f0, f1};
}
function demodFSK(modSignal, f0, f1, fs, samplesPerBit){
  const N = modSignal.length;
  const t = linspace(0, N/fs, N);
  const numBits = Math.floor(N / samplesPerBit);
  const decisions = []; const recon = new Array(N).fill(0);
  // We'll also compute energy-projection points for constellation-like view
  const energies = [];
  for(let b=0;b<numBits;b++){
    const start = b*samplesPerBit;
    const end = Math.min(N, (b+1)*samplesPerBit);
    let corr0=0, corr1=0;
    for(let i=start;i<end;i++){
      corr0 += modSignal[i] * Math.cos(2*Math.PI*f0*t[i]);
      corr1 += modSignal[i] * Math.cos(2*Math.PI*f1*t[i]);
    }
    const bit = corr1 > corr0 ? 1 : 0;
    decisions.push(bit);
    energies.push({e0:corr0, e1:corr1});
    for(let i=start;i<end;i++) recon[i] = bit?1:-1;
  }
  return {decisions, recon, energies};
}

// ----------- Theory & Procedure content (editable / extendable) -----------
const docs = {
  bpsk: {
    theory: `<strong>BPSK Theory</strong><br>
             Binary Phase Shift Keying (BPSK) maps bits to two phases of a carrier (0° and 180°). 
             Transmitted signal = ±cos(2π f_c t).`,
    procedure: `<ol>
      <li>Enter amplitude, carrier frequency, sample rate and duration.</li>
      <li>Enter or generate bit pattern.</li>
      <li>Generate waveform — observe Input, Carrier, Modulated and Demodulated outputs.</li>
      <li>Look at constellation (I/Q) to see two clusters for 0 and 1.</li>
    </ol>`
  },
  fsk: {
    theory: `<strong>FSK Theory</strong><br>
             Frequency Shift Keying (FSK) represents bits by switching between two carrier frequencies f0 and f1 for bit 0 and bit 1 respectively.`,
    procedure: `<ol>
      <li>Enter amplitude, f0, f1, sample rate and duration.</li>
      <li>Enter or generate bit pattern.</li>
      <li>Generate waveform — observe Input, Carrier (per-bit), Modulated and Demodulated outputs.</li>
      <li>Constellation shows energy/correlation points per bit.</li>
    </ol>`
  }
};

// ----------- UI wiring & initialisation -----------
const expSelect = document.getElementById('experimentSelect');
const controlsArea = document.getElementById('controlsArea');
const btnRun = document.getElementById('btnRun');
const btnRandomBits = document.getElementById('btnRandomBits');
const btnDownload = document.getElementById('btnDownload');
const theoryBox = document.getElementById('theory');
const procedureBox = document.getElementById('procedure');
const infoBox = document.getElementById('infoBox');

function el(html){ const d=document.createElement('div'); d.innerHTML=html; return d.firstChild; }
function addNumber(id,label,val){ const div = el(`<div><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}"></div>`); controlsArea.appendChild(div); return div; }
function addInput(id,label,val){ const div = el(`<div><label for="${id}">${label}</label><input id="${id}" type="text" value="${val}"></div>`); controlsArea.appendChild(div); return div; }

function showBPSKControls(){
  controlsArea.innerHTML='';
  addNumber('amp','Amplitude (V)',1);
  addNumber('fc','Carrier freq (Hz)',10);
  addNumber('fs','Sample rate (Hz)',10000);
  addNumber('duration','Duration (s)',0.1);
  addInput('bits','Bit pattern (e.g. 101010)', '101011');
  theoryBox.innerHTML = docs.bpsk.theory;
  procedureBox.innerHTML = docs.bpsk.procedure;
  infoBox.innerHTML = 'Demodulation: coherent (assumes phase-aligned LO). Constellation: I vs Q samples.';
}
function showFSKControls(){
  controlsArea.innerHTML='';
  addNumber('amp','Amplitude (V)',1);
  addNumber('f0','Freq for bit 0 (Hz)',8);
  addNumber('f1','Freq for bit 1 (Hz)',12);
  addNumber('fs','Sample rate (Hz)',10000);
  addNumber('duration','Duration (s)',0.1);
  addInput('bits','Bit pattern (e.g. 101010)', '101011');
  theoryBox.innerHTML = docs.fsk.theory;
  procedureBox.innerHTML = docs.fsk.procedure;
  infoBox.innerHTML = 'Demodulation: energy/correlation per bit interval. Constellation shows (E0,E1) scatter.';
}

function renderControls(){
  if(expSelect.value === 'bpsk') showBPSKControls(); else showFSKControls();
}
expSelect.addEventListener('change', renderControls);
renderControls();

// Random bits
btnRandomBits.addEventListener('click', ()=>{
  const len = 8 + Math.floor(Math.random()*16);
  const bits = Array.from({length:len}, ()=> Math.random()>0.5 ? '1':'0').join('');
  const f = document.getElementById('bits'); if(f) f.value = bits;
});

// Download CSV
btnDownload.addEventListener('click', ()=>{
  try{
    const ex = expSelect.value;
    const amp = Number(document.getElementById('amp').value);
    const fs = Number(document.getElementById('fs').value);
    const dur = Number(document.getElementById('duration').value);
    const bits = parseBits(document.getElementById('bits').value);
    let data = [];
    if(ex==='bpsk'){
      const fc = Number(document.getElementById('fc').value);
      const {t, baseband, carrier, mod} = genBPSK(bits, amp, fc, fs, dur);
      for(let i=0;i<t.length;i++) data.push([t[i], baseband[i], carrier[i], mod[i]]);
    } else {
      const f0 = Number(document.getElementById('f0').value);
      const f1 = Number(document.getElementById('f1').value);
      const {t, baseband, carrier, mod} = genFSK(bits, amp, f0, f1, fs, dur);
      for(let i=0;i<t.length;i++) data.push([t[i], baseband[i], carrier[i], mod[i]]);
    }
    let csv = 'time,baseband,carrier,modulated\n' + data.map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'signals.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ alert('Download failed: '+e); }
});

// Main run handler
btnRun.addEventListener('click', ()=>{
  const ex = expSelect.value;
  const amp = Number(document.getElementById('amp').value) || 1;
  const fs = Math.max(100, Number(document.getElementById('fs').value) || 1000);
  const dur = Math.max(0.001, Number(document.getElementById('duration').value) || 0.1);
  const bits = parseBits(document.getElementById('bits').value);

  if(ex === 'bpsk'){
    const fc = Number(document.getElementById('fc').value) || 10;
    const {t, baseband, carrier, mod, samplesPerBit, boundaries} = genBPSK(bits, amp, fc, fs, dur);
    const dem = demodBPSK(mod, fc, fs, samplesPerBit);
    const traces = [
      {y: baseband, name:'Input (NRZ ±1)', color:'#1f77b4'},
      {y: carrier, name:`Carrier ${fc} Hz`, color:'#ff7f0e'},
      {y: mod, name:'BPSK Modulated', color:'#2ca02c'},
      {y: dem.recon, name:'Demodulated (NRZ)', color:'#d62728'}
    ];
    plotFourSubplots(t,traces,boundaries,`BPSK — fc=${fc}Hz, fs=${fs}Hz`);
    // Constellation: show I/Q scatter (we computed in demod)
    plotConstellationIQ(dem.I, dem.Q, 'BPSK: I/Q Scatter (received samples)');
  } else {
    const f0 = Number(document.getElementById('f0').value) || 8;
    const f1 = Number(document.getElementById('f1').value) || 12;
    const {t, baseband, carrier, mod, samplesPerBit, boundaries} = genFSK(bits, amp, f0, f1, fs, dur);
    const dem = demodFSK(mod, f0, f1, fs, samplesPerBit);
    const traces = [
      {y: baseband, name:'Input (NRZ ±1)', color:'#1f77b4'},
      {y: carrier, name:`Carrier (f0/f1)`, color:'#ff7f0e'},
      {y: mod, name:'FSK Modulated', color:'#2ca02c'},
      {y: dem.recon, name:'Demodulated (NRZ)', color:'#d62728'}
    ];
    plotFourSubplots(t,traces,boundaries,`FSK — f0=${f0}Hz / f1=${f1}Hz, fs=${fs}Hz`);
    // Constellation-like: energies per bit (E0 vs E1)
    const E0 = dem.energies.map(e=>e.e0);
    const E1 = dem.energies.map(e=>e.e1);
    plotConstellationIQ(E0, E1, 'FSK: Energy scatter (E0 vs E1 per bit)');
  }
});

// initial run
window.addEventListener('load', ()=>{ setTimeout(()=>btnRun.click(),150); });
