/**
 * AIAssistPanel.tsx
 * Aivora Platform — AI Assist overlay for Image Annotation
 *
 * Sits ON TOP of the manual workstation. Runs auto-annotate, shows proposals
 * with confidence visualization, and lets the human approve/reject. Accepted
 * proposals are handed back via onAccept — they become real annotations through
 * the SAME addAnnotation path manual drawing uses. Never mutates state directly.
 */

import React, { useState } from "react";
import { useAIAnnotation } from "../lib/aiAnnotation/useAIAnnotation";
import {
  ASSIST_MODELS, ASSIST_MODEL_LABELS, CONFIDENCE_COLORS, confidenceBand,
} from "../lib/aiAnnotation/aiAnnotationTypes";
import type { AssistModel, Proposal } from "../lib/aiAnnotation/aiAnnotationTypes";

export interface AIAssistPanelProps {
  assetId:   string;
  imgW:      number;
  imgH:      number;
  onAccept:  (proposals: Proposal[]) => void;   // hand accepted → manual addAnnotation
  onClose:   () => void;
}

export default function AIAssistPanel(props: AIAssistPanelProps) {
  const ai = useAIAnnotation({
    asset_id: props.assetId, asset_type:"image", imgW:props.imgW, imgH:props.imgH,
  });
  const [model, setModel] = useState<AssistModel>("yolo");
  const [labels, setLabels] = useState("");

  const status = ai.availability[model];

  const run = () => {
    // Input tensor is built by the runtime layer when weights are hosted.
    // Until then the service returns a clear "weights not uploaded" message.
    const labelList = labels.split(",").map(s=>s.trim()).filter(Boolean);
    ai.runAutoAnnotate(model, null, labelList);
  };

  const acceptAndApply = () => {
    ai.acceptAll();
    // Hand the accepted set to the manual layer
    const accepted = ai.items
      .filter(it => it.decision === "accepted" || (it.decision === "pending" && it.proposal.confidence >= ai.minConfidence))
      .map(it => it.proposal);
    if(accepted.length > 0) props.onAccept(accepted);
  };

  return (
    <div style={{position:"absolute",top:0,right:0,bottom:0,width:340,zIndex:50,
      background:"#0a0f1a",borderLeft:"1px solid #1f2937",
      display:"flex",flexDirection:"column",fontFamily:"'JetBrains Mono',monospace"}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",
        borderBottom:"1px solid #1f2937"}}>
        <span style={{fontSize:11,fontWeight:700,color:"#a855f7"}}>✨ AI ASSIST</span>
        <button onClick={props.onClose} style={{marginLeft:"auto",background:"none",
          border:"none",color:"#ef4444",cursor:"pointer",fontSize:12}}>✕</button>
      </div>

      {/* Model selector */}
      <div style={{padding:"10px 12px",borderBottom:"1px solid #1f2937"}}>
        <div style={{fontSize:9,letterSpacing:2,color:"#374151",marginBottom:6}}>MODEL</div>
        <select value={model} onChange={e=>setModel(e.target.value as AssistModel)}
          style={inp}>
          {ASSIST_MODELS.map(m=>(
            <option key={m} value={m}>{ASSIST_MODEL_LABELS[m]}</option>
          ))}
        </select>

        {/* Availability badge */}
        <div style={{marginTop:6,fontSize:9,
          color:status.available?"#22c55e":"#f59e0b"}}>
          {status.available ? "● model ready"
            : status.reason==="weights_not_hosted"
              ? "○ weights not uploaded yet"
              : `○ ${status.reason}`}
        </div>

        {(model==="clip"||model==="grounding_dino") && (
          <input value={labels} onChange={e=>setLabels(e.target.value)}
            placeholder="labels (comma-separated)" style={{...inp,marginTop:6}}/>
        )}

        <button onClick={run} disabled={ai.running}
          style={{...primaryBtn,marginTop:8,width:"100%",
            opacity:ai.running?0.6:1}}>
          {ai.running ? "Running…" : "⚡ Auto-Annotate (one-click)"}
        </button>
      </div>

      {/* Confidence threshold */}
      <div style={{padding:"10px 12px",borderBottom:"1px solid #1f2937"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#6b7280"}}>
          <span>MIN CONFIDENCE</span><span>{(ai.minConfidence*100).toFixed(0)}%</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={ai.minConfidence}
          onChange={e=>ai.setMinConfidence(+e.target.value)}
          style={{width:"100%",accentColor:"#a855f7",marginTop:4}}/>
      </div>

      {/* Status message */}
      {ai.statusMsg && (
        <div style={{padding:"8px 12px",fontSize:9,color:"#9ca3af",
          borderBottom:"1px solid #1f2937"}}>
          {ai.statusMsg}
          {ai.lastResult && ai.lastResult.ran_inference && (
            <span style={{color:"#374151"}}> · {ai.lastResult.backend}</span>
          )}
        </div>
      )}

      {/* Proposals list */}
      <div style={{flex:1,overflowY:"auto",padding:"8px 12px"}}>
        {ai.visibleItems.length === 0 ? (
          <div style={{fontSize:10,color:"#374151",textAlign:"center",padding:"20px 0"}}>
            {ai.running ? "Analyzing…" : "No proposals. Run auto-annotate above."}
          </div>
        ) : ai.visibleItems.map(it=>{
          const p = it.proposal;
          const band = confidenceBand(p.confidence);
          return (
            <div key={p.id} style={{background:"#080c14",border:"1px solid #1f2937",
              borderRadius:8,padding:"7px 9px",marginBottom:5,
              opacity:it.decision==="rejected"?0.4:1}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:2,
                  background:CONFIDENCE_COLORS[band],flexShrink:0}}/>
                <span style={{fontSize:10,color:"#e5e7eb",flex:1}}>{p.class_name}</span>
                <span style={{fontSize:9,color:CONFIDENCE_COLORS[band]}}>
                  {(p.confidence*100).toFixed(0)}%
                </span>
              </div>
              <div style={{fontSize:8,color:"#374151",marginTop:2}}>
                {p.source} · {p.kind}
              </div>
              <div style={{display:"flex",gap:4,marginTop:5}}>
                <button onClick={()=>ai.decide(p.id,"accepted")}
                  style={{...miniBtn,
                    borderColor:it.decision==="accepted"?"#22c55e":"#1f2937",
                    color:it.decision==="accepted"?"#22c55e":"#6b7280"}}>✓ Accept</button>
                <button onClick={()=>ai.decide(p.id,"rejected")}
                  style={{...miniBtn,
                    borderColor:it.decision==="rejected"?"#ef4444":"#1f2937",
                    color:it.decision==="rejected"?"#ef4444":"#6b7280"}}>✕ Reject</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: bulk actions + effort */}
      <div style={{padding:"10px 12px",borderTop:"1px solid #1f2937"}}>
        <div style={{display:"flex",gap:5,marginBottom:8}}>
          <button onClick={acceptAndApply} style={{...primaryBtn,flex:1}}
            disabled={ai.visibleItems.length===0}>
            ✓ Accept & Apply
          </button>
          <button onClick={ai.rejectAll} style={{...ghostBtn}}>Reject All</button>
        </div>
        <div style={{fontSize:9,color:"#374151",display:"flex",justifyContent:"space-between"}}>
          <span>{ai.pendingCount} pending</span>
          <span style={{color:ai.effort.effort_reduction>=0.6?"#22c55e":"#6b7280"}}>
            effort −{(ai.effort.effort_reduction*100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width:"100%", background:"#080c14", color:"#e5e7eb", border:"1px solid #1f2937",
  borderRadius:6, padding:"5px 8px", fontSize:10, outline:"none", fontFamily:"inherit",
};
const primaryBtn: React.CSSProperties = {
  padding:"6px 10px", borderRadius:6, fontSize:10, cursor:"pointer",
  border:"1px solid #a855f7", background:"#a855f718", color:"#a855f7", fontFamily:"inherit",
};
const ghostBtn: React.CSSProperties = {
  padding:"6px 10px", borderRadius:6, fontSize:10, cursor:"pointer",
  border:"1px solid #1f2937", background:"transparent", color:"#6b7280", fontFamily:"inherit",
};
const miniBtn: React.CSSProperties = {
  flex:1, padding:"3px 0", borderRadius:5, fontSize:8, cursor:"pointer",
  border:"1px solid #1f2937", background:"transparent", fontFamily:"inherit",
};
