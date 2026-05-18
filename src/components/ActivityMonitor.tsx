// @ts-nocheck
/**
 * ActivityMonitor.tsx — Real-time Platform Activity Dashboard
 * Pulls live data from Supabase processing_jobs + bench_results
 */
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface Job {
  id: string; file_name: string; status: string;
  score: number; lufs: number; snr_db: number; created_at: string;
}
interface Stats {
  total: number; passed: number; failed: number;
  avgScore: number; avgLufs: number;
}

function StatCard({ label, value, color }: { label:string; value:string|number; color:string }) {
  return (
    <div style={{ background:"#050d18", border:`1px solid ${color}30`,
      borderTop:`2px solid ${color}`, borderRadius:8, padding:"10px 14px" }}>
      <div style={{ fontSize:20, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:8, color:"#4a6a7a", letterSpacing:1 }}>{label}</div>
    </div>
  );
}

export default function ActivityMonitor() {
  const [jobs,    setJobs]    = useState<Job[]>([]);
  const [stats,   setStats]   = useState<Stats>({ total:0,passed:0,failed:0,avgScore:0,avgLufs:0 });
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<"all"|"done"|"failed">("all");

  async function fetchData() {
    setLoading(true);
    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();

      let query = supabase
        .from("processing_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      // Non-owners see only their own jobs
      if(session?.user?.email !== "zikaaaa460@gmail.com" &&
         session?.user?.email !== "aivoraailtduk@gmail.com") {
        query = query.eq("user_id", session?.user?.id ?? "none");
      }

      const { data } = await query;

      const jobs = data ?? [];
      setJobs(jobs);

      const passed   = jobs.filter((j:Job) => j.status === "done").length;
      const failed   = jobs.filter((j:Job) => j.status === "failed").length;
      const scores   = jobs.filter((j:Job) => j.score > 0).map((j:Job) => j.score);
      const lufsArr  = jobs.filter((j:Job) => j.lufs && j.lufs > -100).map((j:Job) => j.lufs);
      setStats({
        total:    jobs.length,
        passed,   failed,
        avgScore: scores.length  ? Math.round(scores.reduce((a:number,b:number)=>a+b)/scores.length) : 0,
        avgLufs:  lufsArr.length ? Math.round(lufsArr.reduce((a:number,b:number)=>a+b)/lufsArr.length*10)/10 : 0,
      });
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => {
    fetchData();
    // Realtime subscription
    const sub = supabase
      .channel("jobs_changes")
      .on("postgres_changes", { event:"*", schema:"public", table:"processing_jobs" },
        () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  const filtered = jobs.filter(j =>
    filter === "all" ? true : j.status === filter
  );

  const statusColor = (s:string) =>
    s==="done"?"#10B981":s==="failed"?"#EF4444":s==="running"?"#F59E0B":"#4a6a7a";

  return (
    <div style={{ height:"100%", overflow:"auto", background:"#020608",
      fontFamily:"'JetBrains Mono',monospace", color:"#a0c4cc", padding:16 }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:9, color:"#2a6a8a", letterSpacing:3, marginBottom:4 }}>
          ACTIVITY MONITOR
        </div>
        <div style={{ fontSize:18, fontWeight:700, color:"#E2EEF6" }}>
          Platform Activity
        </div>
        <div style={{ fontSize:10, color:"#4a6a7a", marginTop:2 }}>
          Real-time processing jobs • Supabase live updates
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <StatCard label="Total Jobs"  value={stats.total}   color="#0EA5E9"/>
        <StatCard label="Passed"      value={stats.passed}  color="#10B981"/>
        <StatCard label="Failed"      value={stats.failed}  color="#EF4444"/>
        <StatCard label="Avg Score"   value={stats.avgScore>0?`${stats.avgScore}/100`:"—"} color="#F59E0B"/>
        <StatCard label="Avg LUFS"    value={stats.avgLufs!==0?`${stats.avgLufs}`:"—"} color="#8B5CF6"/>
        <StatCard label="Pass Rate"   value={stats.total>0?`${Math.round(stats.passed/stats.total*100)}%`:"—"} color="#22d3ee"/>
      </div>

      {/* Filter */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        {(["all","done","failed"] as const).map(f => (
          <div key={f} onClick={()=>setFilter(f)}
            style={{ fontSize:9, padding:"4px 10px", borderRadius:4, cursor:"pointer",
              background:filter===f?"#0EA5E922":"transparent",
              color:filter===f?"#0EA5E9":"#2a5a6a",
              border:`1px solid ${filter===f?"#0EA5E9":"#1a3a5a"}` }}>
            {f.toUpperCase()} ({f==="all"?jobs.length:jobs.filter(j=>j.status===f).length})
          </div>
        ))}
        <button onClick={fetchData}
          style={{ marginLeft:"auto", fontSize:9, padding:"4px 10px", borderRadius:4,
            background:"transparent", border:"1px solid #1a3a5a",
            color:"#4a6a7a", cursor:"pointer", fontFamily:"inherit" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Jobs Table */}
      {loading ? (
        <div style={{ fontSize:10, color:"#2a5a6a", padding:20, textAlign:"center" }}>
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize:10, color:"#2a5a6a", padding:20, textAlign:"center",
          border:"1px solid #0a1520", borderRadius:8 }}>
          No jobs yet. Process audio files to see activity here.
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {filtered.map(job => (
            <div key={job.id} style={{
              background:"#050d18", border:"1px solid #0f2030",
              borderLeft:`3px solid ${statusColor(job.status)}`,
              borderRadius:8, padding:"10px 12px",
              display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
            }}>
              <div style={{ flex:1, minWidth:120 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#E2EEF6",
                  marginBottom:2, wordBreak:"break-all" }}>
                  {job.file_name}
                </div>
                <div style={{ fontSize:8, color:"#2a5a6a" }}>
                  {new Date(job.created_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
                  background:`${statusColor(job.status)}20`,
                  color:statusColor(job.status),
                  border:`1px solid ${statusColor(job.status)}40` }}>
                  {job.status.toUpperCase()}
                </span>
                {job.score > 0 && (
                  <span style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
                    background:"#F59E0B20", color:"#F59E0B",
                    border:"1px solid #F59E0B40" }}>
                    {job.score}/100
                  </span>
                )}
                {job.lufs && job.lufs > -100 && (
                  <span style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
                    background:"#8B5CF620", color:"#8B5CF6",
                    border:"1px solid #8B5CF640" }}>
                    {job.lufs.toFixed(1)} LUFS
                  </span>
                )}
                {job.snr_db > 0 && (
                  <span style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
                    background:"#0EA5E920", color:"#0EA5E9",
                    border:"1px solid #0EA5E940" }}>
                    {job.snr_db.toFixed(1)}dB SNR
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop:16, padding:"10px 0", borderTop:"1px solid #0a1520",
        fontSize:8, color:"#1a3a5a", letterSpacing:1 }}>
        AIVORA ACTIVITY MONITOR · SUPABASE REALTIME · LIVE
      </div>
    </div>
  );
}
