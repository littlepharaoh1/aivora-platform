// @ts-nocheck
/**
 * Contributors.tsx — Team Management Dashboard
 * Pulls real data from Supabase profiles table
 */
import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface Profile {
  id:               string;
  email:            string;
  role:             "owner"|"admin"|"user";
  created_at:       string;
  last_seen:        string;
  files_processed:  number;
  total_minutes:    number;
  benchmark_runs:   number;
}

const ROLE_COLORS = {
  owner: "#F59E0B",
  admin: "#0EA5E9",
  user:  "#10B981",
};

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role as keyof typeof ROLE_COLORS] ?? "#4a6a7a";
  return (
    <span style={{ fontSize:8, padding:"2px 8px", borderRadius:4,
      background:`${color}20`, color, border:`1px solid ${color}40`,
      fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>
      {role}
    </span>
  );
}

export default function Contributors() {
  const [profiles,  setProfiles]  = useState<Profile[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [roleFilter,setRoleFilter]= useState<"all"|"owner"|"admin"|"user">("all");
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    fetchProfiles();
    // Use getSession instead of getUser to avoid redirect
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUser(data.session?.user ?? null);
    });

    const sub = supabase
      .channel("profiles_changes")
      .on("postgres_changes", { event:"*", schema:"public", table:"profiles" },
        () => fetchProfiles())
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  async function fetchProfiles() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending:false });
      if(!error) setProfiles(data ?? []);
    } catch(e) { console.warn("Profiles fetch:", e); }
    setLoading(false);
  }

  async function updateRole(id: string, role: string) {
    if(currentUser?.email !== "zikaaaa460@gmail.com") return;
    await supabase.from("profiles").update({ role }).eq("id", id);
    fetchProfiles();
  }

  const filtered = profiles.filter(p => {
    const matchSearch = !search ||
      p.email.toLowerCase().includes(search.toLowerCase());
    const matchRole   = roleFilter === "all" || p.role === roleFilter;
    return matchSearch && matchRole;
  });

  const isOwner = currentUser?.email === "zikaaaa460@gmail.com";

  const stats = {
    total:  profiles.length,
    owners: profiles.filter(p=>p.role==="owner").length,
    admins: profiles.filter(p=>p.role==="admin").length,
    users:  profiles.filter(p=>p.role==="user").length,
  };

  return (
    <div style={{ height:"100%", overflow:"auto", background:"#020608",
      fontFamily:"'JetBrains Mono',monospace", color:"#a0c4cc", padding:16 }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:9, color:"#2a6a8a", letterSpacing:3, marginBottom:4 }}>
          CONTRIBUTORS
        </div>
        <div style={{ fontSize:18, fontWeight:700, color:"#E2EEF6" }}>
          Team Management
        </div>
        <div style={{ fontSize:10, color:"#4a6a7a", marginTop:2 }}>
          Supabase profiles · Real-time updates · Role management
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        {[
          { l:"Total",  v:stats.total,  c:"#0EA5E9" },
          { l:"Owners", v:stats.owners, c:"#F59E0B" },
          { l:"Admins", v:stats.admins, c:"#0EA5E9" },
          { l:"Users",  v:stats.users,  c:"#10B981" },
        ].map(({l,v,c})=>(
          <div key={l} style={{ background:"#050d18",
            border:`1px solid ${c}30`, borderTop:`2px solid ${c}`,
            borderRadius:8, padding:"10px 14px", minWidth:80 }}>
            <div style={{ fontSize:20, fontWeight:700, color:c }}>{v}</div>
            <div style={{ fontSize:8, color:"#4a6a7a", letterSpacing:1 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search by email..."
          style={{ flex:1, minWidth:200, background:"#030810",
            border:"1px solid #1a3a5a", borderRadius:6,
            padding:"6px 10px", color:"#E2EEF6", fontSize:10,
            fontFamily:"inherit", outline:"none" }}/>
        {(["all","owner","admin","user"] as const).map(r=>(
          <div key={r} onClick={()=>setRoleFilter(r)}
            style={{ fontSize:9, padding:"4px 10px", borderRadius:4,
              cursor:"pointer",
              background:roleFilter===r?"#0EA5E922":"transparent",
              color:roleFilter===r?"#0EA5E9":"#2a5a6a",
              border:`1px solid ${roleFilter===r?"#0EA5E9":"#1a3a5a"}` }}>
            {r}
          </div>
        ))}
        <button onClick={fetchProfiles}
          style={{ fontSize:9, padding:"4px 10px", borderRadius:4,
            background:"transparent", border:"1px solid #1a3a5a",
            color:"#4a6a7a", cursor:"pointer", fontFamily:"inherit" }}>
          ↻
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ fontSize:10, color:"#2a5a6a", textAlign:"center", padding:20 }}>
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize:10, color:"#2a5a6a", textAlign:"center",
          padding:30, border:"1px solid #0a1520", borderRadius:8 }}>
          {profiles.length === 0
            ? "No contributors yet. Users appear here after signing up."
            : "No results matching your search."}
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {filtered.map(p => (
            <div key={p.id} style={{
              background:"#050d18",
              border:`1px solid ${ROLE_COLORS[p.role]||"#0f2030"}30`,
              borderLeft:`3px solid ${ROLE_COLORS[p.role]||"#4a6a7a"}`,
              borderRadius:8, padding:"12px 14px",
              display:"flex", alignItems:"center",
              gap:12, flexWrap:"wrap",
            }}>
              {/* Avatar */}
              <div style={{
                width:36, height:36, borderRadius:8,
                background:`${ROLE_COLORS[p.role]||"#4a6a7a"}20`,
                border:`1px solid ${ROLE_COLORS[p.role]||"#4a6a7a"}40`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:14, fontWeight:700,
                color:ROLE_COLORS[p.role]||"#4a6a7a",
                flexShrink:0,
              }}>
                {p.email[0].toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex:1, minWidth:150 }}>
                <div style={{ fontSize:11, fontWeight:700,
                  color:"#E2EEF6", marginBottom:3 }}>
                  {p.email}
                </div>
                <div style={{ fontSize:8, color:"#2a5a6a" }}>
                  Joined {new Date(p.created_at).toLocaleDateString()}
                  {p.last_seen && ` · Last seen ${new Date(p.last_seen).toLocaleDateString()}`}
                </div>
              </div>

              {/* Stats */}
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {[
                  { l:"Files",     v:p.files_processed||0,  c:"#0EA5E9" },
                  { l:"Minutes",   v:p.total_minutes||0,    c:"#8B5CF6" },
                  { l:"Benchmarks",v:p.benchmark_runs||0,   c:"#10B981" },
                ].map(({l,v,c})=>(
                  <div key={l} style={{ textAlign:"center",
                    padding:"4px 8px", borderRadius:6,
                    background:`${c}10`, border:`1px solid ${c}20` }}>
                    <div style={{ fontSize:12, fontWeight:700, color:c }}>{v}</div>
                    <div style={{ fontSize:7, color:"#4a6a7a" }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Role */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <RoleBadge role={p.role}/>

                {/* Role change (owner only) */}
                {isOwner && p.email !== currentUser?.email && (
                  <select
                    value={p.role}
                    onChange={e=>updateRole(p.id, e.target.value)}
                    style={{ fontSize:9, background:"#030810",
                      border:"1px solid #1a3a5a", borderRadius:4,
                      color:"#4a6a7a", padding:"2px 4px",
                      fontFamily:"inherit", cursor:"pointer" }}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop:16, paddingTop:12,
        borderTop:"1px solid #0a1520",
        fontSize:8, color:"#1a3a5a", letterSpacing:1 }}>
        AIVORA CONTRIBUTORS · SUPABASE REALTIME ·
        {isOwner ? " OWNER MODE — ROLE MANAGEMENT ENABLED" : " READ-ONLY"}
      </div>
    </div>
  );
}
