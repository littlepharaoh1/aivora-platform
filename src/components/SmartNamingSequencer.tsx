// @ts-nocheck
/**
 * SmartNamingSequencer.tsx — German Wake Word Smart Naming Sequencer
 * Aivora Platform
 */
import React, { useState, useRef, useCallback } from "react";
import {
  generateSequence, validateBatch, SEQUENCE_RULES,
  LANGUAGE_PRESETS, getSuffixForIndex,
} from "../lib/naming/germanSequencer";
import { buildZip, downloadZip } from "../lib/naming/zipExporter";
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, FileText } from "lucide-react";

const SUFFIX_COLORS = {
  "dkws_slow":         "#22d3ee",
  "dkws_normal":       "#10b981",
  "dkws_fast":         "#f59e0b",
  "oneshot200_normal": "#8b5cf6",
  "query_normal":      "#f97316",
};

export default function SmartNamingSequencer() {
  const [files,       setFiles]       = useState<File[]>([]);
  const [speakerId,   setSpeakerId]   = useState("D1065");
  const [startIndex,  setStartIndex]  = useState(1);
  const [locale,      setLocale]      = useState("DE-DE");
  const [results,     setResults]     = useState([]);
  const [validation,  setValidation]  = useState(null);
  const [exporting,   setExporting]   = useState(false);
  const [exported,    setExported]    = useState(false);
  const inputRef = useRef(null);

  function handleFiles(incoming: FileList | null) {
    if (!incoming) return;
    const wavs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith(".wav"));
    setFiles(wavs);
    setExported(false);

    const val = validateBatch(wavs, startIndex);
    setValidation(val);

    const res = generateSequence(wavs, { speakerId, startIndex, locale });
    setResults(res);
  }

  function regenerate() {
    if (files.length === 0) return;
    const val = validateBatch(files, startIndex);
    setValidation(val);
    const res = generateSequence(files, { speakerId, startIndex, locale });
    setResults(res);
    setExported(false);
  }

  async function handleExport() {
    const valid = results.filter(r => r.valid);
    if (valid.length === 0) return;
    setExporting(true);
    try {
      const zipFiles = await Promise.all(
        valid.map(async (r, i) => ({
          name: r.renamed,
          data: await files[results.indexOf(r)].arrayBuffer(),
        }))
      );
      const blob = await buildZip(zipFiles);
      downloadZip(blob, `${locale}_${speakerId}_S${String(startIndex).padStart(4,"0")}_batch.zip`);
      setExported(true);
    } catch(e) { console.error(e); }
    setExporting(false);
  }

  const validCount   = results.filter(r => r.valid).length;
  const invalidCount = results.filter(r => !r.valid).length;
  const isReady      = validation?.ok && validCount > 0 && invalidCount === 0;

  return (
    <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#060e18,#071a18)",
        borderBottom:"1px solid #0f2a3a",padding:"14px 18px",
        display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:36,height:36,borderRadius:10,background:"#22d3ee22",
          border:"1px solid #22d3ee44",display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:18}}>🎙</div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>
            SMART NAMING SEQUENCER
          </div>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>
            GERMAN WAKE WORD · APPEN OFFICIAL SEQUENCE LOGIC
          </div>
        </div>
        {isReady && <div style={{marginLeft:"auto",padding:"4px 14px",borderRadius:20,
          background:"#10b98122",border:"1px solid #10b98144",
          color:"#10b981",fontSize:10,fontWeight:700,letterSpacing:2}}>
          ✓ APPEN READY
        </div>}
      </div>

      <div style={{padding:16,display:"flex",flexDirection:"column",gap:12}}>

        {/* Config */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,padding:14}}>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1,marginBottom:10}}>CONFIGURATION</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>

            {/* Locale */}
            <div>
              <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4}}>LOCALE</div>
              <select value={locale} onChange={e=>setLocale(e.target.value)}
                style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                  padding:"6px 10px",color:"#a0c4cc",fontSize:11,fontFamily:"monospace"}}>
                {LANGUAGE_PRESETS.map(p=>(
                  <option key={p.locale} value={p.locale}>{p.locale} — {p.language}</option>
                ))}
              </select>
            </div>

            {/* Speaker ID */}
            <div>
              <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4}}>SPEAKER ID</div>
              <input value={speakerId}
                onChange={e=>setSpeakerId(e.target.value.toUpperCase())}
                style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                  padding:"6px 10px",color:"#22d3ee",fontSize:11,fontFamily:"monospace",width:90}}
                placeholder="D1065"/>
            </div>

            {/* Start Index */}
            <div>
              <div style={{fontSize:8,color:"#4a8a9a",marginBottom:4}}>START SEQUENCE</div>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"#4a8a9a"}}>S</span>
                <input type="number" min={1} max={200} value={startIndex}
                  onChange={e=>setStartIndex(Math.max(1,Math.min(200,parseInt(e.target.value)||1)))}
                  style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                    padding:"6px 10px",color:"#22d3ee",fontSize:11,fontFamily:"monospace",width:70}}/>
              </div>
            </div>

            {/* Upload */}
            <label style={{display:"flex",alignItems:"center",gap:6,
              background:"#22d3ee22",border:"2px dashed #22d3ee44",
              borderRadius:8,padding:"8px 16px",cursor:"pointer",
              color:"#22d3ee",fontSize:10,fontWeight:700}}>
              <Upload size={13}/>
              {files.length>0?`${files.length} files loaded`:"Upload WAV Files"}
              <input ref={inputRef} type="file" accept=".wav" multiple hidden
                onChange={e=>handleFiles(e.target.files)}/>
            </label>

            {files.length>0&&<button onClick={regenerate}
              style={{background:"#0f2a3a",border:"1px solid #1e3a5f",borderRadius:8,
                padding:"8px 14px",cursor:"pointer",color:"#94a3b8",fontSize:10,fontWeight:700}}>
              ↺ Regenerate
            </button>}
          </div>
        </div>

        {/* Sequence Map */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,padding:14}}>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1,marginBottom:10}}>
            OFFICIAL SEQUENCE MAP
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {SEQUENCE_RULES.map((r,i)=>(
              <div key={i} style={{background:"#050d14",border:"1px solid #0f2a3a",
                borderRadius:6,padding:"4px 10px",fontSize:9}}>
                <span style={{color:"#4a8a9a"}}>S{String(r.from).padStart(4,"0")}–S{String(r.to).padStart(4,"0")}</span>
                <span style={{color:SUFFIX_COLORS[r.suffix]||"#a0c4cc",marginLeft:6,fontWeight:700}}>
                  {r.suffix}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Validation */}
        {validation&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:12,padding:14}}>
          <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1,marginBottom:8}}>VALIDATION</div>
          {validation.errors.map((e,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"center"}}>
              <XCircle size={12} color="#ef4444"/>
              <span style={{fontSize:10,color:"#ef4444"}}>{e}</span>
            </div>
          ))}
          {validation.warnings.map((w,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:4,alignItems:"center"}}>
              <AlertTriangle size={12} color="#f59e0b"/>
              <span style={{fontSize:10,color:"#f59e0b"}}>{w}</span>
            </div>
          ))}
          {validation.ok&&validation.warnings.length===0&&(
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <CheckCircle2 size={12} color="#10b981"/>
              <span style={{fontSize:10,color:"#10b981"}}>All {files.length} files validated successfully</span>
            </div>
          )}
        </div>}

        {/* Stats + Export */}
        {results.length>0&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {[
            ["Total",   files.length,  "#a0c4cc"],
            ["Valid",   validCount,    "#10b981"],
            ["Invalid", invalidCount,  "#ef4444"],
          ].map(([l,v,c])=>(
            <div key={l} style={{background:"#060e16",border:"1px solid #0f2a3a",
              borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
              <div style={{fontSize:18,fontWeight:900,color:c,fontFamily:"monospace"}}>{v}</div>
              <div style={{fontSize:9,color:"#4a8a9a",marginTop:2}}>{l}</div>
            </div>
          ))}
          <button onClick={handleExport} disabled={exporting||!isReady}
            style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto",
              background:isReady?"#10b98122":"#0f2a3a",
              border:"1px solid "+(isReady?"#10b98144":"#1e3a5f"),
              borderRadius:8,padding:"10px 20px",cursor:isReady?"pointer":"not-allowed",
              color:isReady?"#10b981":"#4a8a9a",fontSize:11,fontWeight:700}}>
            <Download size={13}/>{exporting?"Building ZIP...":exported?"✓ Downloaded!":"Export ZIP"}
          </button>
        </div>}

        {/* Preview Table */}
        {results.length>0&&<div style={{background:"#060e16",border:"1px solid #0f2a3a",
          borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"grid",
            gridTemplateColumns:"30px 1fr 1fr 100px 80px",
            padding:"8px 12px",borderBottom:"1px solid #0f2a3a",background:"#050d14"}}>
            {["#","ORIGINAL","RENAMED","SUFFIX","STATUS"].map(h=>(
              <div key={h} style={{fontSize:8,color:"#4a8a9a"}}>{h}</div>
            ))}
          </div>
          <div style={{maxHeight:400,overflowY:"auto"}}>
            {results.map((r,i)=>(
              <div key={i} style={{display:"grid",
                gridTemplateColumns:"30px 1fr 1fr 100px 80px",
                padding:"7px 12px",borderBottom:"1px solid #0a1a24",
                background:i%2===0?"#060e16":"#050d14",alignItems:"center"}}>
                <div style={{fontSize:9,color:"#4a8a9a"}}>{i+1}</div>
                <div style={{fontSize:9,color:"#4a8a9a",overflow:"hidden",
                  textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}
                  title={r.original}>{r.original}</div>
                <div style={{fontSize:9,color:r.valid?"#10b981":"#ef4444",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}
                  title={r.renamed||r.error}>{r.renamed||r.error}</div>
                <div style={{fontSize:9,
                  color:SUFFIX_COLORS[r.suffix]||"#4a8a9a",fontWeight:700}}>
                  {r.suffix||"—"}
                </div>
                <div style={{fontSize:9}}>
                  {r.valid
                    ? <span style={{color:"#10b981"}}>✓ Valid</span>
                    : <span style={{color:"#ef4444"}}>✗ Error</span>}
                </div>
              </div>
            ))}
          </div>
        </div>}

        {/* Empty state */}
        {files.length===0&&<div style={{display:"flex",flexDirection:"column",
          alignItems:"center",justifyContent:"center",gap:16,padding:60,opacity:0.4}}>
          <div style={{fontSize:40}}>🎙</div>
          <div style={{fontSize:13,color:"#2a5a6a",textAlign:"center"}}>
            Upload WAV files to auto-generate Appen-ready names
          </div>
        </div>}

      </div>
    </div>
  );
}
