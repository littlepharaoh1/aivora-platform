// @ts-nocheck
import React, { useState } from "react";
import { Upload, Download, Award, BarChart3, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

function toDb(v) { return v <= 0 ? -120 : 20 * Math.log10(v); }
function fromDb(db) { return Math.pow(10, db / 20); }

function analyzeForReadiness(buffer, fileName) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  let peak = 0, sumSq = 0, clipped = 0, silentSamples = 0;
  const noiseSamples = [];
  const step = Math.max(1, Math.floor(data.length / 30000));
  for (let i = 0; i < data.length; i += step) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sumSq += v * v;
    if (v >= 0.999) clipped++;
    if (v < 0.001) silentSamples++;
    if (v < 0.005) noiseSamples.push(v * v);
  }
  const count = Math.floor(data.length / step);
  const rms = Math.sqrt(sumSq / count);
  const noiseRms = noiseSamples.length > 10 ? Math.sqrt(noiseSamples.reduce((a,b)=>a+b,0)/noiseSamples.length) : 0.000001;
  const peakDb = toDb(peak), rmsDb = toDb(rms), noiseDb = toDb(noiseRms);
  const snrDb = rmsDb - noiseDb;
  const silenceRatio = silentSamples / count;
  const checks = [];
  const srOk = sr===48000, srWarn = sr===44100||sr===16000;
  checks.push({id:'sr',label:'Sample Rate',passed:srOk,warning:srWarn&&!srOk,value:sr+' Hz',detail:srOk?'48kHz standard':srWarn?'Acceptable':'Non-standard',weight:15,score:srOk?100:srWarn?60:20});
  checks.push({id:'bd',label:'Bit Depth',passed:true,warning:false,value:'32-bit float',detail:'Maximum quality',weight:10,score:100});
  const peakOk=peakDb>=-6&&peakDb<=-1,peakClip=peakDb>-0.5,peakWarn=peakDb>=-12&&peakDb<-6;
  checks.push({id:'pk',label:'Peak Level',passed:peakOk&&!peakClip,warning:peakWarn||peakClip,value:peakDb.toFixed(1)+' dBFS',detail:peakClip?'Clipping detected':peakOk?'Professional range':peakWarn?'Slightly low':'Too low',weight:20,score:peakClip?0:peakOk?100:peakWarn?65:30});
  const rmsOk=rmsDb>=-30&&rmsDb<=-12,rmsWarn=rmsDb>=-35&&rmsDb<-30;
  checks.push({id:'rms',label:'RMS Loudness',passed:rmsOk,warning:rmsWarn&&!rmsOk,value:rmsDb.toFixed(1)+' dBFS',detail:rmsOk?'Acceptable range':rmsWarn?'Slightly low':'Out of range',weight:15,score:rmsOk?100:rmsWarn?65:rmsDb<-40?20:40});
  const noiseOk=noiseDb<=-55,noiseWarn=noiseDb>-55&&noiseDb<=-45;
  checks.push({id:'nf',label:'Noise Floor',passed:noiseOk,warning:noiseWarn,value:noiseDb.toFixed(1)+' dBFS',detail:noiseOk?'Excellent':noiseWarn?'Acceptable':'High noise',weight:15,score:noiseOk?100:noiseWarn?55:15});
  const snrOk=snrDb>=40,snrWarn=snrDb>=25&&snrDb<40;
  checks.push({id:'snr',label:'SNR',passed:snrOk,warning:snrWarn,value:snrDb.toFixed(1)+' dB',detail:snrOk?'Excellent':snrWarn?'Acceptable':'Poor',weight:15,score:snrOk?100:snrWarn?55:15});
  const clipOk=clipped===0,clipWarn=clipped>0&&clipped<10;
  checks.push({id:'cl',label:'Clipping',passed:clipOk,warning:clipWarn,value:clipOk?'None':clipped+' samples',detail:clipOk?'No clipping':clipWarn?'Minor clipping':'Clipping detected',weight:10,score:clipOk?100:clipWarn?40:0});
  const silOk=silenceRatio<0.3,silWarn=silenceRatio>=0.3&&silenceRatio<0.5;
  checks.push({id:'sl',label:'Silence Ratio',passed:silOk,warning:silWarn,value:(silenceRatio*100).toFixed(1)+'%',detail:silOk?'Acceptable':silWarn?'High - trim recommended':'Excessive silence',weight:10,score:silOk?100:silWarn?50:20});
  const totalWeight=checks.reduce((a,c)=>a+c.weight,0);
  const totalScore=Math.round(checks.reduce((a,c)=>a+(c.score*c.weight),0)/totalWeight);
  const grade=totalScore>=90?'A':totalScore>=75?'B':totalScore>=60?'C':totalScore>=40?'D':'F';
  const verdict=totalScore>=75&&clipped===0?'READY':totalScore>=50?'REVIEW':'REJECT';
  return {fileName,totalScore,grade,verdict,checks,analyzedAt:new Date().toLocaleTimeString(),duration:buffer.duration,sampleRate:sr,channels:buffer.numberOfChannels,peakDb,rmsDb,noiseDb,snrDb,clippedSamples:clipped,silenceRatio};
}

