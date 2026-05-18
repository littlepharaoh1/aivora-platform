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
  icon:string;title:string;desc:string;color:string;
}){
  const [hovered,setHovered]=useState(false);
  return(
    <div onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      style={{
        border:`1px solid ${hovered?color+"66":"#1a2a3a"}`,
        borderTop:`2px solid ${hovered?color:"#1a2a3a"}`,
        borderRadius:16,padding:"24px 20px",
        background:hovered?"#0a1520":"transparent",
        transition:"all 0.3s",cursor:"default",
      }}>
      <div style={{fontSize:28,marginBottom:12}}>{icon}</div>
      <div style={{fontSize:14,fontWeight:700,color:"#E2EEF6",marginBottom:8}}>
        {title}
      </div>
      <div style={{fontSize:11,color:"#4a6a7a",lineHeight:1.6}}>{desc}</div>
    </div>
  );
}

// ── Main Landing ──────────────────────────────────────────────────────────────

interface Props { onEnter: () => void; }

// ── About Modal ──────────────────────────────────────────────────────────────

function AboutModal({ onClose }: { onClose: () => void }) {

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,
      background:"rgba(0,0,0,0.88)",display:"flex",
      alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"#080808",border:"1px solid #1a3a5a",
        borderRadius:16,maxWidth:640,width:"100%",maxHeight:"90vh",
        overflow:"auto",padding:28}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",
          alignItems:"flex-start",marginBottom:24}}>
          <div>
            <div style={{fontSize:9,color:"#0EA5E9",letterSpacing:3,marginBottom:4}}>
              ABOUT AIVORA
            </div>
            <div style={{fontSize:20,fontWeight:700,color:"#E2EEF6"}}>
              Aivora AI LTD
            </div>
            <div style={{fontSize:10,color:"#4a6a7a",marginTop:2}}>
              AI Data Infrastructure Company · UK Registered · Global Operations
            </div>
          </div>
          <button onClick={onClose}
            style={{background:"transparent",border:"1px solid #1a3a5a",
              borderRadius:6,padding:"4px 10px",cursor:"pointer",
              color:"#4a6a7a",fontSize:13,flexShrink:0}}>✕</button>
        </div>

        {/* Who We Are */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#0EA5E9",letterSpacing:2,marginBottom:8}}>
            WHO WE ARE
          </div>
          <div style={{fontSize:11,color:"#64A0B8",lineHeight:1.8}}>
            Aivora AI LTD is a UK-registered AI data operations company specializing
            in AI Training Data, Multilingual Data Annotation, and Audio & Speech Data
            solutions. We support AI builders and enterprises by delivering secure,
            high-quality, production-ready datasets across text, audio, image, video,
            and multimodal use cases.
          </div>
        </div>

        {/* Vision */}
        <div style={{marginBottom:20,padding:14,borderRadius:8,
          background:"#050d18",border:"1px solid #0f2030"}}>
          <div style={{fontSize:9,color:"#8B5CF6",letterSpacing:2,marginBottom:6}}>
            OUR VISION
          </div>
          <div style={{fontSize:11,color:"#64A0B8",lineHeight:1.8}}>
            To become a trusted long-term AI data partner for global technology
            companies — delivering reliable data, scalable operations, multilingual
            expertise, and consistent quality with secure compliant workflows.
          </div>
        </div>

        {/* Aivora Platform */}
        <div style={{marginBottom:20,padding:14,borderRadius:8,
          background:"#050d18",border:"1px solid #0EA5E930"}}>
          <div style={{fontSize:9,color:"#0EA5E9",letterSpacing:2,marginBottom:10}}>
            AIVORA PLATFORM — HOW IT HELPS YOU
          </div>
          <div style={{fontSize:11,color:"#64A0B8",lineHeight:1.8,marginBottom:12}}>
            The Aivora Platform is our internal forensic audio infrastructure tool —
            built to guarantee the highest quality of every audio file before delivery.
            Any client working with us benefits directly from this platform.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[
              {
                icon:"🔬",
                title:"Forensic Audio QA",
                desc:"Every WAV file is inspected for hum, hiss, clipping, dead silence, and spectral anomalies before it reaches you. No bad files slip through.",
                who:"ASR / TTS / Voice AI clients"
              },
              {
                icon:"🎛",
                title:"Professional Audio Editor",
                desc:"Adobe Audition-style waveform + spectrogram editor with HDR visualization. Our team reviews files sample-by-sample when needed.",
                who:"Studios · Dataset teams · QA engineers"
              },
              {
                icon:"🤖",
                title:"Audio Bench — Verifier System",
                desc:"Automated benchmark that scores every repaired audio file against ITU-R BS.1770-4 standards. You get verified, scored output — not just 'checked'.",
                who:"AI companies · Model trainers · Research teams"
              },
              {
                icon:"⚡",
                title:"Batch Processing",
                desc:"Process 200+ files simultaneously with automatic QC scoring, silence repair, loudness normalization, and format validation.",
                who:"Large-scale dataset clients · Production teams"
              },
              {
                icon:"🏷",
                title:"Smart Naming",
                desc:"Automatic file sequencing and naming in any format (S0001–S0200, speaker codes, task IDs). Zero manual renaming errors.",
                who:"Standard format · Custom delivery formats"
              },
              {
                icon:"📊",
                title:"Delivery Readiness Score",
                desc:"Before any delivery, every file gets a compliance score. Files that don't meet your spec are flagged automatically — before they reach you.",
                who:"All clients receiving audio deliveries"
              },
            ].map(({icon,title,desc,who})=>(
              <div key={title} style={{padding:"10px 12px",borderRadius:8,
                background:"#030810",border:"1px solid #0f2030",
                display:"flex",gap:12}}>
                <div style={{fontSize:20,flexShrink:0,marginTop:2}}>{icon}</div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:"#E2EEF6",marginBottom:3}}>
                    {title}
                  </div>
                  <div style={{fontSize:10,color:"#4a6a7a",lineHeight:1.6,marginBottom:4}}>
                    {desc}
                  </div>
                  <div style={{fontSize:8,color:"#0EA5E9",letterSpacing:1}}>
                    → {who}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Core Services */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#0EA5E9",letterSpacing:2,marginBottom:10}}>
            CORE SERVICES
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              {icon:"🎙", title:"Audio & Speech Data",   desc:"ASR, TTS, multilingual recording, 30+ languages"},
              {icon:"📝", title:"Data Annotation",        desc:"Text, image, video, audio annotation"},
              {icon:"🤖", title:"LLM Training Data",      desc:"Prompt evaluation & fine-tuning datasets"},
              {icon:"📊", title:"Model Evaluation",       desc:"Benchmarking, scoring & QA reporting"},
              {icon:"🌍", title:"Multilingual Coverage",  desc:"3,000+ native speakers, MENA & global"},
              {icon:"🔒", title:"Secure & Compliant",     desc:"GDPR · NDA · Controlled access"},
            ].map(({icon,title,desc})=>(
              <div key={title} style={{padding:"10px 12px",borderRadius:8,
                background:"#030810",border:"1px solid #0f2030"}}>
                <div style={{fontSize:16,marginBottom:4}}>{icon}</div>
                <div style={{fontSize:10,fontWeight:700,color:"#E2EEF6",marginBottom:3}}>
                  {title}
                </div>
                <div style={{fontSize:9,color:"#4a6a7a",lineHeight:1.5}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Global Structure */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#0EA5E9",letterSpacing:2,marginBottom:10}}>
            GLOBAL STRUCTURE
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              {loc:"🇬🇧 UK Headquarters", role:"Corporate governance · Client relations · Compliance oversight"},
              {loc:"🌍 Egypt Operations",  role:"Project management · QA leadership · Contributor coordination"},
              {loc:"🌐 Global Network",    role:"3,000+ native speakers · 30+ languages & dialects"},
            ].map(({loc,role})=>(
              <div key={loc} style={{flex:"1 1 160px",padding:"10px 12px",
                borderRadius:8,background:"#030810",border:"1px solid #0f2030"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#E2EEF6",marginBottom:4}}>
                  {loc}
                </div>
                <div style={{fontSize:9,color:"#4a6a7a",lineHeight:1.5}}>{role}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Key Stats */}
        <div style={{marginBottom:20}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              {v:"3,000+", l:"Contributors", c:"#0EA5E9"},
              {v:"30+",    l:"Languages",    c:"#8B5CF6"},
              {v:"5",      l:"QA Stages",    c:"#10B981"},
              {v:"GDPR",   l:"Compliant",    c:"#F59E0B"},
              {v:"32-bit", l:"Float Export", c:"#22d3ee"},
              {v:"200+",   l:"Batch Files",  c:"#F97316"},
            ].map(({v,l,c})=>(
              <div key={l} style={{flex:"1 1 70px",textAlign:"center",
                padding:"10px 8px",borderRadius:8,
                background:"#050d18",border:`1px solid ${c}30`}}>
                <div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div>
                <div style={{fontSize:8,color:"#4a6a7a",marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div style={{borderTop:"1px solid #0a1520",paddingTop:16,
          display:"flex",gap:10,flexWrap:"wrap"}}>
          {[
            {email:"Info@aivoraailtd.com",    color:"#0EA5E9"},
            {email:"Contact@aivoraailtd.com", color:"#8B5CF6"},
          ].map(({email,color})=>(
            <a key={email} href={`mailto:${email}`}
              style={{display:"flex",alignItems:"center",gap:6,
                color:color,fontSize:11,textDecoration:"none",
                padding:"6px 14px",borderRadius:6,
                border:`1px solid ${color}40`,background:`${color}10`}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke={color} strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              {email}
            </a>
          ))}
        </div>

      </div>
    </div>
  );
}

export default function LandingPage({ onEnter }: Props) {
  const [visible,setVisible]=useState(false);
  const [showAbout,setShowAbout]=useState(false);
  useEffect(()=>{ setTimeout(()=>setVisible(true),100); },[]);

  return(
    <div style={{
      minHeight:"100vh", background:"#080808",
      color:"#E2EEF6", overflow:"auto",
      fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",
    }}>

      {/* Nav */}
      <nav style={{
        position:"fixed",top:0,left:0,right:0,zIndex:100,
        height:60,display:"flex",alignItems:"center",
        padding:"0 32px",justifyContent:"space-between",
        background:"rgba(8,8,8,0.9)",
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
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>setShowAbout(true)}
            style={{display:"flex",alignItems:"center",gap:6,
              background:"#050a10",border:"1px solid #1a3a5a",
              borderRadius:6,padding:"6px 14px",cursor:"pointer",
              color:"#64A0B8",fontSize:12,fontFamily:"inherit"}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#0EA5E9" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            About
          </button>
          <a href="mailto:Info@aivoraailtd.com"
            style={{display:"flex",alignItems:"center",gap:6,
              background:"#050a10",border:"1px solid #1a3a5a",
              borderRadius:6,padding:"6px 14px",
              color:"#64A0B8",fontSize:12,textDecoration:"none"}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#0EA5E9" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            Info@aivoraailtd.com
          </a>
          <a href="mailto:Contact@aivoraailtd.com"
            style={{display:"flex",alignItems:"center",gap:6,
              background:"#050a10",border:"1px solid #1a3a5a",
              borderRadius:6,padding:"6px 14px",
              color:"#64A0B8",fontSize:12,textDecoration:"none"}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#8B5CF6" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            Contact@aivoraailtd.com
          </a>
          <button onClick={onEnter}
            style={{background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
              border:"none",borderRadius:8,padding:"10px 24px",cursor:"pointer",
              color:"#fff",fontSize:12,fontWeight:700,
              letterSpacing:1,fontFamily:"inherit"}}>
            OPEN PLATFORM →
          </button>
        </div>
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
          <FeatureCard icon="🎙" color="#0EA5E9"
            title="QC Workstation"
            desc="Professional audio quality control with 13 DSP phases, LUFS, True Peak, SNR, RT60 analysis."/>
          <FeatureCard icon="🔬" color="#8B5CF6"
            title="Forensic Silence Repair"
            desc="Adobe-style silence reconstruction using grain synthesis and spectral matching."/>
          <FeatureCard icon="🎛" color="#10B981"
            title="Audition Workstation"
            desc="Professional waveform editor with speech protection and region QA after every edit."/>
          <FeatureCard icon="📊" color="#F59E0B"
            title="Batch Processing"
            desc="Process 200 files simultaneously with progress tracking and cancellation support."/>
          <FeatureCard icon="🏷" color="#0EA5E9"
            title="Smart Naming"
            desc="Smart sequential naming S0001–S0200 with automatic task and speed detection."/>
          <FeatureCard icon="⚡" color="#8B5CF6"
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


          {showAbout && <AboutModal onClose={()=>setShowAbout(false)}/>}

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
