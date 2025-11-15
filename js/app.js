// js/app.js
// BPSK + FSK virtual lab (based on reference) — clean sinusoidal carriers and correct sampling

// ---------- Utilities ----------
function linspace(a,b,n){ const out=[]; if(n<=1){ out.push(a); return out;} const step=(b-a)/(n-1); for(let i=0;i<n;i++) out.push(a+step*i); return out; }
function parseBits(str){ const s=String(str||'').trim().replace(/[^01]/g,''); return s.length? s.split('').map(x=>+x):[]; }
function avg(arr){ if(!arr.length) return 0; return arr.reduce((s,v)=>s+v,0)/arr.length; }

// ---------- DOM references ----------
const experimentSelect = document.getElementById('experimentSelect');
const controlsArea = document.getElementById('controlsArea');
const btnGenerate = document.getElementById('btnGenerate');
const btnRun = document.getElementById('btnRun');
const btnRandom = document.getElementById('btnRandom');
const btnDownload = document.getElementById('btnDownload');
const btnReset = document.getElementById('btnReset');

const plotInput = 'plotInput', plotCarrier='plotCarrier', plotMod='plotMod', plotDemod='plotDemod', plotConst='plotConst';
const resInput = document.getElementById('resInput'), resDemod = document.getElementById('resDemod'),
      resBER = document.getElementById('resBER'), resExtra = document.getElementById('resExtra');

const miniTheory = document.getElementById('miniTheory');
const theory = document.getElementById('theory'), procedure = document.getElementById('procedure');

// Simulation data holder
let sim = {};

// ---------- Control rendering ----------
function renderControls(){
  controlsArea.innerHTML = '';
  const ex = experimentSelect.value;
  // common controls
  const dom = (html)=>{ const d=document.createElement('div'); d.innerHTML=html; return d.firstChild; };
  controlsArea.appendChild(dom(`<label>Binary input (0/1)</label><input id="inpBits" value="10101100" />`));
  controlsArea.appendChild(dom(`<label>Bit rate (bps)</label><input id="inpBitRate" type="number" value="80" min="1" />`));
  controlsArea.appendChild(dom(`<label>Amplitude (V)</label><input id="inpAmp" type="number" value="1" step="0.1" />`));
  controlsArea.appendChild(dom(`<label>Sample rate (Hz)</label><input id="inpFs" type="number" value="8000" min="1000" />`));
  controlsArea.appendChild(dom(`<label>SNR (dB)</label><input id="inpSNR" type="number" value="30" min="0" />`));

  if(ex === 'bpsk'){
    controlsArea.appendChild(dom(`<label>Carrier freq (Hz)</label><input id="inpFc" type="number" value="1200" min="10" />`));
    miniTheory.innerHTML = 'BPSK — maps bits to 0° (1) or 180° (0) phase on carrier. Uses coherent demodulation.';
    theory.innerHTML = `<h4>BPSK Theory</h4>
      <p>Binary Phase Shift Keying maps bits to two phases of a carrier: typically 0° for '1' and 180° for '0'. s(t)=A cos(2πf_c t + φ)</p>`;
    procedure.innerHTML = `<ol><li>Enter bit sequence and parameters.</li><li>Generate & Run to observe Input, Carrier, Modulated and Demodulated outputs.</li></ol>`;
  } else {
    controlsArea.appendChild(dom(`<label>Freq for bit 0 (Hz)</label><input id="inpF0" type="number" value="800" min="10" />`));
    controlsArea.appendChild(dom(`<label>Freq for bit 1 (Hz)</label><input id="inpF1" type="number" value="1200" min="10" />`));
    miniTheory.innerHTML = 'FSK — represents 0/1 by switching between f0 and f1. Here we use per-bit sinusoids (textbook).';
    theory.innerHTML = `<h4>FSK Theory</h4><p>Frequency Shift Keying uses frequency changes to represent symbols. Per-bit sinusoids shown here restart phase each bit.</p>`;
    procedure.innerHTML = `<ol><li>Enter bit sequence and parameters.</li><li>Generate & Run to observe Input, Carrier, Modulated and Demodulated outputs and energy scatter.</li></ol>`;
  }
}
experimentSelect.addEventListener('change', renderControls);
renderControls();

// ---------- Signal generation helpers ----------
// We'll compute duration from bitRate: duration = numBits / bitRate
// Ensure integer samplesPerBit and N = samplesPerBit * numBits for clean alignment