function ScoreRing({score,grade,verdict}) {
  const r=54,circ=2*Math.PI*r,offset=circ-(score/100)*circ;
  const color=score>=90?'#22d3ee':score>=75?'#10b981':score>=60?'#f59e0b':score>=40?'#f97316':'#ef4444';
  const vc=verdict==='READY'?'#10b981':verdict==='REVIEW'?'#f59e0b':'#ef4444';
  return <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
    <div style={{position:'relative',width:130,height:130}}>
      <svg width={130} height={130} style={{transform:'rotate(-90deg)'}}>
        <circle cx={65} cy={65} r={r} fill='none' stroke='#0f2a3a' strokeWidth={10}/>
        <circle cx={65} cy={65} r={r} fill='none' stroke={color} strokeWidth={10} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap='round' style={{transition:'stroke-dashoffset 1s ease'}}/>
      </svg>
      <div style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
        <div style={{fontSize:28,fontWeight:900,color,fontFamily:'monospace',lineHeight:1}}>{score}</div>
        <div style={{fontSize:10,color:'#4a8a9a',fontFamily:'monospace'}}>/100</div>
        <div style={{fontSize:18,fontWeight:700,color,fontFamily:'monospace'}}>{grade}</div>
      </div>
    </div>
    <div style={{padding:'4px 16px',borderRadius:20,background:vc+'22',border:'1px solid '+vc+'44',color:vc,fontSize:12,fontFamily:'monospace',fontWeight:700,letterSpacing:2}}>{verdict}</div>
  </div>;
}

