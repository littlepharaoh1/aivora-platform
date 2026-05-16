// @ts-nocheck
/**
 * LandingPage.tsx — Aivora AI Landing Page
 * Pure black + dot grid + Waveform Arc + Professional
 */
import React, { useEffect, useRef, useState } from "react";

// ── Animated Waveform Arc ─────────────────────────────────────────────────────

function WaveformArc() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const timeRef   = useRef(0);

  useEffect(() => {
    const cv = canvasRef.current; if(!cv) return;
    const ctx = cv.getContext("2d"); if(!ctx) return;
    const W = cv.width = cv.offsetWidth * window.devicePixelRatio;
    const H = cv.height = cv.offsetHeight * window.devicePixelRatio;

    function draw() {
      ctx.clearRect(0,0,W,H);
      timeRef.current += 0.02;
      const t = timeRef.current;
      const cx = W/2, cy = H*0.6;
      const bars = 64;
      const arcR = Math.min(W,H)*0.38;

      for(let i=0;i<bars;i++){
        const angle = (Math.PI) * (i/(bars-1)) - Math.PI;
        const freq  = Math.sin(i*0.3+t) * 0.5 +
                      Math.sin(i*0.15+t*1.3) * 0.3 +
                      Math.sin(i*0.05+t*0.7) * 0.2;
        const amp   = Math.abs(freq) * arcR * 0.4 + 4;

        const x1 = cx + Math.cos(angle)*arcR;
        const y1 = cy + Math.sin(angle)*arcR;
        const x2 = cx + Math.cos(angle)*(arcR+amp);
        const y2 = cy + Math.sin(angle)*(arcR+amp);

        const norm = i/bars;
        const r = Math.round(14  + norm*100);
        const g = Math.round(165 - norm*60);
        const b = Math.round(233 - norm*100);

        ctx.strokeStyle = `rgba(${r},${g},${b},${0.4+Math.abs(freq)*0.6})`;
        ctx.lineWidth   = 2*window.devicePixelRatio;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(x1,y1);
        ctx.lineTo(x2,y2);
        ctx.stroke();
      }

      // Center glow ring
      const grad = ctx.createRadialGradient(cx,cy,arcR*0.7,cx,cy,arcR*1.1);
      grad.addColorStop(0,"rgba(14,165,233,0.05)");
      grad.addColorStop(0.5,"rgba(139,92,246,0.08)");
      grad.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx,cy,arcR*1.3,0,Math.PI*2);
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animRef.current);
  },[]);

  return(
    <canvas ref={canvasRef} style={{
      width:"100%", height:"100%",
      position:"absolute", top:0, left:0,
    }}/>
  );
}

// ── Dot Grid Background ───────────────────────────────────────────────────────

function DotGrid() {
  return(
    <div style={{
      position:"absolute", inset:0, pointerEvents:"none",
      backgroundImage:"radial-gradient(circle, #1a2a3a 1px, transparent 1px)",
      backgroundSize:"32px 32px", opacity:0.4,
    }}/>
  );
}

// ── Stat Item ─────────────────────────────────────────────────────────────────

