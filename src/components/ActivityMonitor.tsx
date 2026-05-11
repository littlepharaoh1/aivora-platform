// @ts-nocheck
/**
 * ActivityMonitor.tsx — Enterprise Admin Activity Dashboard
 * Aivora Platform — Real-time operational monitoring
 */
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth/AuthContext";

const EVENT_COLORS = {
  login_success:     "#10b981",
  login_failed:      "#ef4444",
  logout:            "#f59e0b",
  file_uploaded:     "#22d3ee",
  file_analyzed:     "#22d3ee",
  batch_completed:   "#8b5cf6",
  wav_exported:      "#10b981",
  zip_exported:      "#10b981",
  report_exported:   "#6366f1",
  error_occurred:    "#ef4444",
  crash_detected:    "#ef4444",
  tab_opened:        "#4a8a9a",
  repair_applied:    "#f59e0b",
  naming_completed:  "#8b5cf6",
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function StatCard({ label, value, color = "#22d3ee", sub = "" }) {
  return (
    <div style={{background:"#060e16",border:"1px solid #0f2a3a",
      borderRadius:10,padding:"12px 16px",minWidth:100}}>
      <div style={{fontSize:22,fontWeight:900,color,fontFamily:"monospace"}}>{value}</div>
      <div style={{fontSize:9,color:"#4a8a9a",marginTop:2}}>{label}</div>
      {sub && <div style={{fontSize:8,color:"#2a5a6a",marginTop:1}}>{sub}</div>}
    </div>
  );
}

export default function ActivityMonitor() {
  const { user, isAdmin } = useAuth();
  const [logs,       setLogs]       = useState([]);
  const [stats,      setStats]      = useState({
    total:0, logins:0, files:0, exports:0, errors:0, sessions:0
  });
  const [filter,     setFilter]     = useState({ module:"", eventType:"", user:"" });
  const [loading,    setLoading]    = useState(true);
  const [autoRefresh,setAutoRefresh]= useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filter.module)    query = query.eq("module", filter.module);
      if (filter.eventType) query = query.eq("event_type", filter.eventType);
      if (filter.user)      query = query.ilike("user_email", `%${filter.user}%`);

      const { data, error } = await query;
      if (error) throw error;

      const logs = data || [];
      setLogs(logs);

      // Compute stats
      const today = new Date().toDateString();
      setStats({
        total:    logs.length,
        logins:   logs.filter(l => l.event_type === "login_success").length,
        files:    logs.filter(l => ["file_uploaded","file_analyzed"].includes(l.event_type)).length,
        exports:  logs.filter(l => ["wav_exported","zip_exported","report_exported"].includes(l.event_type)).length,
        errors:   logs.filter(l => ["error_occurred","crash_detected"].includes(l.event_type)).length,
        sessions: new Set(logs.map(l => l.session_id)).size,
      });
    } catch(e) {
      console.error("ActivityMonitor:", e);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  if (!isAdmin) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      height:"100%",fontFamily:"monospace",color:"#ef4444",fontSize:12}}>
      ⛔ Admin access required
    </div>
  );

  const uniqueModules   = [...new Set(logs.map(l => l.module).filter(Boolean))];
  const uniqueEvents    = [...new Set(logs.map(l => l.event_type).filter(Boolean))];
  const uniqueUsers     = [...new Set(logs.map(l => l.user_email).filter(Boolean))];

  return (
    <div style={{background:"#040c14",minHeight:"100%",fontFamily:"monospace",color:"#a0c4cc"}}>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#060e18,#071a18)",
        borderBottom:"1px solid #0f2a3a",padding:"14px 18px",
        display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,borderRadius:10,background:"#ef444422",
            border:"1px solid #ef444444",display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:16}}>👁</div>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#e0f2f8",letterSpacing:1}}>
              ACTIVITY MONITOR
            </div>
            <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:2}}>
              ENTERPRISE AUDIT · ADMIN ONLY
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div onClick={()=>setAutoRefresh(!autoRefresh)}
            style={{fontSize:9,padding:"4px 10px",borderRadius:6,cursor:"pointer",
              background:autoRefresh?"#10b98122":"#0f2a3a",
              border:"1px solid "+(autoRefresh?"#10b98144":"#1e3a5f"),
              color:autoRefresh?"#10b981":"#4a8a9a",fontWeight:700}}>
            {autoRefresh?"⟳ AUTO":"⟳ OFF"}
          </div>
          <button onClick={fetchLogs}
            style={{fontSize:9,padding:"4px 10px",borderRadius:6,cursor:"pointer",
              background:"#22d3ee22",border:"1px solid #22d3ee44",
              color:"#22d3ee",fontWeight:700}}>
            Refresh
          </button>
        </div>
      </div>

      <div style={{padding:14,display:"flex",flexDirection:"column",gap:12}}>

        {/* Stats */}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <StatCard label="Total Events"  value={stats.total}    color="#22d3ee"/>
          <StatCard label="Logins"        value={stats.logins}   color="#10b981"/>
          <StatCard label="Files"         value={stats.files}    color="#8b5cf6"/>
          <StatCard label="Exports"       value={stats.exports}  color="#f59e0b"/>
          <StatCard label="Errors"        value={stats.errors}   color="#ef4444"/>
          <StatCard label="Sessions"      value={stats.sessions} color="#6366f1"/>
          <StatCard label="Unique Users"  value={uniqueUsers.length} color="#22d3ee"/>
        </div>

        {/* Filters */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",borderRadius:10,padding:12}}>
          <div style={{fontSize:9,color:"#4a8a9a",marginBottom:8,letterSpacing:1}}>FILTERS</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <select value={filter.module}
              onChange={e=>setFilter(f=>({...f,module:e.target.value}))}
              style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                padding:"5px 8px",color:"#a0c4cc",fontSize:10,fontFamily:"monospace"}}>
              <option value="">All Modules</option>
              {uniqueModules.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filter.eventType}
              onChange={e=>setFilter(f=>({...f,eventType:e.target.value}))}
              style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                padding:"5px 8px",color:"#a0c4cc",fontSize:10,fontFamily:"monospace"}}>
              <option value="">All Events</option>
              {uniqueEvents.map(e=><option key={e} value={e}>{e}</option>)}
            </select>
            <input placeholder="Filter by email..."
              value={filter.user}
              onChange={e=>setFilter(f=>({...f,user:e.target.value}))}
              style={{background:"#050d14",border:"1px solid #0f2a3a",borderRadius:6,
                padding:"5px 8px",color:"#a0c4cc",fontSize:10,fontFamily:"monospace",
                minWidth:160}}/>
            <button onClick={()=>setFilter({module:"",eventType:"",user:""})}
              style={{background:"#0f2a3a",border:"1px solid #1e3a5f",borderRadius:6,
                padding:"5px 10px",cursor:"pointer",color:"#94a3b8",fontSize:9}}>
              Clear
            </button>
          </div>
        </div>

        {/* Events Table */}
        <div style={{background:"#060e16",border:"1px solid #0f2a3a",
          borderRadius:12,overflow:"hidden"}}>
          <div style={{display:"grid",
            gridTemplateColumns:"140px 1fr 80px 100px 90px 70px",
            padding:"8px 12px",borderBottom:"1px solid #0f2a3a",background:"#050d14"}}>
            {["EVENT","USER","MODULE","DEVICE","OS","TIME"].map(h=>(
              <div key={h} style={{fontSize:8,color:"#4a8a9a"}}>{h}</div>
            ))}
          </div>

          {loading ? (
            <div style={{padding:24,textAlign:"center",color:"#4a8a9a",fontSize:10}}>
              Loading events...
            </div>
          ) : logs.length === 0 ? (
            <div style={{padding:24,textAlign:"center",color:"#4a8a9a",fontSize:10}}>
              No events found
            </div>
          ) : (
            <div style={{maxHeight:500,overflowY:"auto"}}>
              {logs.map((log,i)=>{
                const ec = EVENT_COLORS[log.event_type] || "#4a8a9a";
                return (
                  <div key={log.id||i} style={{display:"grid",
                    gridTemplateColumns:"140px 1fr 80px 100px 90px 70px",
                    padding:"7px 12px",borderBottom:"1px solid #0a1a24",
                    background:i%2===0?"#060e16":"#050d14",alignItems:"center"}}>
                    {/* Event */}
                    <div>
                      <span style={{fontSize:8,color:ec,background:ec+"22",
                        padding:"1px 5px",borderRadius:3,fontWeight:700}}>
                        {log.event_type?.replace(/_/g," ").toUpperCase()}
                      </span>
                    </div>
                    {/* User */}
                    <div style={{fontSize:9,color:"#a0c4cc",overflow:"hidden",
                      textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}
                      title={log.user_email}>
                      {log.user_email || "—"}
                      {log.role && <span style={{fontSize:7,color:"#4a8a9a",
                        marginLeft:4}}>({log.role})</span>}
                    </div>
                    {/* Module */}
                    <div style={{fontSize:9,color:"#4a8a9a"}}>{log.module||"—"}</div>
                    {/* Device */}
                    <div style={{fontSize:9,color:"#4a8a9a",overflow:"hidden",
                      textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                      title={log.device_type}>
                      {log.device_type||"—"}
                    </div>
                    {/* OS */}
                    <div style={{fontSize:9,color:"#4a8a9a",overflow:"hidden",
                      textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                      title={log.os}>
                      {log.os||"—"}
                    </div>
                    {/* Time */}
                    <div style={{fontSize:9,color:"#2a5a6a"}}
                      title={new Date(log.created_at).toLocaleString()}>
                      {timeAgo(log.created_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Session Timeline */}
        {logs.length > 0 && (
          <div style={{background:"#060e16",border:"1px solid #0f2a3a",
            borderRadius:12,padding:14}}>
            <div style={{fontSize:9,color:"#4a8a9a",letterSpacing:1,marginBottom:10}}>
              TOP USERS BY ACTIVITY
            </div>
            {Object.entries(
              logs.reduce((acc, l) => {
                const k = l.user_email || "anonymous";
                if (!acc[k]) acc[k] = { count:0, lastSeen:"", role:"" };
                acc[k].count++;
                if (!acc[k].lastSeen || l.created_at > acc[k].lastSeen)
                  acc[k].lastSeen = l.created_at;
                acc[k].role = l.role || "";
                return acc;
              }, {} as Record<string,{count:number,lastSeen:string,role:string}>)
            )
            .sort((a,b) => b[1].count - a[1].count)
            .slice(0,5)
            .map(([email, data], i) => (
              <div key={email} style={{display:"flex",alignItems:"center",
                gap:10,marginBottom:8}}>
                <div style={{fontSize:9,color:"#4a8a9a",minWidth:16}}>{i+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:10,color:"#a0c4cc"}}>{email}</div>
                  <div style={{height:3,background:"#0f2a3a",borderRadius:2,marginTop:3}}>
                    <div style={{height:"100%",borderRadius:2,background:"#22d3ee",
                      width:`${Math.min(100,(data.count/logs.length)*100*3)}%`}}/>
                  </div>
                </div>
                <div style={{fontSize:9,color:"#22d3ee",fontWeight:700,minWidth:30}}>
                  {data.count}
                </div>
                <div style={{fontSize:8,color:"#4a8a9a",minWidth:50}}>
                  {timeAgo(data.lastSeen)}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
