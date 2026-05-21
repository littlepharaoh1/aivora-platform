// @ts-nocheck
import React from "react";
import { colors } from "../../lib/design/tokens";
import { useAuth } from "../../lib/auth/AuthContext";

interface Props { title:string; subtitle?:string; }

export default function AppTopBar({ title, subtitle }: Props) {
  const { user, signOut } = useAuth();
  return(
    <div style={{height:52,flexShrink:0,
      background:colors.bg.surface,
      borderBottom:`1px solid ${colors.bg.border}`,
      display:"flex",alignItems:"center",
      padding:"0 20px",gap:12}}>
      <div>
        <div style={{fontSize:13,fontWeight:700,color:colors.text.primary,letterSpacing:0.5}}>
          {title}
        </div>
        {subtitle&&<div style={{fontSize:9,color:colors.text.muted,letterSpacing:1}}>
          {subtitle}
        </div>}
      </div>
      <div style={{flex:1}}/>
      <div style={{display:"flex",alignItems:"center",gap:4,
        padding:"3px 10px",borderRadius:20,
        background:colors.accent.greenDim,
        border:`1px solid ${colors.accent.green}44`}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:colors.accent.green}}/>
        <span style={{fontSize:9,color:colors.accent.green,fontWeight:600}}>ONLINE</span>
      </div>
      {user&&<div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{fontSize:9,color:colors.text.secondary,
          maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {user.email}
        </div>
        <div onClick={signOut}
          style={{width:30,height:30,borderRadius:8,
            background:colors.bg.elevated,
            border:`1px solid ${colors.bg.border}`,
            display:"flex",alignItems:"center",justifyContent:"center",
            cursor:"pointer",fontSize:13,color:colors.text.secondary}}
          title="Sign out">⏻</div>
      </div>}
    </div>
  );
}