function Stat({value,label}:{value:string;label:string}){
  return(
    <div style={{textAlign:"center",padding:"0 24px",
      borderRight:"1px solid #1a2a3a"}}>
      <div style={{fontSize:28,fontWeight:800,
        background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
        WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
        {value}
      </div>
      <div style={{fontSize:10,color:"#4a6a7a",letterSpacing:2,marginTop:4}}>
        {label}
      </div>
    </div>
  );
}

// ── Feature Card ──────────────────────────────────────────────────────────────

function FeatureCard({icon,title,desc,color}:{
  icon:string; title:string; desc:string; color:string;
}){
  const [hovered,setHovered]=useState(false);
  return(
    <div onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      style={{
        border:`1px solid ${hovered?color+"66":"#1a2a3a"}`,
        borderTop:`2px solid ${hovered?color:"#1a2a3a"}`,
        borderRadius:16,padding:"24px 20px",
        background:hovered?"#0a0a0a":"#000000",
        transition:"all 0.3s",cursor:"default",
      }}>
      <div style={{width:36,height:36,marginBottom:12,display:"flex",
        alignItems:"center",justifyContent:"center",
        borderRadius:8,background:`${color}15`,border:`1px solid ${color}33`}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          dangerouslySetInnerHTML={{__html:icon}}/>
      </div>
      <div style={{fontSize:14,fontWeight:700,color:"#E2EEF6",marginBottom:8}}>
        {title}
      </div>
      <div style={{fontSize:11,color:"#4a6a7a",lineHeight:1.6}}>{desc}</div>
    </div>
  );
}

// ── Main Landing ──────────────────────────────────────────────────────────────

interface Props { onEnter: () => void; }

export default function LandingPage({ onEnter }: Props) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{ setTimeout(()=>setVisible(true),100); },[]);

  return(
    <div style={{
      minHeight:"100vh", background:"#000000",
      color:"#E2EEF6", overflow:"auto",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",
    }}>

      {/* Nav */}
      <nav style={{
        position:"fixed",top:0,left:0,right:0,zIndex:100,
        height:60,display:"flex",alignItems:"center",
        padding:"0 32px",justifyContent:"space-between",
        background:"rgba(0,0,0,0.95)",
        backdropFilter:"blur(12px)",
        borderBottom:"1px solid #111",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <img src="/aivora-logo.svg" alt="Aivora"
            style={{width:32,height:32,objectFit:"contain"}}/>
          <div>
            <div style={{fontSize:14,fontWeight:800,letterSpacing:3,color:"#E2EEF6"}}>
              AIVORA
            </div>
            <div style={{fontSize:7,color:"#4a6a7a",letterSpacing:3}}>
              AI · DATA · VISION
            </div>
          </div>
        </div>
        <button onClick={onEnter}
          style={{
            background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
            border:"none",borderRadius:8,
            padding:"10px 24px",cursor:"pointer",
            color:"#fff",fontSize:12,fontWeight:700,
            letterSpacing:1,fontFamily:"inherit",
          }}>
          OPEN PLATFORM →
        </button>
      </nav>

      {/* Hero */}
      <section style={{
        minHeight:"100vh",display:"flex",
        flexDirection:"column",alignItems:"center",
        justifyContent:"center",position:"relative",
        padding:"80px 24px 40px",overflow:"hidden",
      }}>
        <DotGrid/>

        {/* Waveform Arc */}
        <div style={{
          position:"absolute",bottom:0,left:0,right:0,
          height:"60%",opacity:0.8,
        }}>
          <WaveformArc/>
        </div>

        {/* Hero Content */}
        <div style={{
          position:"relative",zIndex:2,
          textAlign:"center",maxWidth:800,
          opacity:visible?1:0,transform:visible?"translateY(0)":"translateY(30px)",
          transition:"all 0.8s ease",
        }}>
          <div style={{
            display:"inline-block",
            border:"1px solid #1a3a5a",borderRadius:20,
            padding:"4px 16px",marginBottom:24,
            fontSize:10,color:"#0EA5E9",letterSpacing:3,
          }}>
            AI AUDIO DATA PRODUCTION PLATFORM
          </div>

          <h1 style={{
            fontSize:"clamp(36px,7vw,80px)",
            fontWeight:900,lineHeight:1.1,
            marginBottom:24,letterSpacing:-2,
          }}>
            <span style={{color:"#E2EEF6"}}>Empowering</span>
            <br/>
            <span style={{
              background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
              WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            }}>Intelligence</span>
            <br/>
            <span style={{color:"#E2EEF6"}}>Through Audio</span>
          </h1>

          <p style={{
            fontSize:"clamp(13px,2vw,16px)",
            color:"#64A0B8",maxWidth:560,
            margin:"0 auto 40px",lineHeight:1.7,
          }}>
            Professional-grade audio QC, forensic silence repair,
            and AI data production — all in one platform.
          </p>

          <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={onEnter}
              style={{
                background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
                border:"none",borderRadius:10,
                padding:"14px 32px",cursor:"pointer",
                color:"#fff",fontSize:13,fontWeight:700,
                letterSpacing:1,fontFamily:"inherit",
                boxShadow:"0 0 30px #0EA5E944",
              }}>
              OPEN PLATFORM →
            </button>
            <button style={{
              background:"transparent",
              border:"1px solid #1a3a5a",borderRadius:10,
              padding:"14px 32px",cursor:"pointer",
              color:"#64A0B8",fontSize:13,fontWeight:600,
              fontFamily:"inherit",
            }}>
              LEARN MORE ↓
            </button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section style={{
        padding:"60px 32px",
        borderTop:"1px solid #111",borderBottom:"1px solid #111",
        display:"flex",justifyContent:"center",
        gap:0,flexWrap:"wrap",
      }}>
        {[
          ["13+","DSP PHASES"],
          ["85%+","VAD ACCURACY"],
          ["200","BATCH FILES"],
          ["32-BIT","FLOAT EXPORT"],
          ["11","FORENSIC TOOLS"],
        ].map(([v,l])=>(
          <Stat key={l} value={v} label={l}/>
        ))}
      </section>

      {/* Features */}
      <section style={{padding:"80px 32px",maxWidth:1100,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:48}}>
          <div style={{fontSize:10,color:"#4a6a7a",letterSpacing:3,marginBottom:12}}>
            CAPABILITIES
          </div>
          <h2 style={{fontSize:"clamp(24px,4vw,40px)",fontWeight:800,
            color:"#E2EEF6",letterSpacing:-1}}>
            Everything You Need
          </h2>
        </div>
        <div style={{display:"grid",
          gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:16}}>
          <FeatureCard icon='<path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>' color="#0EA5E9"
            title="QC Workstation"
            desc="Professional audio quality control with 13 DSP phases, LUFS, True Peak, SNR, RT60 analysis."/>
          <FeatureCard icon='<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>' color="#8B5CF6"
            title="Forensic Silence Repair"
            desc="Adobe-style silence reconstruction using grain synthesis and spectral matching."/>
          <FeatureCard icon='<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>' color="#10B981"
            title="Audition Workstation"
            desc="Professional waveform editor with speech protection and region QA after every edit."/>
          <FeatureCard icon='<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' color="#F59E0B"
            title="Batch Processing"
            desc="Process 200 files simultaneously with progress tracking and cancellation support."/>
          <FeatureCard icon='<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>' color="#0EA5E9"
            title="Smart Naming"
            desc="German Appen sequencer S0001–S0200 with automatic task and speed detection."/>
          <FeatureCard icon='<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' color="#8B5CF6"
            title="Audio Pipeline"
            desc="End-to-end processing from upload to delivery-ready export in 32-bit float WAV."/>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding:"80px 32px",textAlign:"center",
        borderTop:"1px solid #111",position:"relative",overflow:"hidden",
      }}>
        <DotGrid/>
        <div style={{position:"relative",zIndex:1}}>
          <h2 style={{fontSize:"clamp(24px,4vw,48px)",fontWeight:900,
            marginBottom:16,letterSpacing:-1}}>
            Ready to Start?
          </h2>
          <p style={{fontSize:14,color:"#64A0B8",marginBottom:32}}>
            AI. DATA. VISION.
          </p>
          <button onClick={onEnter}
            style={{
              background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
              border:"none",borderRadius:12,
              padding:"16px 48px",cursor:"pointer",
              color:"#fff",fontSize:14,fontWeight:800,
              letterSpacing:2,fontFamily:"inherit",
              boxShadow:"0 0 40px #8B5CF644",
            }}>
            OPEN PLATFORM →
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding:"24px 32px",borderTop:"1px solid #111",
        display:"flex",justifyContent:"space-between",
        alignItems:"center",flexWrap:"wrap",gap:8,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <img src="/aivora-logo.svg" alt="Aivora"
            style={{width:24,height:24,objectFit:"contain"}}/>
          {/* Contact */}
          <div style={{display:"flex",gap:24,marginBottom:20,flexWrap:"wrap",
            justifyContent:"center"}}>
            <a href="mailto:Info@aivoraailtd.com"
              style={{display:"flex",alignItems:"center",gap:8,
                color:"#64A0B8",fontSize:12,textDecoration:"none",
                padding:"8px 16px",border:"1px solid #1a4a6a",borderRadius:6,
                transition:"all 0.2s",background:"#0a1520"}}
              onMouseEnter={e=>{e.currentTarget.style.color="#0EA5E9";e.currentTarget.style.borderColor="#0EA5E9";}}
              onMouseLeave={e=>{e.currentTarget.style.color="#64A0B8";e.currentTarget.style.borderColor="#1a4a6a";}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#0EA5E9" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              Info@aivoraailtd.com
            </a>
            <a href="mailto:Contact@aivoraailtd.com"
              style={{display:"flex",alignItems:"center",gap:8,
                color:"#64A0B8",fontSize:12,textDecoration:"none",
                padding:"8px 16px",border:"1px solid #1a4a6a",borderRadius:6,
                background:"#0a1520"}}
              onMouseEnter={e=>{e.currentTarget.style.color="#8B5CF6";e.currentTarget.style.borderColor="#8B5CF6";}}
              onMouseLeave={e=>{e.currentTarget.style.color="#64A0B8";e.currentTarget.style.borderColor="#1a4a6a";}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              Contact@aivoraailtd.com
            </a>
          </div>

          <span style={{fontSize:10,color:"#2a4a5a",letterSpacing:2}}>
            AIVORA AI © 2026
          </span>
        </div>
        <div style={{fontSize:10,color:"#2a4a5a",letterSpacing:1}}>
          AI · DATA · VISION
        </div>
      </footer>
    </div>
  );
}
