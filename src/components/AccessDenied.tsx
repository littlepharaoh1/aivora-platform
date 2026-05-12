/**
 * AccessDenied.tsx — Access restricted screen
 */
import React, { useEffect } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import { trackEvent } from "../lib/tracking/activityTracker";
import { MODULE_LABELS, ROLE_DISPLAY } from "../lib/auth/permissions";
import type { AivoraModule } from "../lib/auth/permissions";

interface AccessDeniedProps {
  module: AivoraModule;
}

export default function AccessDenied({ module }: AccessDeniedProps) {
  const { user } = useAuth();

  useEffect(() => {
    trackEvent({
      eventType: "tab_opened",
      module:    module,
      userId:    user?.uid,
      userEmail: user?.email,
      userRole:  user?.role,
      metadata:  { access_denied: true, module },
    });
  }, [module]);
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:"60vh",fontFamily:"monospace",padding:32}}>
      <div style={{textAlign:"center",maxWidth:400,
        background:"#060e16",border:"1px solid #ef444433",
        borderRadius:16,padding:"32px 24px"}}>
        <div style={{fontSize:32,marginBottom:16}}>🔒</div>
        <div style={{fontSize:14,fontWeight:700,color:"#ef4444",marginBottom:8}}>
          Access Restricted
        </div>
        <div style={{fontSize:11,color:"#a0c4cc",marginBottom:16}}>
          <strong style={{color:"#22d3ee"}}>{MODULE_LABELS[module]}</strong>
          {" "}is not available for your role.
        </div>
        {user && (
          <div style={{fontSize:10,color:"#4a8a9a",padding:"8px 16px",
            background:"#050d14",borderRadius:8,border:"1px solid #0f2a3a"}}>
            Your role:{" "}
            <strong style={{color:"#f59e0b"}}>
              {ROLE_DISPLAY[user.role as keyof typeof ROLE_DISPLAY] || user.role}
            </strong>
          </div>
        )}
        <div style={{fontSize:9,color:"#2a5a6a",marginTop:16}}>
          Contact your administrator to request access.
        </div>
      </div>
    </div>
  );
}
