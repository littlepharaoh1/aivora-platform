// @ts-nocheck
import React, { useState, useRef, useEffect } from "react";
import { analyzeAudioBuffer, scoreAnalysis } from "../lib/audio/AdvancedAudioAnalyzer";
import { validateStudioCompliance } from "../lib/audio/StudioSpecCompliance";
import { analyzeAudioQuality } from "../lib/audioQc/audioAnalyzerCore";
import { restoreNaturalSilence } from "../lib/audioQc/silenceRestorer";
import { Upload, BarChart3, CheckCircle2, XCircle, AlertTriangle, Download, Wand2, Wrench } from "lucide-react";
import { repairAudioBuffer } from "../lib/audioQc/repair/repairPipeline";
import { computeSpectrogram, drawSpectrogram } from "../lib/audioQc/spectrogram";
import { exportToWav, downloadWav } from "../lib/audioQc/repair/wavExporter";

const PROFILES = {
  wakeword:     { label:"Wake Word",    icon:"🎙️", color:"#22d3ee", th:{ pkMin:-6,  pkMax:-1,  rmsMin:-28, rmsMax:-10, noiseMax:-60, snrMin:45, silMax:0.15 } },
  asr:          { label:"ASR / Speech", icon:"🗣️", color:"#10b981", th:{ pkMin:-9,  pkMax:-2,  rmsMin:-32, rmsMax:-12, noiseMax:-55, snrMin:35, silMax:0.30 } },
  tts:          { label:"TTS Training", icon:"🔊", color:"#f59e0b", th:{ pkMin:-6,  pkMax:-1,  rmsMin:-24, rmsMax:-8,  noiseMax:-65, snrMin:50, silMax:0.20 } },
  conversation: { label:"Conversation", icon:"💬", color:"#8b5cf6", th:{ pkMin:-12, pkMax:-3,  rmsMin:-35, rmsMax:-15, noiseMax:-50, snrMin:25, silMax:0.40 } },
};

function toDb(v) { return v <= 0 ? -120 : 20 * Math.log10(v); }

async function analyze(buf, name, pk) {
  const profileMap = { wakeword:"wakeword_studio", asr:"asr_studio", tts:"tts_studio", conversation:"conversation_studio" };
  const p = PROFILES[pk];
  const analysis = await analyzeAudioBuffer(buf);
  const scored   = scoreAnalysis(analysis, pk);
  const compliance = validateStudioCompliance(analysis, profileMap[pk] || "asr_studio");

  // Run new QC engine in parallel
  const mono = buf.getChannelData(0);
  const qcResult = await analyzeAudioQuality(mono, buf.sampleRate, pk);

  const edges = { silRatio: analysis.silence.silenceRatio, leadMs: analysis.silence.leadingMs, trailMs: analysis.silence.trailingMs };
  const hum   = { detected: analysis.noise.type==="hum_50"||analysis.noise.type==="hum_60", freq: analysis.noise.humFreq||0, strength: analysis.noise.humStrength||0 };
  const voice = { pct: Math.round(analysis.vad.voiceRatio*100), present: analysis.vad.voiceRatio>0.1 };

  return {
    name, pk, plabel:p.label, picon:p.icon, pcolor:p.color,
    total:scored.total, grade:scored.grade, verdict:scored.verdict, checks:scored.checks,
    edges, hum, voice,
    pkDb:analysis.peakDb, rDb:analysis.rmsDb, nDb:analysis.noise.floorDb,
    snr:analysis.snrDb, clip:analysis.clipping.hardClips, dur:analysis.duration, sr:analysis.sampleRate,
    analysis, env:analysis.environment, silence:analysis.silence, lufs:analysis.lufs, compliance,
    // New QC engine results
    qc: qcResult,
    _buf: buf,
    time: new Date().toLocaleTimeString()
  };
}