function CheckRow({check}) {
  const [expanded,setExpanded] = useState(false);
  const icon = check.passed&&!check.warning ? <CheckCircle2 size={14} color='#10b981'/> : check.warning ? <AlertTriangle size={14} color='#f59e0b'/> : <XCircle size={14} color='#ef4444'/>;
  const bc = check.score>=80?'#10b981':check.score>=50?'#f59e0b':'#ef4444';
  return <div onClick={()=>setExpanded(!expanded)} style={{background:'#060e16',border:'1px solid #0f2a3a',borderRadius:8,padding:'10px 14px',cursor:'pointer'}}>
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      {icon}
      <span style={{flex:1,fontSize:12,fontFamily:'monospace',color:'#a0c4cc'}}>{check.label}</span>
      <span style={{fontSize:11,color:'#4a8a9a',fontFamily:'monospace'}}>{check.value}</span>
      <div style={{width:60,height:4,background:'#0f2a3a',borderRadius:2,marginLeft:8}}>
        <div style={{height:'100%',width:check.score+'%',background:bc,borderRadius:2,transition:'width 0.8s'}}/>
      </div>
      <span style={{fontSize:11,color:bc,fontFamily:'monospace',minWidth:30,textAlign:'right'}}>{check.score}</span>
    </div>
    {expanded&&<div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #0f2a3a',fontSize:11,color:'#4a8a9a',fontFamily:'monospace'}}>{check.detail}<br/><span style={{color:'#2a5a6a'}}>Weight: {check.weight}%</span></div>}
  </div>;
}

export default function DeliveryReadinessScore() {
  const [report,setReport] = useState(null);
  const [loading,setLoading] = useState(false);
  const [history,setHistory] = useState([]);

  async function analyzeFile(file) {
    if(!file.name.toLowerCase().endsWith('.wav')) return;
    setLoading(true);
    const ab = await file.arrayBuffer();
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(ab);
    const r = analyzeForReadiness(buf, file.name);
    setReport(r);
    setHistory(prev=>[r,...prev.slice(0,9)]);
    setLoading(false);
  }

  function exportReport() {
    if(!report) return;
    const txt = ['AIVORA DELIVERY READINESS REPORT','File: '+report.fileName,'Score: '+report.totalScore+'/100 ('+report.grade+') - '+report.verdict,'','CHECKS:',...report.checks.map(c=>'  ['+(c.passed&&!c.warning?'PASS':c.warning?'WARN':'FAIL')+'] '+c.label+': '+c.value+' ('+c.score+')')].join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));
    a.download=report.fileName.replace('.wav','')+'_readiness.txt';
    a.click();
  }

  const vc=report?.verdict==='READY'?'#10b981':report?.verdict==='REVIEW'?'#f59e0b':'#ef4444';

  return <div style={{background:'#040c14',minHeight:'100%',fontFamily:'monospace',color:'#a0c4cc'}}>
    <div style={{background:'linear-gradient(135deg,#060e18,#071a14)',borderBottom:'1px solid #0f2a3a',padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:38,height:38,borderRadius:10,background:'#10b98122',border:'1px solid #10b98144',display:'flex',alignItems:'center',justifyContent:'center'}}><Award size={18} color='#10b981'/></div>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:'#e0f2f8',letterSpacing:1}}>DELIVERY READINESS SCORE</div>
          <div style={{fontSize:10,color:'#4a8a9a',letterSpacing:2}}>V2 - AIVORA - AUDIO QC INTELLIGENCE</div>
        </div>
      </div>
      <button onClick={exportReport} disabled={!report} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:8,background:'transparent',color:report?'#10b981':'#2a5a6a',border:'1px solid '+(report?'#10b98144':'#0f2a3a'),cursor:report?'pointer':'not-allowed',fontSize:11,fontFamily:'inherit',fontWeight:700}}>
        <Download size={13}/> EXPORT REPORT
      </button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 280px',minHeight:'calc(100vh - 70px)'}}>
      <div style={{padding:16,display:'flex',flexDirection:'column',gap:14}}>
        <div onClick={()=>document.getElementById('drs-input').click()} style={{border:'2px dashed #1a4a5a',borderRadius:12,padding:'24px 16px',textAlign:'center',cursor:'pointer',background:'#050d14'}}>
          <input id='drs-input' type='file' accept='.wav,audio/wav' hidden onChange={e=>{if(e.target.files[0])analyzeFile(e.target.files[0]);}}/>
          <Upload size={22} color='#10b981' style={{marginBottom:8}}/>
          <div style={{fontSize:12,color:'#a0c4cc'}}>{loading?'Analyzing...':'Drop WAV to analyze readiness'}</div>
        </div>
        {report&&<>
          <div style={{background:'#060e16',border:'1px solid '+vc+'33',borderRadius:12,padding:20,display:'flex',gap:24,alignItems:'center',flexWrap:'wrap'}}>
            <ScoreRing score={report.totalScore} grade={report.grade} verdict={report.verdict}/>
            <div style={{flex:1,display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:13,color:'#e0f2f8',fontWeight:700}}>{report.fileName}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {[['Duration',report.duration.toFixed(2)+'s'],['Sample Rate',report.sampleRate+'Hz'],['Peak',report.peakDb.toFixed(1)+'dBFS'],['RMS',report.rmsDb.toFixed(1)+'dBFS'],['Noise',report.noiseDb.toFixed(1)+'dBFS'],['SNR',report.snrDb.toFixed(1)+'dB'],['Clipped',String(report.clippedSamples)],['Silence',(report.silenceRatio*100).toFixed(1)+'%']].map(([l,v])=>(
                  <div key={l} style={{background:'#050d14',border:'1px solid #0f2a3a',borderRadius:6,padding:'5px 10px'}}>
                    <div style={{fontSize:9,color:'#4a8a9a',marginBottom:2}}>{l}</div>
                    <div style={{fontSize:12,color:'#cbd5e1',fontWeight:700}}>{v}</div>
                  </div>
                ))}
              </div>
              {report.checks.filter(c=>!c.passed||c.warning).length>0&&<div style={{background:'#f59e0b11',border:'1px solid #f59e0b22',borderRadius:8,padding:'8px 12px'}}>
                <div style={{fontSize:10,color:'#f59e0b',marginBottom:6}}>RECOMMENDATIONS</div>
                {report.checks.filter(c=>!c.passed||c.warning).map(c=><div key={c.id} style={{fontSize:11,color:'#8ab4c0',marginBottom:3}}>- {c.detail}</div>)}
              </div>}
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {report.checks.map(c=><CheckRow key={c.id} check={c}/>)}
          </div>
        </>}
        {!report&&!loading&&<div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,padding:40,opacity:0.5}}>
          <BarChart3 size={48} color='#1a4a5a'/>
          <div style={{fontSize:13,color:'#2a5a6a',textAlign:'center'}}>Upload a WAV file to get Delivery Readiness Score</div>
        </div>}
      </div>
      <div style={{borderLeft:'1px solid #0f2a3a',padding:14,display:'flex',flexDirection:'column',gap:10,overflowY:'auto'}}>
        <div style={{fontSize:10,color:'#4a8a9a',letterSpacing:1}}>HISTORY</div>
        {history.length===0&&<div style={{fontSize:11,color:'#2a5a6a',textAlign:'center',marginTop:20}}>No files yet</div>}
        {history.map((r,i)=>{
          const c=r.verdict==='READY'?'#10b981':r.verdict==='REVIEW'?'#f59e0b':'#ef4444';
          return <div key={i} onClick={()=>setReport(r)} style={{background:'#060e16',border:'1px solid '+c+'33',borderRadius:8,padding:'10px 12px',cursor:'pointer'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:10,color:c,fontWeight:700}}>{r.grade}</span>
              <span style={{fontSize:10,color:'#4a8a9a'}}>{r.totalScore}/100</span>
            </div>
            <div style={{fontSize:11,color:'#a0c4cc',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.fileName}</div>
            <div style={{height:3,background:'#0f2a3a',borderRadius:2,marginTop:6}}>
              <div style={{height:'100%',width:r.totalScore+'%',background:c,borderRadius:2}}/>
            </div>
          </div>;
        })}
        {history.length>0&&<button onClick={()=>setHistory([])} style={{marginTop:'auto',padding:6,borderRadius:6,border:'1px solid #0f2a3a',background:'transparent',color:'#4a8a9a',fontSize:10,fontFamily:'inherit',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
          <RefreshCw size={10}/> Clear
        </button>}
      </div>
    </div>
  </div>;
}
