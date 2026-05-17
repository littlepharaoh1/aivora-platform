// @ts-nocheck
/**
 * DeliveryReadiness.tsx — Professional Delivery QA Gate
 * Connected to real exportValidator + DSP metrics
 */
import React, { useState, useCallback } from "react";
import { validateExport } from "../lib/audioEditor/exportValidator";
import { supabase } from "../lib/supabase";

interface FileResult {
  name:     string;
  status:   "pass"|"fail"|"warn";
  score:    number;
  lufs:     number;
  snrDb:    number;
  truePeak: number;
  failures: string[];
  warnings: string[];
  duration: number;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score>=90?"#10B981":score>=75?"#0EA5E9":score>=55?"#F59E0B":"#EF4444";
  const grade = score>=90?"A":score>=75?"B":score>=55?"C":"F";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ width:32, height:32, borderRadius:6, background:`${color}20`,
        border:`1px solid ${color}40`, display:"flex", alignItems:"center",
        justifyContent:"center", fontSize:13, fontWeight:700, color }}>
        {grade}
      </div>
      <div style={{ fontSize:11, color }}>{score}/100</div>
    </div>
  );
}

export default function DeliveryReadiness() {
  const [results,  setResults]  = useState<FileResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [dragging, setDragging] = useState(false);
  const [summary,  setSummary]  = useState<{pass:number;fail:number;avg:number}|null>(null);

  async function processFiles(files: File[]) {
    setLoading(true);
    const newResults: FileResult[] = [];

    for(const file of files) {
      try {
        const ab  = await file.arrayBuffer();
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
        const mono = new Float32Array(buf.length);
        for(let ch=0;ch<buf.numberOfChannels;ch++){
          const d=buf.getChannelData(ch);
          for(let i=0;i<buf.length;i++) mono[i]+=d[i];
        }
        if(buf.numberOfChannels>1)
          for(let i=0;i<mono.length;i++) mono[i]/=buf.numberOfChannels;

        const validation = validateExport(mono, buf.sampleRate, {
          expectedSampleRate: 48000,
          maxTruePeakDb:     -1.0,
          minLufs:           -35,
          maxLufs:           -10,
          maxDurationDriftMs: 50,
          blockOnCritical:    true,
        });

        // Compute LUFS
        const blockLen=Math.floor(0.4*buf.sampleRate);
        const hop=Math.floor(0.1*buf.sampleRate);
        const blocks:number[]=[];
        for(let s=0;s+blockLen<=mono.length;s+=hop){
          let ms=0;
          for(let i=s;i<s+blockLen;i++) ms+=mono[i]**2;
          blocks.push(ms/blockLen);
        }
        const thresh=Math.pow(10,(-70-0.691)/10);
        const gated=blocks.filter(b=>b>thresh);
        const lufs=gated.length>0
          ? -0.691+10*Math.log10(gated.reduce((a,b)=>a+b)/gated.length)
          : -70;

        // SNR
        let sigE=0,noiseE=0,sigC=0,noiseC=0;
        for(let i=0;i<mono.length;i++){
          if(Math.abs(mono[i])>0.005){sigE+=mono[i]**2;sigC++;}
          else{noiseE+=mono[i]**2;noiseC++;}
        }
        const snrDb=noiseC>0&&sigC>0
          ? 10*Math.log10((sigE/sigC)/(noiseE/noiseC+1e-10)) : 40;

        // True peak
        let tp=0;
        for(let i=0;i<mono.length;i++) if(Math.abs(mono[i])>tp) tp=Math.abs(mono[i]);
        const tpDb=tp>0?20*Math.log10(tp):-120;

        const result: FileResult = {
          name:     file.name,
          status:   validation.exportBlocked?"fail":validation.failures.length>0?"warn":"pass",
          score:    validation.score,
          lufs:     Math.round(lufs*10)/10,
          snrDb:    Math.round(snrDb*10)/10,
          truePeak: Math.round(tpDb*10)/10,
          failures: validation.failures.map(f=>f.message),
          warnings: validation.warnings.map(w=>w.message),
          duration: buf.duration,
        };
        newResults.push(result);

        // Save to Supabase
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if(session) {
            await supabase.from("processing_jobs").insert([{
              user_id:  session.user.id,
              file_name: file.name,
              status:   result.status==="pass"?"done":"failed",
              score:    result.score,
              lufs:     result.lufs,
              snr_db:   result.snrDb,
              completed_at: new Date().toISOString(),
            }]);
          }
        } catch {}

        await ctx.close();
      } catch(e: any) {
        newResults.push({
          name:file.name, status:"fail", score:0,
          lufs:-70, snrDb:0, truePeak:-120,
          failures:[e.message??"Decode failed"], warnings:[], duration:0,
        });
      }
    }

    setResults(prev => [...newResults, ...prev]);
    const allR = [...newResults, ...results];
    setSummary({
      pass: allR.filter(r=>r.status==="pass").length,
      fail: allR.filter(r=>r.status==="fail").length,
      avg:  allR.length>0
        ? Math.round(allR.reduce((s,r)=>s+r.score,0)/allR.length) : 0,
    });
    setLoading(false);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files)
      .filter(f=>f.name.endsWith(".wav"));
    if(files.length) processFiles(files);
  }, [results]);

  const statusColor = (s:string) =>
    s==="pass"?"#10B981":s==="fail"?"#EF4444":"#F59E0B";

  return (
    <div style={{ height:"100%", overflow:"auto", background:"#020608",
      fontFamily:"'JetBrains Mono',monospace", color:"#a0c4cc", padding:16 }}>

      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:9, color:"#2a6a8a", letterSpacing:3, marginBottom:4 }}>
          DELIVERY READINESS
        </div>
        <div style={{ fontSize:18, fontWeight:700, color:"#E2EEF6" }}>
          QC Score & Compliance
        </div>
        <div style={{ fontSize:10, color:"#4a6a7a", marginTop:2 }}>
          ITU-R BS.1770-4 · True Peak · SNR · Seam · Export Safety Gate
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
          {[
            {l:"Passed",   v:summary.pass, c:"#10B981"},
            {l:"Failed",   v:summary.fail, c:"#EF4444"},
            {l:"Avg Score",v:`${summary.avg}/100`, c:"#F59E0B"},
            {l:"Total",    v:results.length, c:"#0EA5E9"},
          ].map(({l,v,c})=>(
            <div key={l} style={{ background:"#050d18", border:`1px solid ${c}30`,
              borderTop:`2px solid ${c}`, borderRadius:8, padding:"10px 14px" }}>
              <div style={{ fontSize:20, fontWeight:700, color:c }}>{v}</div>
              <div style={{ fontSize:8, color:"#4a6a7a", letterSpacing:1 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Drop Zone */}
      <div
        onDrop={onDrop}
        onDragOver={e=>{e.preventDefault();setDragging(true);}}
        onDragLeave={()=>setDragging(false)}
        style={{
          border:`2px dashed ${dragging?"#0EA5E9":"#1a3a5a"}`,
          borderRadius:10, padding:24, textAlign:"center",
          marginBottom:16, cursor:"pointer",
          background:dragging?"#0EA5E908":"transparent",
          transition:"all 0.2s",
        }}>
        <div style={{ fontSize:24, marginBottom:8 }}>🎯</div>
        <div style={{ fontSize:11, color:"#4a6a7a", marginBottom:6 }}>
          Drop WAV files here for QC validation
        </div>
        <label style={{ fontSize:10, padding:"6px 16px", borderRadius:6,
          background:"#0EA5E920", border:"1px solid #0EA5E940",
          color:"#0EA5E9", cursor:"pointer" }}>
          Browse Files
          <input type="file" accept=".wav" multiple style={{display:"none"}}
            onChange={e=>{
              const files=Array.from(e.target.files??[]);
              if(files.length) processFiles(files);
              e.target.value="";
            }}/>
        </label>
        {loading && (
          <div style={{ marginTop:8, fontSize:9, color:"#F59E0B" }}>
            ⟳ Validating...
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {results.map((r,i) => (
          <div key={i} style={{
            background:"#050d18", border:"1px solid #0f2030",
            borderLeft:`3px solid ${statusColor(r.status)}`,
            borderRadius:8, padding:"12px 14px",
          }}>
            <div style={{ display:"flex", alignItems:"flex-start",
              justifyContent:"space-between", gap:8, marginBottom:8 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#E2EEF6",
                  marginBottom:2 }}>{r.name}</div>
                <div style={{ fontSize:8, color:"#2a5a6a" }}>
                  {r.duration.toFixed(2)}s
                </div>
              </div>
              <ScoreBadge score={r.score}/>
            </div>

            {/* Metrics */}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
              {[
                {l:"LUFS",     v:`${r.lufs}`,      c:"#8B5CF6"},
                {l:"True Peak",v:`${r.truePeak}dBTP`, c:r.truePeak>-1?"#EF4444":"#10B981"},
                {l:"SNR",      v:`${r.snrDb}dB`,   c:r.snrDb>15?"#10B981":"#F59E0B"},
              ].map(({l,v,c})=>(
                <span key={l} style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
                  background:`${c}15`, color:c, border:`1px solid ${c}30` }}>
                  {l}: {v}
                </span>
              ))}
            </div>

            {/* Failures */}
            {r.failures.map((f,j)=>(
              <div key={j} style={{ fontSize:9, color:"#EF4444", marginBottom:2,
                padding:"2px 6px", background:"#EF444410", borderRadius:4 }}>
                ✗ {f.slice(0,80)}
              </div>
            ))}
            {r.warnings.map((w,j)=>(
              <div key={j} style={{ fontSize:9, color:"#F59E0B", marginBottom:2,
                padding:"2px 6px", background:"#F59E0B10", borderRadius:4 }}>
                ⚠ {w.slice(0,80)}
              </div>
            ))}
          </div>
        ))}
      </div>

      {results.length===0&&!loading&&(
        <div style={{ textAlign:"center", padding:40, color:"#2a5a6a", fontSize:10 }}>
          No files validated yet. Drop WAV files above.
        </div>
      )}
    </div>
  );
}
