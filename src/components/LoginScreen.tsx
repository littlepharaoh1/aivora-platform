// @ts-nocheck
/**
 * LoginScreen.tsx — Premium Enterprise Login
 * Aivora Platform
 */
import React, { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth/AuthContext";

function AnimatedBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = canvas.width  = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    const particles = Array.from({length:60},()=>({
      x: Math.random()*W, y: Math.random()*H,
      vx:(Math.random()-0.5)*0.3, vy:(Math.random()-0.5)*0.3,
      r: Math.random()*1.5+0.5,
      a: Math.random(),
    }));
    let raf;
    function draw() {
      ctx.clearRect(0,0,W,H);
      ctx.fillStyle="#040c14";
      ctx.fillRect(0,0,W,H);
      particles.forEach(p=>{
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0||p.x>W) p.vx*=-1;
        if(p.y<0||p.y>H) p.vy*=-1;
        ctx.beginPath();
        ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(34,211,238,${p.a*0.4})`;
        ctx.fill();
      });
      particles.forEach((a,i)=>{
        particles.slice(i+1).forEach(b=>{
          const d=Math.hypot(a.x-b.x,a.y-b.y);
          if(d<120){
            ctx.beginPath();
            ctx.moveTo(a.x,a.y);
            ctx.lineTo(b.x,b.y);
            ctx.strokeStyle=`rgba(34,211,238,${(1-d/120)*0.08})`;
            ctx.lineWidth=0.5;
            ctx.stroke();
          }
        });
      });
      raf=requestAnimationFrame(draw);
    }
    draw();
    const resize=()=>{W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;};
    window.addEventListener("resize",resize);
    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",resize); };
  },[]);
  return <canvas ref={canvasRef} style={{position:"fixed",inset:0,zIndex:0}}/>;
}

export default function LoginScreen() {
  const { signInGoogle, loading, error } = useAuth();

  return (
    <div style={{minHeight:"100vh",background:"#040c14",display:"flex",
      alignItems:"center",justifyContent:"center",fontFamily:"monospace",
      position:"relative",overflow:"hidden"}}>
      <AnimatedBg/>

      {/* Card */}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:420,
        margin:"0 20px",background:"rgba(6,14,22,0.95)",
        border:"1px solid #0f2a3a",borderRadius:20,padding:"40px 36px",
        boxShadow:"0 0 80px rgba(34,211,238,0.06),0 20px 60px rgba(0,0,0,0.5)"}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:56,height:56,borderRadius:16,
            background:"linear-gradient(135deg,#22d3ee22,#10b98122)",
            border:"1px solid #22d3ee44",display:"flex",alignItems:"center",
            justifyContent:"center",margin:"0 auto 16px",fontSize:28}}>
            🎙
          </div>
          <div style={{fontSize:22,fontWeight:900,color:"#e0f2f8",
            letterSpacing:2,marginBottom:4}}>AIVORA</div>
          <div style={{fontSize:10,color:"#4a8a9a",letterSpacing:3}}>
            AI DATA OPERATIONS PLATFORM
          </div>
        </div>

        {/* Divider */}
        <div style={{borderTop:"1px solid #0f2a3a",marginBottom:28}}/>

        <div style={{fontSize:13,color:"#a0c4cc",textAlign:"center",marginBottom:24}}>
          Sign in to access your workspace
        </div>

        {/* Google Button */}
        <button onClick={signInGoogle} disabled={loading}
          style={{width:"100%",display:"flex",alignItems:"center",
            justifyContent:"center",gap:12,
            background:loading?"#0f2a3a":"rgba(255,255,255,0.04)",
            border:"1px solid #1e3a5f",borderRadius:12,
            padding:"14px 20px",cursor:loading?"not-allowed":"pointer",
            color:"#e0f2f8",fontSize:13,fontWeight:600,
            transition:"all 0.2s",
            boxShadow:loading?"none":"0 0 20px rgba(34,211,238,0.04)"}}>
          {loading ? (
            <div style={{width:18,height:18,border:"2px solid #22d3ee44",
              borderTop:"2px solid #22d3ee",borderRadius:"50%",
              animation:"spin 1s linear infinite"}}/>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {loading ? "Signing in..." : "Continue with Google"}
        </button>

        {/* Error */}
        {error && <div style={{marginTop:16,padding:"10px 14px",
          background:"#ef444422",border:"1px solid #ef444444",
          borderRadius:8,fontSize:11,color:"#ef4444",textAlign:"center"}}>
          {error}
        </div>}

        {/* Footer */}
        <div style={{marginTop:32,textAlign:"center",fontSize:9,
          color:"#2a5a6a",lineHeight:1.6}}>
          Enterprise AI Data Operations<br/>
          DSP Engine V4 · EBU R128 · Appen-Ready QC
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
