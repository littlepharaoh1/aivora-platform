// @ts-nocheck
/**
 * StorePanel.tsx — Aivora File Manager
 * Central file registry with DSP metadata + quick actions
 */
import React, { useState, useCallback } from "react";
import { useAivora } from "../lib/store/AivoraContext";
import { runUnifiedPipeline, PIPELINE_PRESETS } from "../lib/dsp/aivoraDSPController";

export default function StorePanel() {
  const { records, stats, storageInfo, isHydrating, addFile, removeRecord, clearAll } = useAivora();
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<string|null>(null);
  const [filter,     setFilter]     = useState("all");
  const [sortBy,     setSortBy]     = useState<"name"|"date"|"size">("date");
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleUpload(files: FileList) {
    const wavs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".wav"));
    for(const file of wavs) {
      await addFile?.(file);
    }
  }

  async function quickProcess(record: any, target: string) {
    setProcessing(record.id);
    // Open file picker for this record
    const input = document.createElement("input");
    input.type="file"; input.accept=".wav";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if(!file) { setProcessing(null); return; }
      try {
        const ab  = await file.arrayBuffer();
        const ctx = new AudioContext();
        const buf = await ctx.decodeAudioData(ab);
        const result = await runUnifiedPipeline(buf,
          { target: target as any },
          (pct, stage) => {} 
        );
        const wav = encodeWav(result.output, result.sampleRate);
        const a   = document.createElement("a");
        a.href    = URL.createObjectURL(wav);
        a.download= `${file.name.replace(".wav","")}_${target}_processed.wav`;
        a.click();
        await ctx.close();
      } catch(err: any) {
        alert(`Processing failed: ${err.message}`);
      }
      setProcessing(null);
    };
    input.click();
  }

  function encodeWav(data: Float32Array, sr: number): Blob {
    const ab=new ArrayBuffer(44+data.length*4);
    const v=new DataView(ab);
    const s=(o:number,str:string)=>{for(let i=0;i<str.length;i++)v.setUint8(o+i,str.charCodeAt(i));};
    s(0,"RIFF");v.setUint32(4,36+data.length*4,true);s(8,"WAVE");s(12,"fmt ");
    v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*4,true);
    v.setUint16(32,4,true);v.setUint16(34,32,true);s(36,"data");
    v.setUint32(40,data.length*4,true);
    let offset=44;
    for(let i=0;i<data.length;i++){v.setFloat32(offset,data[i],true);offset+=4;}
    return new Blob([ab],{type:"audio/wav"});
  }

  const filteredRecords = (records??[]).filter((r:any) =>
    filter==="all" ? true : r.type===filter
  ).sort((a:any,b:any) => {
    if(sortBy==="name") return a.name.localeCompare(b.name);
    if(sortBy==="size") return (b.size??0)-(a.size??0);
    return new Date(b.createdAt??0).getTime()-new Date(a.createdAt??0).getTime();
  });

  return (
    <div style={{height:"100%",overflow:"auto",background:"#020608",
      fontFamily:"'JetBrains Mono',monospace",color:"#a0c4cc",padding:16}}>

      <div style={{marginBottom:16}}>
        <div style={{fontSize:9,color:"#2a6a8a",letterSpacing:3,marginBottom:4}}>
          FILE MANAGER
        </div>
        <div style={{fontSize:18,fontWeight:700,color:"#E2EEF6"}}>
          Aivora File Store
        </div>
        <div style={{fontSize:10,color:"#4a6a7a",marginTop:2}}>
          Central file registry · Quick DSP actions · Batch management
        </div>
      </div>

      {/* Stats */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {l:"Files",   v:records?.length??0,                    c:"#0EA5E9"},
          {l:"Storage", v:`${((storageInfo?.used??0)/1024/1024).toFixed(1)}MB`, c:"#8B5CF6"},
          {l:"Selected",v:selected.size,                          c:"#F59E0B"},
        ].map(({l,v,c})=>(
          <div key={l} style={{background:"#050d18",border:`1px solid ${c}30`,
            borderTop:`2px solid ${c}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:20,fontWeight:700,color:c}}>{v}</div>
            <div style={{fontSize:8,color:"#4a6a7a",letterSpacing:1}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <label style={{fontSize:10,padding:"6px 14px",borderRadius:6,
          background:"#0EA5E920",border:"1px solid #0EA5E940",
          color:"#0EA5E9",cursor:"pointer"}}>
          + Upload WAV
          <input ref={fileRef} type="file" accept=".wav" multiple
            style={{display:"none"}}
            onChange={e=>e.target.files&&handleUpload(e.target.files)}/>
        </label>
        {selected.size>0&&(
          <button onClick={()=>{
            selected.forEach(id=>removeRecord?.(id));
            setSelected(new Set());
          }} style={{fontSize:10,padding:"6px 14px",borderRadius:6,
            background:"#EF444420",border:"1px solid #EF444440",
            color:"#EF4444",cursor:"pointer",fontFamily:"inherit"}}>
            Delete Selected ({selected.size})
          </button>
        )}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          {["name","date","size"].map(s=>(
            <div key={s} onClick={()=>setSortBy(s as any)}
              style={{fontSize:9,padding:"4px 8px",borderRadius:4,cursor:"pointer",
                background:sortBy===s?"#0EA5E922":"transparent",
                color:sortBy===s?"#0EA5E9":"#2a5a6a",
                border:`1px solid ${sortBy===s?"#0EA5E9":"#1a3a5a"}`}}>
              {s}
            </div>
          ))}
        </div>
      </div>

      {/* Files */}
      {isHydrating ? (
        <div style={{textAlign:"center",padding:20,fontSize:10,color:"#2a5a6a"}}>Loading...</div>
      ) : filteredRecords.length===0 ? (
        <div style={{textAlign:"center",padding:40,fontSize:10,color:"#2a5a6a",
          border:"1px solid #0a1520",borderRadius:8}}>
          No files yet. Upload WAV files to get started.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filteredRecords.map((r:any)=>(
            <div key={r.id} style={{background:"#050d18",
              border:`1px solid ${selected.has(r.id)?"#0EA5E9":"#0f2030"}`,
              borderRadius:8,padding:"10px 14px",
              display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <input type="checkbox" checked={selected.has(r.id)}
                onChange={e=>{
                  setSelected(prev=>{
                    const n=new Set(prev);
                    e.target.checked?n.add(r.id):n.delete(r.id);
                    return n;
                  });
                }}/>
              <div style={{flex:1,minWidth:120}}>
                <div style={{fontSize:11,fontWeight:700,color:"#E2EEF6",
                  marginBottom:2,wordBreak:"break-all"}}>{r.name}</div>
                <div style={{fontSize:8,color:"#2a5a6a"}}>
                  {r.size?(r.size/1024).toFixed(1)+"KB ·":""} {r.createdAt?new Date(r.createdAt).toLocaleString():""}
                </div>
              </div>

              {/* Quick Actions */}
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[
                  {label:"TTS",      target:"tts_training", color:"#F59E0B"},
                  {label:"ASR",      target:"asr_training", color:"#10B981"},
                  {label:"Podcast",  target:"podcast",      color:"#8B5CF6"},
                  {label:"Broadcast",target:"broadcast",    color:"#0EA5E9"},
                ].map(({label,target,color})=>(
                  <button key={target}
                    onClick={()=>quickProcess(r,target)}
                    disabled={processing===r.id}
                    style={{fontSize:8,padding:"3px 8px",borderRadius:4,
                      background:`${color}15`,border:`1px solid ${color}30`,
                      color,cursor:"pointer",fontFamily:"inherit",
                      opacity:processing===r.id?0.5:1}}>
                    {processing===r.id?"⟳":label}
                  </button>
                ))}
                <button onClick={()=>removeRecord?.(r.id)}
                  style={{fontSize:8,padding:"3px 8px",borderRadius:4,
                    background:"#EF444415",border:"1px solid #EF444430",
                    color:"#EF4444",cursor:"pointer",fontFamily:"inherit"}}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {records?.length>0&&(
        <div style={{marginTop:12,textAlign:"right"}}>
          <button onClick={clearAll}
            style={{fontSize:9,padding:"4px 10px",borderRadius:4,
              background:"transparent",border:"1px solid #EF444430",
              color:"#EF4444",cursor:"pointer",fontFamily:"inherit"}}>
            Clear All Files
          </button>
        </div>
      )}
    </div>
  );
}