function genSignalsFromForm(){
  const ex = experimentSelect.value;
  const bitsTxt = document.getElementById('inpBits').value || '';
  const bits = parseBits(bitsTxt);
  if(!bits.length){ alert('Enter binary bits (0/1)'); return null; }
  const bitRate = Math.max(1, Number(document.getElementById('inpBitRate').value) || 1);
  const amp = Number(document.getElementById('inpAmp').value) || 1;
  const fs = Math.max(100, Number(document.getElementById('inpFs').value) || 8000);
  const snr = Number(document.getElementById('inpSNR').value);
  const numBits = bits.length;
  const duration = numBits / bitRate;
  const samplesPerBit = Math.max(4, Math.floor((fs / bitRate))); // fs/bitRate samples per bit
  const N = samplesPerBit * numBits;
  const t = linspace(0, duration, N);

  const baseband = new Array(N);
  for(let b=0;b<numBits;b++){
    const start = b * samplesPerBit;
    const end = start + samplesPerBit;
    const v = bits[b] ? 1 : -1;
    for(let i=start;i<end;i++) baseband[i] = v * amp;
  }

  if(ex === 'bpsk'){
    const fc = Number(document.getElementById('inpFc').value) || 1000;
    // carrier is continuous cos(2π f t)
    const carrier = t.map(tt => amp * Math.cos(2*Math.PI*fc*tt));
    const mod = new Array(N);
    for(let i=0;i<N;i++){
      // BPSK: phase 0 for '1', π for '0' -> multiply by ±1
      mod[i] = baseband[i] * Math.cos(2*Math.PI*fc*t[i]);
    }
    const modNoisy = addNoise(mod, snr);
    return { ex, bits, t, N, samplesPerBit, baseband, carrier, mod: modNoisy, fc, amp, bitRate, fs, snr };
  } else {
    const f0 = Number(document.getElementById('inpF0').value) || 600;
    const f1 = Number(document.getElementById('inpF1').value) || 1200;
    const carrier = new Array(N);
    const mod = new Array(N);
    // per-bit sinusoid restart phase at each bit start -> local_t
    for(let b=0;b<numBits;b++){
      const f = bits[b] ? f1 : f0;
      const start = b * samplesPerBit;
      const end = start + samplesPerBit;
      for(let i=start;i<end;i++){
        const local_t = (i - start)/fs; // resets at bit boundary
        const val = Math.cos(2*Math.PI*f*local_t);
        carrier[i] = amp * val;
        mod[i] = amp * val;
      }
    }
    const modNoisy = addNoise(mod, snr);
    return { ex, bits, t, N, samplesPerBit, baseband, carrier, mod: modNoisy, f0, f1, amp, bitRate, fs, snr };
  }
}

