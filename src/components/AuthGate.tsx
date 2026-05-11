/**
 * AuthGate.tsx — Protect all routes behind auth
 */
import React, { type ReactNode } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import LoginScreen from "./LoginScreen";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

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
  return <>{children}</>;
}
