// @ts-nocheck
/**
 * UserAvatar.tsx — User avatar + logout button
 */
import React, { useState } from "react";
import { useAuth } from "../lib/auth/AuthContext";

export default function UserAvatar() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const roleColor = {
    owner:         "#f59e0b",
    admin:         "#22d3ee",
    manager:       "#10b981",
    qa_manager:    "#8b5cf6",
    qa_reviewer:   "#6366f1",
    operator:      "#a0c4cc",
    client_viewer: "#4a8a9a",
  }[user.role] || "#4a8a9a";

  return (
    <div style={{position:"relative"}}>
      <div onClick={()=>setOpen(!open)}
        style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",
          padding:"4px 10px",borderRadius:20,
          background:"#060e16",border:"1px solid #0f2a3a"}}>
        {user.photoURL
          ? <img src={user.photoURL} alt="" style={{width:24,height:24,
              borderRadius:"50%",border:"1px solid #22d3ee44"}}/>
          : <div style={{width:24,height:24,borderRadius:"50%",
              background:"#22d3ee22",border:"1px solid #22d3ee44",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:10,color:"#22d3ee",fontWeight:700}}>
              {user.displayName[0].toUpperCase()}
            </div>}
        <span style={{fontSize:10,color:"#a0c4cc",maxWidth:100,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {user.displayName}
        </span>
        <span style={{fontSize:8,color:roleColor,background:roleColor+"22",
          padding:"1px 6px",borderRadius:4,fontWeight:700}}>
          {user.role.toUpperCase()}
        </span>
      </div>

      {open && <div style={{position:"absolute",right:0,top:"calc(100% + 8px)",
        background:"#060e16",border:"1px solid #0f2a3a",borderRadius:10,
        padding:12,minWidth:200,zIndex:9999,
        boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:11,color:"#e0f2f8",fontWeight:700,marginBottom:2}}>
          {user.displayName}
        </div>
        <div style={{fontSize:9,color:"#4a8a9a",marginBottom:12}}>
          {user.email}
        </div>
        <div style={{borderTop:"1px solid #0f2a3a",paddingTop:10}}>
          <button onClick={()=>{signOut();setOpen(false);}}
            style={{width:"100%",background:"#ef444422",
              border:"1px solid #ef444444",borderRadius:6,
              padding:"6px 12px",cursor:"pointer",
              color:"#ef4444",fontSize:10,fontWeight:700}}>
            Sign Out
          </button>
        </div>
      </div>}
    </div>
  );
}
