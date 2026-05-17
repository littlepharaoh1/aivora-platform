// @ts-nocheck
/**
 * LoginPage.tsx — Aivora Platform Authentication
 */
import React, { useState } from "react";
import { supabase } from "../lib/supabase";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [mode,     setMode]     = useState<"login"|"signup">("login");

  async function handleSubmit() {
    if(!email.trim() || !password.trim()) {
      setError("Email and password required"); return;
    }
    setLoading(true); setError("");
    try {
      let result;
      if(mode === "login") {
        result = await supabase.auth.signInWithPassword({ email, password });
      } else {
        result = await supabase.auth.signUp({ email, password });
      }
      if(result.error) { setError(result.error.message); }
      else { onLogin(); }
    } catch(e: any) {
      setError(e.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight:"100vh", background:"#020608",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'JetBrains Mono',monospace", padding:16,
    }}>
      {/* Background grid */}
      <div style={{position:"fixed",inset:0,
        backgroundImage:"radial-gradient(circle,#0EA5E908 1px,transparent 1px)",
        backgroundSize:"32px 32px", pointerEvents:"none"}}/>

      <div style={{
        background:"#080808", border:"1px solid #1a3a5a",
        borderRadius:16, padding:32, width:"100%", maxWidth:380,
        position:"relative",
      }}>
        {/* Logo */}
        <div style={{textAlign:"center", marginBottom:28}}>
          <div style={{
            width:52, height:52, borderRadius:12,
            background:"linear-gradient(135deg,#0EA5E9,#8B5CF6)",
            display:"flex", alignItems:"center", justifyContent:"center",
            margin:"0 auto 12px",
            boxShadow:"0 0 24px #0EA5E940",
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div style={{fontSize:18,fontWeight:800,color:"#E2EEF6",letterSpacing:2}}>
            AIVORA
          </div>
          <div style={{fontSize:9,color:"#4a6a7a",letterSpacing:3,marginTop:2}}>
            AI · DATA · VISION
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {(["login","signup"] as const).map(m => (
            <div key={m} onClick={()=>{setMode(m);setError("");}}
              style={{
                flex:1, textAlign:"center", padding:"6px 0",
                borderRadius:6, cursor:"pointer", fontSize:10,
                fontWeight:700, letterSpacing:1, textTransform:"uppercase",
                background: mode===m ? "#0EA5E920" : "transparent",
                color: mode===m ? "#0EA5E9" : "#4a6a7a",
                border: `1px solid ${mode===m ? "#0EA5E9" : "#1a3a5a"}`,
              }}>
              {m === "login" ? "Sign In" : "Sign Up"}
            </div>
          ))}
        </div>

        {/* Fields */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:9,color:"#4a6a7a",letterSpacing:1,marginBottom:6}}>
            EMAIL
          </div>
          <input
            type="email" value={email}
            onChange={e=>setEmail(e.target.value)}
            placeholder="you@aivoraailtd.com"
            onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
            style={{
              width:"100%", boxSizing:"border-box",
              background:"#030810", border:"1px solid #1a3a5a",
              borderRadius:6, padding:"10px 12px",
              color:"#E2EEF6", fontSize:11,
              fontFamily:"inherit", outline:"none",
            }}/>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#4a6a7a",letterSpacing:1,marginBottom:6}}>
            PASSWORD
          </div>
          <input
            type="password" value={password}
            onChange={e=>setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
            style={{
              width:"100%", boxSizing:"border-box",
              background:"#030810", border:"1px solid #1a3a5a",
              borderRadius:6, padding:"10px 12px",
              color:"#E2EEF6", fontSize:11,
              fontFamily:"inherit", outline:"none",
            }}/>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom:16, padding:"8px 12px",
            background:"#EF444415", border:"1px solid #EF444440",
            borderRadius:6, fontSize:10, color:"#EF4444",
          }}>
            ✗ {error}
          </div>
        )}

        {/* Submit */}
        <button onClick={handleSubmit} disabled={loading}
          style={{
            width:"100%", padding:"12px 0",
            background: loading
              ? "#1a3a5a"
              : "linear-gradient(135deg,#0EA5E9,#8B5CF6)",
            border:"none", borderRadius:8, cursor: loading?"not-allowed":"pointer",
            color:"#fff", fontSize:12, fontWeight:700,
            letterSpacing:1, fontFamily:"inherit",
          }}>
          {loading ? "⟳ Authenticating..." : mode==="login" ? "SIGN IN →" : "CREATE ACCOUNT →"}
        </button>

        {/* Continue as guest */}
        <div style={{textAlign:"center",marginTop:16}}>
          <span onClick={onLogin}
            style={{fontSize:10,color:"#2a5a6a",cursor:"pointer",
              textDecoration:"underline"}}>
            Continue without account
          </span>
        </div>

        {/* Footer */}
        <div style={{
          marginTop:20, paddingTop:16,
          borderTop:"1px solid #0a1520",
          textAlign:"center",
          fontSize:8, color:"#1a3a5a", letterSpacing:1,
        }}>
          AIVORA AI LTD · UK REGISTERED · SECURE
        </div>
      </div>
    </div>
  );
}