// ---------- Noise ----------
function addNoise(signal, snrDB){
  if(typeof snrDB !== 'number' || !isFinite(snrDB)) return signal.slice();
  const snrLin = Math.pow(10, snrDB/10);
  const power = avg(signal.map(v=>v*v));
  const noisePower = power / Math.max(1e-12, snrLin);
  const sigma = Math.sqrt(noisePower);
  return signal.map(v => v + (randn()*sigma));
}
// simple gaussian random (Box-Muller)
function randn(){ let u=0,v=0; while(u===0) u=Math.random(); while(v===0) v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

// ---------- Demodulators ----------
function demodBPSK(modSignal, fc, fs, samplesPerBit){
  const N = modSignal.length;
  const t = linspace(0, N/fs, N);
  // multiply with local cos, average per bit
  const mixed = new Array(N);
  for(let i=0;i<N;i++) mixed[i] = modSignal[i] * Math.cos(2*Math.PI*fc*t[i]);
  const recon = new Array(N);
  const decisions = [];
  for(let b=0;b<Math.floor(N/samplesPerBit);b++){
    const start = b*samplesPerBit;
    const end = start + samplesPerBit;
    const avgVal = avg(mixed.slice(start,end));
    const bit = avgVal >= 0 ? 1 : 0;
    decisions.push(bit);
    for(let i=start;i<end;i++) recon[i] = bit ? 1 : -1;
  }
  // Constellation points (I,Q) using local oscillator per sample (use product with cos and sin)
  const I =[], Q=[];
  for(let i=0;i<N;i++){
    const loC = Math.cos(2*Math.PI*fc*t[i]);
    const loS = Math.sin(2*Math.PI*fc*t[i]);
    I.push(modSignal[i]*loC);
    Q.push(modSignal[i]*loS);
  }
  return { recon, decisions, I, Q };
}

function demodFSK(modSignal, f0, f1, fs, samplesPerBit){
  const N = modSignal.length;
  const t = linspace(0, N/fs, N);
  const recon = new Array(N);
  const decisions = [];
  const energies = [];
  for(let b=0;b<Math.floor(N/samplesPerBit);b++){
    const start = b*samplesPerBit;
    const end = start + samplesPerBit;
    let c0=0,c1=0;
    for(let i=start;i<end;i++){
      c0 += modSignal[i]*Math.cos(2*Math.PI*f0*t[i]);
      c1 += modSignal[i]*Math.cos(2*Math.PI*f1*t[i]);
    }
    const bit = c1>c0 ? 1:0;
    decisions.push(bit);
    energies.push({e0:c0,e1:c1});
    for(let i=start;i<end;i++) recon[i] = bit?1:-1;
  }
  return { recon, decisions, energies };
}

// ---------- Plotting ----------
function plotLine(div, x, y, name, opts={}){
  const trace = { x, y, type:'scatter', mode:'lines', line:{width:2}, name };
  const layout = { margin:{l:50,r:30,t:20,b:50}, plot_bgcolor:'#fff', paper_bgcolor:'#fff', xaxis:{title:'Time (s)'} , yaxis:{title:'Amplitude (V)'} };
  Plotly.react(div, [trace], layout, {responsive:true,displayModeBar:true});
}
function plotHV(div, x, y, name, opts={}){
  const trace = { x, y, type:'scatter', mode:'lines', line:{width:2, shape:'hv'}, name };
  const layout = { margin:{l:50,r:30,t:20,b:50}, xaxis:{title:'Time (s)'}, yaxis:{title:'Amplitude (V)'} };
  Plotly.react(div,[trace],layout,{responsive:true});
}
function plotScatter(div, X, Y, name, xlabel='X', ylabel='Y'){
  const trace = { x: X, y: Y, mode:'markers', marker:{size:6}, name };
  const layout = { margin:{l:50,r:30,t:20,b:50}, xaxis:{title:xlabel}, yaxis:{title:ylabel} };
  Plotly.react(div,[trace],layout,{responsive:true});
}

// ---------- UI Actions ----------
btnGenerate.addEventListener('click', ()=>{
  const out = genSignalsFromForm();
  if(!out) return;
  sim = out;
  // Plot input (HV style)
  plotHV(plotInput, sim.t, sim.baseband, 'Input (NRZ)');
  // Plot carrier (for BPSK show continuous carrier; for FSK show instantaneous carrier vector used)
  plotLine(plotCarrier, sim.t, sim.carrier, 'Carrier');
  // Plot modulated (noisy)
  plotLine(plotMod, sim.t, sim.mod, 'Modulated');
  // Clear demod & results until Run
  Plotly.purge(plotDemod);
  Plotly.purge(plotConst);
  resInput.textContent = sim.bits.join('');
  resDemod.textContent = '-';
  resBER.textContent = '-';
  resExtra.innerHTML = '';
});

btnRun.addEventListener('click', ()=>{
  if(!sim.t){ alert('Generate first'); return; }
  if(sim.ex === 'bpsk'){
    const dem = demodBPSK(sim.mod, sim.fc, sim.fs, sim.samplesPerBit);
    plotHV(plotDemod, sim.t, dem.recon, 'Demodulated (NRZ)');
    // Constellation: show I,Q scatter (we'll plot per-sample scatter)
    plotScatter(plotConst, dem.I, dem.Q, 'I vs Q', 'I', 'Q');
    // results
    const decisions = dem.decisions.join('');
    resDemod.textContent = decisions;
    // BER
    const input = sim.bits.join('');
    let errors=0;
    for(let i=0;i<input.length;i++) if(input[i] != decisions[i]) errors++;
    resBER.textContent = (errors/input.length).toFixed(4);
    resExtra.innerHTML = `<div>fc: ${sim.fc} Hz | fs: ${sim.fs} Hz</div>`;
  } else {
    const dem = demodFSK(sim.mod, sim.f0, sim.f1, sim.fs, sim.samplesPerBit);
    plotHV(plotDemod, sim.t, dem.recon, 'Demodulated (NRZ)');
    // Energy scatter (E0 vs E1) per bit
    const E0 = dem.energies.map(e=>e.e0), E1 = dem.energies.map(e=>e.e1);
    plotScatter(plotConst, E0, E1, 'E0 vs E1', 'E0', 'E1');
    const decisions = dem.decisions.join('');
    resDemod.textContent = decisions;
    const input = sim.bits.join(''); let errors=0;
    for(let i=0;i<input.length;i++) if(input[i] != decisions[i]) errors++;
    resBER.textContent = (errors/input.length).toFixed(4);
    resExtra.innerHTML = `<div>f0: ${sim.f0} Hz | f1: ${sim.f1} Hz | fs: ${sim.fs} Hz</div>`;
  }
});

btnRandom.addEventListener('click', ()=>{
  const len = 8 + Math.floor(Math.random()*24);
  const bits = Array.from({length:len}, ()=> Math.random()>0.5 ? '1':'0').join('');
  document.getElementById('inpBits').value = bits;
});

btnDownload.addEventListener('click', ()=>{
  if(!sim.t){ alert('Generate first'); return; }
  const rows = [['time','baseband','carrier','modulated']];
  for(let i=0;i<sim.t.length;i++) rows.push([sim.t[i], sim.baseband[i], sim.carrier[i], sim.mod[i]]);
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'signals.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});

btnReset.addEventListener('click', ()=>{
  sim = {}; Plotly.purge(plotInput); Plotly.purge(plotCarrier); Plotly.purge(plotMod); Plotly.purge(plotDemod); Plotly.purge(plotConst);
  resInput.textContent = '-'; resDemod.textContent='-'; resBER.textContent='-'; resExtra.innerHTML='';
});

// ---------- Initialize default generate for first view ----------
window.addEventListener('load', ()=>{ setTimeout(()=>{ document.getElementById('btnGenerate').click(); },120); });