function Ring({score,grade,verdict}) {
  const r=50,c=2*Math.PI*r,off=c-(score/100)*c;
  const col=score>=90?"#22d3ee":score>=75?"#10b981":score>=60?"#f59e0b":score>=40?"#f97316":"#ef4444";
  const vc=verdict==="READY"?"#10b981":verdict==="REVIEW"?"#f59e0b":"#ef4444";
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
    <div style={{position:"relative",width:120,height:120}}>
      <svg width={120} height={120} style={{transform:"rotate(-90deg)"}}>
        <circle cx={60} cy={60} r={r} fill="none" stroke="#0f2a3a" strokeWidth={10}/>
        <circle cx={60} cy={60} r={r} fill="none" stroke={col} strokeWidth={10} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{transition:"stroke-dashoffset 1.2s"}}/>
      </svg>
      <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:26,fontWeight:900,color:col,fontFamily:"monospace",lineHeight:1}}>{score}</div>
        <div style={{fontSize:16,fontWeight:700,color:col,fontFamily:"monospace"}}>{grade}</div>
      </div>
    </div>
    <div style={{padding:"3px 14px",borderRadius:20,background:vc+"22",border:"1px solid "+vc+"44",color:vc,fontSize:11,fontFamily:"monospace",fontWeight:700,letterSpacing:2}}>{verdict}</div>
  </div>;
}

function Row({c}) {
  const [open,setOpen]=useState(false);
  const icon=c.ok&&!c.w?<CheckCircle2 size={13} color="#10b981"/>:c.w?<AlertTriangle size={13} color="#f59e0b"/>:<XCircle size={13} color="#ef4444"/>;
  const bc=(c.score||c.sc)>=80?"#10b981":(c.score||c.sc)>=50?"#f59e0b":"#ef4444";
  return <div onClick={()=>setOpen(!open)} style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:8,padding:"9px 12px",cursor:"pointer"}}>
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      {icon}
      <span style={{flex:1,fontSize:11,fontFamily:"monospace",color:"#a0c4cc"}}>{c.label||c.lb}{c.bonus&&<span style={{fontSize:9,color:"#2a5a6a",marginLeft:6}}>ADV</span>}</span>
      <span style={{fontSize:11,color:"#4a8a9a",fontFamily:"monospace"}}>{c.value||c.val}</span>
      <div style={{width:50,height:3,background:"#0f2a3a",borderRadius:2,marginLeft:8}}><div style={{height:"100%",width:(c.score||c.sc)+"%",background:bc,borderRadius:2}}/></div>
      <span style={{fontSize:10,color:bc,fontFamily:"monospace",minWidth:24,textAlign:"right"}}>{c.score||c.sc}</span>
    </div>
    {open&&<div style={{marginTop:6,paddingTop:6,borderTop:"1px solid #0f2a3a",fontSize:10,color:"#4a8a9a"}}>{c.label||c.lb} — Score: {c.score||c.sc}{!c.bonus&&" · Weight: "+c.w8+"%"}</div>}
  </div>;
}

function MetricCard({label,value,sub,color="#a0c4cc"}) {
  return <div style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:8,padding:"8px 10px",minWidth:80}}>
    <div style={{fontSize:8,color:"#4a8a9a",marginBottom:2}}>{label}</div>
    <div style={{fontSize:12,color:color,fontWeight:700,fontFamily:"monospace"}}>{value}</div>
    {sub&&<div style={{fontSize:9,color:"#2a5a6a",marginTop:1}}>{sub}</div>}
  </div>;
}

function Badge({label,value,ok}) {
  const c=ok?"#10b981":"#ef4444";
  return <div style={{display:"flex",alignItems:"center",gap:6}}>
    <span style={{fontSize:9,color:"#4a8a9a",minWidth:60}}>{label}</span>
    <span style={{fontSize:9,color:c,background:c+"22",padding:"2px 8px",borderRadius:4,fontWeight:700}}>{value}</span>
  </div>;
}

