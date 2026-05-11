/**
 * AuthGate.tsx — Protect all routes behind auth + access control
 */
import React, { type ReactNode } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import { isEmailAllowed } from "../lib/auth/adminAllowlist";
import LoginScreen from "./LoginScreen";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#040c14",display:"flex",
      alignItems:"center",justifyContent:"center",fontFamily:"monospace"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,border:"2px solid #22d3ee44",
          borderTop:"2px solid #22d3ee",borderRadius:"50%",
          animation:"spin 1s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{fontSize:10,color:"#4a8a9a",letterSpacing:2}}>
          LOADING AIVORA...
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!user) return <LoginScreen/>;

  // Access control check
  if (!isEmailAllowed(user.email)) return (
    <div style={{minHeight:"100vh",background:"#040c14",display:"flex",
      alignItems:"center",justifyContent:"center",fontFamily:"monospace"}}>
      <div style={{textAlign:"center",maxWidth:400,padding:32,
        background:"#060e16",border:"1px solid #ef444433",borderRadius:16}}>
        <div style={{fontSize:32,marginBottom:16}}>⛔</div>
        <div style={{fontSize:16,fontWeight:700,color:"#ef4444",marginBottom:8}}>
          Access Denied
        </div>
        <div style={{fontSize:11,color:"#4a8a9a",marginBottom:8}}>
          {user.email}
        </div>
        <div style={{fontSize:10,color:"#4a8a9a",marginBottom:24,lineHeight:1.6}}>
          Your account is not authorized to access Aivora Platform.
          Contact your administrator.
        </div>
        <button onClick={signOut}
          style={{background:"#ef444422",border:"1px solid #ef444444",
            borderRadius:8,padding:"8px 20px",cursor:"pointer",
            color:"#ef4444",fontSize:11,fontWeight:700}}>
          Sign Out
        </button>
      </div>
    </div>
  );

  return <>{children}</>;
}