export default function AudioQualityAnalyzer() {
  const [rep,setRep]=useState(null);
  const [loading,setLoading]=useState(false);
  const [pk,setPk]=useState("wakeword");
  const [hist,setHist]=useState([]);
  const [restoring,setRestoring]=useState(false);
  const [restored,setRestored]=useState(null);
  const [repairing,setRepairing]=useState(false);
  const [repairResult,setRepairResult]=useState(null);
  const [repairOpts,setRepairOpts]=useState({humRemoval:false,humFrequency:50,loudnessNormalize:false,trimSilence:false,shortenInternalSilence:false});
  const [spectrogramData,setSpectrogramData]=useState(null);
  const canvasRef=useRef(null);
  const prof=PROFILES[pk];

  async function go(file) {
    if(!file.name.toLowerCase().endsWith(".wav"))return;
    setLoading(true);setRep(null);setRestored(null);
    try{
      const ab=await file.arrayBuffer();
      const ctx=new AudioContext();
      const buf=await ctx.decodeAudioData(ab);
      const r=await analyze(buf,file.name,pk);
      setRep(r);setHist(prev=>[r,...prev.slice(0,9)]);
      const spec=computeSpectrogram(buf,{fftSize:2048,sampleRate:buf.sampleRate});
      setSpectrogramData(spec);
    }catch(e){console.error(e);}
    setLoading(false);
  }

  async function doRestore() {
    if(!rep?._buf)return;
    setRestoring(true);
    try{
      const result=restoreNaturalSilence(rep._buf);
      setRestored(result);
    }catch(e){console.error(e);}
    setRestoring(false);
  }

  async function doRepair() {
    if(!rep?._buf)return;
    setRepairing(true);setRepairResult(null);
    try{
      const profileTargets={wakeword:-20,asr:-20,tts:-20,conversation:-23};
      const result=repairAudioBuffer(rep._buf,{
        ...repairOpts,
        humFrequency:repairOpts.humFrequency,
        targetLufs:profileTargets[pk]||(-20),
        profile:pk,
      },rep.name);
      setRepairResult(result);
    }catch(e){console.error(e);}
    setRepairing(false);
  }

  function doExport(){
    if(!repairResult?.repairedBuffer)return;
    const wav=exportToWav(repairResult.repairedBuffer,rep?.name||"audio");
    downloadWav(wav);
  }

  useEffect(()=>{
    if(canvasRef.current&&spectrogramData){
      drawSpectrogram(canvasRef.current,spectrogramData);
    }
  },[spectrogramData]);

  const vc=rep?.verdict==="READY"?"#10b981":rep?.verdict==="REVIEW"?"#f59e0b":"#ef4444";
  const qc=rep?.qc;
  const noiseColor=qc?.metrics.noiseClass==="clean"?"#10b981":qc?.metrics.noiseClass?.includes("hum")?"#ef4444":"#f59e0b";
  const envColor=qc?.metrics.environment==="studio"?"#10b981":qc?.metrics.environment==="treated_room"?"#22d3ee":"#f59e0b";
  const snrColor=qc?.metrics.snrDb>=30?"#10b981":qc?.metrics.snrDb>=20?"#f59e0b":"#ef4444";
  const lufsColor=qc?.metrics.lufs>=-26&&qc?.metrics.lufs<=-14?"#10b981":"#f59e0b";

  return <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>
    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#060e18,#071a18)",borderBottom:"1px solid #0f2a3a",padding:"14px 18px",display:"flex",alignItems:"center",gap:12}}>
      <div style={{width:36,height:36,borderRadius:10,background:prof.color+"22",border:"1px solid "+prof.color+"44",display:"flex",alignItems:"center",justifyContent:"center"}}><BarChart3 size={16} color={prof.color}/></div>
      <div><div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>AUDIO QUALITY ANALYZER</div><div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>V4 · {prof.icon} {prof.label.toUpperCase()}</div></div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"240px 1fr",minHeight:"calc(100vh - 65px)"}}>
      {/* Sidebar */}
      <div style={{borderRight:"1px solid #0f2a3a",padding:12,display:"flex",flexDirection:"column",gap:10,overflowY:"auto"}}>
        <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1}}>PROFILE</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {Object.entries(PROFILES).map(([id,p])=>(
            <div key={id} onClick={()=>setPk(id)} style={{border:"1px solid "+(pk===id?p.color+"66":"#0f2a3a"),borderRadius:10,padding:"10px 8px",cursor:"pointer",background:pk===id?p.color+"11":"#060e16"}}>
              <div style={{fontSize:16}}>{p.icon}</div>
              <div style={{fontSize:10,fontWeight:700,color:pk===id?p.color:"#a0c4cc"}}>{p.label}</div>
            </div>
          ))}
        </div>
        <div onClick={()=>document.getElementById("aqa-i").click()} style={{border:"2px dashed "+prof.color+"44",borderRadius:10,padding:"18px 10px",textAlign:"center",cursor:"pointer",background:"#050d14"}}>
          <input id="aqa-i" type="file" accept=".wav" hidden onChange={e=>{if(e.target.files[0])go(e.target.files[0]);}}/>
          <Upload size={18} color={prof.color} style={{marginBottom:6}}/>
          <div style={{fontSize:11,color:"#a0c4cc"}}>{loading?"Analyzing...":"Upload WAV"}</div>
        </div>
        <div style={{fontSize:9,color:"#4a8a9a"}}>HISTORY</div>
        {hist.map((r,i)=>{
          const c=r.verdict==="READY"?"#10b981":r.verdict==="REVIEW"?"#f59e0b":"#ef4444";
          return <div key={i} onClick={()=>{setRep(r);setRestored(null);}} style={{background:"#060e16",border:"1px solid "+c+"33",borderRadius:7,padding:"8px 10px",cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:c}}>{PROFILES[r.pk]?.icon} {r.grade}</span><span style={{fontSize:9,color:"#4a8a9a"}}>{r.total}/100</span></div>
            <div style={{fontSize:10,color:"#a0c4cc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
            <div style={{height:2,background:"#0f2a3a",borderRadius:2,marginTop:4}}><div style={{height:"100%",width:r.total+"%",background:c,borderRadius:2}}/></div>
          </div>;
        })}
      </div>

      {/* Main */}
      <div style={{padding:14,display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
        {!rep&&!loading&&<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,opacity:0.4}}><BarChart3 size={52} color="#1a4a5a"/><div style={{fontSize:13,color:"#2a5a6a",textAlign:"center"}}>Select profile and upload WAV</div></div>}

        {rep&&<>
          {/* Score card */}
          <div style={{background:"#060e16",border:"1px solid "+vc+"33",borderRadius:12,padding:16,display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
            <Ring score={rep.total} grade={rep.grade} verdict={rep.verdict}/>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:"#e0f2f8",fontWeight:700,marginBottom:4}}>{rep.name}</div>
              <div style={{fontSize:9,color:rep.pcolor,marginBottom:10}}>{rep.picon} {rep.plabel} · {rep.time}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {[["Dur",rep.dur.toFixed(2)+"s"],["Rate",rep.sr+"Hz"],["Peak",rep.pkDb.toFixed(1)+"dBFS"],["RMS",rep.rDb.toFixed(1)+"dBFS"],["Noise",rep.nDb.toFixed(1)+"dBFS"],["SNR",rep.snr.toFixed(1)+"dB"],["Voice",rep.voice.pct+"%"],["Hum",rep.hum.detected?rep.hum.freq+"Hz":"None"]].map(([l,v])=>(
                  <div key={l} style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,padding:"4px 8px"}}><div style={{fontSize:8,color:"#4a8a9a"}}>{l}</div><div style={{fontSize:11,color:"#cbd5e1",fontWeight:700}}>{v}</div></div>
                ))}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <Badge label="HUM"   value={rep.hum.detected?"DETECTED":"CLEAN"}   ok={!rep.hum.detected}/>
              <Badge label="VOICE" value={rep.voice.present?"PRESENT":"WEAK"}     ok={rep.voice.present}/>
            </div>
          </div>

          {/* ── NEW: DSP Engine Metrics ── */}
          {qc&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,padding:14}}>
            <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1,marginBottom:10}}>DSP ENGINE · EBU R128 + FFT + VAD + SNR</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
              <MetricCard label="LUFS (Integrated)" value={qc.metrics.lufs.toFixed(1)+" LUFS"} color={lufsColor}/>
              <MetricCard label="True Peak"         value={qc.metrics.truePeak.toFixed(2)+" dBTP"} color={qc.metrics.truePeak>-1?"#ef4444":"#10b981"}/>
              <MetricCard label="LRA"               value={qc.metrics.lra.toFixed(1)+" LU"} color="#a0c4cc"/>
              <MetricCard label="SNR"               value={qc.metrics.snrDb.toFixed(1)+" dB"} color={snrColor} sub={qc.metrics.quality.toUpperCase()}/>
              <MetricCard label="Noise Class"       value={qc.metrics.noiseClass.replace("_"," ").toUpperCase()} color={noiseColor}/>
              <MetricCard label="Environment"       value={qc.metrics.environment.replace("_"," ").toUpperCase()} color={envColor}/>
              <MetricCard label="Speech Ratio"      value={(qc.metrics.speechRatio*100).toFixed(1)+"%" } color={qc.metrics.speechRatio>0.3?"#10b981":"#f59e0b"}/>
              <MetricCard label="QC Score"          value={qc.score+"/100"} color={qc.score>=75?"#10b981":qc.score>=50?"#f59e0b":"#ef4444"} sub={qc.deliveryRisk}/>
            </div>

            {/* QC Problems */}
            {qc.problems.length>0&&<div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12}}>
              <div style={{fontSize:9,color:"#4a8a9a",marginBottom:4}}>QC PROBLEMS DETECTED</div>
              {qc.problems.map((p,i)=>{
                const pc=p.severity==="critical"?"#ef4444":p.severity==="warning"?"#f59e0b":p.severity==="medium"?"#f97316":"#4a8a9a";
                return <div key={i} style={{background:"#050d14",border:"1px solid "+pc+"33",borderRadius:6,padding:"6px 10px",display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{fontSize:9,color:pc,background:pc+"22",padding:"1px 6px",borderRadius:3,fontWeight:700,whiteSpace:"nowrap"}}>{p.severity.toUpperCase()}</span>
                  <span style={{fontSize:10,color:"#a0c4cc"}}>{p.message}</span>
                  {p.suggestedAction&&<span style={{fontSize:9,color:"#4a8a9a",marginLeft:"auto",whiteSpace:"nowrap"}}>→ {p.suggestedAction}</span>}
                </div>;
              })}
            </div>}

            {/* Restoration */}
            <div style={{borderTop:"1px solid #0f2a3a",paddingTop:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:9,color:"#4a8a9a"}}>NATURAL SILENCE RESTORATION</div>
                <button onClick={doRestore} disabled={restoring} style={{display:"flex",alignItems:"center",gap:6,background:restoring?"#0f2a3a":"#10b98122",border:"1px solid #10b98144",borderRadius:6,padding:"5px 12px",cursor:restoring?"not-allowed":"pointer",color:"#10b981",fontSize:10,fontWeight:700}}>
                  <Wand2 size={11}/>{restoring?"Restoring...":"Run Restoration"}
                </button>
                {restored&&<span style={{fontSize:9,color:restored.changed?"#10b981":"#4a8a9a"}}>
                  {restored.changed?`✓ ${restored.segmentsRestored} segment(s) restored · ${restored.totalRestoredMs.toFixed(0)}ms`:"No digital silence found"}
                </span>}
              </div>
            </div>
          </div>}

          {/* Spectrogram */}
          {spectrogramData&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,padding:14}}>
            <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1,marginBottom:8}}>SPECTROGRAM · {spectrogramData.numFrames} FRAMES · FFT {spectrogramData.fftSize}</div>
            <div style={{position:"relative",width:"100%",borderRadius:8,overflow:"hidden",background:"#040c14"}}>
              <canvas ref={canvasRef} width={800} height={200}
                style={{width:"100%",height:180,display:"block",borderRadius:8}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
              <span style={{fontSize:9,color:"#2a5a6a"}}>0s</span>
              <span style={{fontSize:9,color:"#2a5a6a",textAlign:"center"}}>← time →</span>
              <span style={{fontSize:9,color:"#2a5a6a"}}>{spectrogramData.durationSec.toFixed(2)}s</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
              <div style={{height:8,flex:1,borderRadius:4,background:"linear-gradient(to right,#08080a,#003c78,#008080,#00c878,#b4dc00,#ffa000,#ff3c14,#ffffff)"}}/>
              <div style={{display:"flex",justifyContent:"space-between",width:"100%",position:"absolute",pointerEvents:"none"}}>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
              <span style={{fontSize:8,color:"#2a5a6a"}}>-90 dB</span>
              <span style={{fontSize:8,color:"#2a5a6a"}}>-45 dB</span>
              <span style={{fontSize:8,color:"#2a5a6a"}}>0 dB</span>
            </div>
          </div>}

          {/* Honest Audio Repair Suite */}
          <div style={{background:"#060e16",border:"1px solid #1a3a2a",borderRadius:12,padding:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <Wrench size={13} color="#10b981"/>
              <span style={{fontSize:9,color:"#10b981",letterSpacing:1,fontWeight:700}}>HONEST AUDIO REPAIR SUITE</span>
            </div>
            <div style={{fontSize:9,color:"#4a8a9a",marginBottom:10,padding:"6px 10px",background:"#050d14",borderRadius:6,border:"1px solid #0f2a3a"}}>
              ⚠ Repairs are manual and should be reviewed before delivery.
            </div>
            {/* Options */}
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
              {[
                ["humRemoval",      "Remove Hum",          repairOpts.humRemoval],
                ["loudnessNormalize","Normalize Loudness",  repairOpts.loudnessNormalize],
                ["trimSilence",     "Trim Silence",         repairOpts.trimSilence],
                ["shortenInternalSilence","Shorten Gaps",   repairOpts.shortenInternalSilence],
              ].map(([key,label,active])=>(
                <div key={key} onClick={()=>setRepairOpts(p=>({...p,[key]:!p[key]}))}
                  style={{padding:"5px 12px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:700,
                    background:active?"#10b98122":"#050d14",
                    border:"1px solid "+(active?"#10b98166":"#0f2a3a"),
                    color:active?"#10b981":"#4a8a9a"}}>
                  {label}
                </div>
              ))}
              {repairOpts.humRemoval&&<div style={{display:"flex",gap:4}}>
                {([50,60]).map(f=>(
                  <div key={f} onClick={()=>setRepairOpts(p=>({...p,humFrequency:f}))}
                    style={{padding:"5px 10px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:700,
                      background:repairOpts.humFrequency===f?"#f59e0b22":"#050d14",
                      border:"1px solid "+(repairOpts.humFrequency===f?"#f59e0b66":"#0f2a3a"),
                      color:repairOpts.humFrequency===f?"#f59e0b":"#4a8a9a"}}>
                    {f}Hz
                  </div>
                ))}
              </div>}
            </div>
            {/* Action buttons */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:repairResult?12:0}}>
              <button onClick={doRepair} disabled={repairing||(!repairOpts.humRemoval&&!repairOpts.loudnessNormalize&&!repairOpts.trimSilence)}
                style={{display:"flex",alignItems:"center",gap:6,
                  background:repairing?"#0f2a3a":"#10b98122",border:"1px solid #10b98144",
                  borderRadius:6,padding:"6px 14px",cursor:"pointer",color:"#10b981",fontSize:10,fontWeight:700}}>
                <Wrench size={11}/>{repairing?"Repairing...":"Run Repair"}
              </button>
              {repairResult?.changed&&<button onClick={doExport}
                style={{display:"flex",alignItems:"center",gap:6,
                  background:"#22d3ee22",border:"1px solid #22d3ee44",
                  borderRadius:6,padding:"6px 14px",cursor:"pointer",color:"#22d3ee",fontSize:10,fontWeight:700}}>
                <Download size={11}/>Export WAV
              </button>}
            </div>
            {/* Results */}
            {repairResult&&<div style={{borderTop:"1px solid #0f2a3a",paddingTop:10}}>
              {repairResult.operations.length>0&&<div style={{marginBottom:6}}>
                <div style={{fontSize:9,color:"#4a8a9a",marginBottom:4}}>OPERATIONS APPLIED</div>
                {repairResult.operations.map((op,i)=>(
                  <div key={i} style={{fontSize:10,color:"#10b981",marginBottom:2}}>✓ {op}</div>
                ))}
              </div>}
              {repairResult.warnings.length>0&&<div>
                <div style={{fontSize:9,color:"#4a8a9a",marginBottom:4}}>WARNINGS</div>
                {repairResult.warnings.map((w,i)=>(
                  <div key={i} style={{fontSize:10,color:"#f59e0b",marginBottom:2}}>⚠ {w}</div>
                ))}
              </div>}
              {!repairResult.changed&&<div style={{fontSize:10,color:"#4a8a9a"}}>No changes were needed.</div>}
            </div>}
          </div>

          {/* Weighted checks */}
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            <div style={{fontSize:9,color:"#4a8a9a",marginBottom:2}}>WEIGHTED CHECKS</div>
            {rep.checks.filter(c=>!c.bonus).map(c=><Row key={c.label||c.id} c={c}/>)}
            <div style={{fontSize:9,color:"#4a8a9a",marginTop:6,marginBottom:2}}>ADVANCED</div>
            {rep.checks.filter(c=>c.bonus).map(c=><Row key={c.label||c.id} c={c}/>)}
            <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:8,padding:10,marginTop:4}}>
              <div style={{fontSize:9,color:"#4a8a9a",marginBottom:6}}>SILENCE EDGES</div>
              {[["Leading",rep.edges.leadMs+"ms"],["Trailing",rep.edges.trailMs+"ms"],["Ratio",(rep.edges.silRatio*100).toFixed(1)+"%"]].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:10,color:"#4a8a9a"}}>{l}</span><span style={{fontSize:10,color:"#cbd5e1",fontWeight:700}}>{v}</span></div>
              ))}
            </div>
          </div>
        </>}
      </div>
    </div>
  </div>;
}

// AIVORA_DSP_ENGINE_V4
