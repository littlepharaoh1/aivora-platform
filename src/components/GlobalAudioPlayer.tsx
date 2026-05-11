// @ts-nocheck
/**
 * GlobalAudioPlayer.tsx — Floating audio player available in all sections
 * Aivora Platform
 */
import React, { useState, useRef, useEffect } from "react";
import { useGlobalAudio } from "../lib/store/GlobalAudioContext";
import { Play, Pause, Square, Volume2, ChevronDown, ChevronUp } from "lucide-react";

export default function GlobalAudioPlayer() {
  const { currentFile } = useGlobalAudio();
  const [playing,    setPlaying]    = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,   setDuration]   = useState(0);
  const [volume,     setVolume]     = useState(1);
  const sourceRef  = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef     = useRef<AudioContext | null>(null);
  const gainRef    = useRef<GainNode | null>(null);
  const startTimeRef = useRef(0);
  const startOffsetRef = useRef(0);
  const rafRef     = useRef<number>(0);

  // Reset when file changes
  useEffect(() => {
    stop();
    setCurrentTime(0);
    if (currentFile) setDuration(currentFile.buffer.duration);
  }, [currentFile?.name]);

  function stop() {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }

  function play(offset = startOffsetRef.current) {
    if (!currentFile) return;
    stop();

    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    const ctx  = ctxRef.current;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    gainRef.current = gain;

    const src = ctx.createBufferSource();
    src.buffer = currentFile.buffer;
    src.connect(gain);
    src.start(0, offset);
    src.onended = () => {
      if (playing) { setPlaying(false); startOffsetRef.current = 0; setCurrentTime(0); }
    };
    sourceRef.current   = src;
    startTimeRef.current = ctx.currentTime - offset;
    startOffsetRef.current = offset;
    setPlaying(true);

    function tick() {
      if (!ctxRef.current) return;
      const t = ctxRef.current.currentTime - startTimeRef.current;
      setCurrentTime(Math.min(t, currentFile.buffer.duration));
      if (t < currentFile.buffer.duration) rafRef.current = requestAnimationFrame(tick);
      else { setPlaying(false); startOffsetRef.current = 0; setCurrentTime(0); }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function pause() {
    if (!ctxRef.current) return;
    startOffsetRef.current = ctxRef.current.currentTime - startTimeRef.current;
    stop();
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = parseFloat(e.target.value);
    startOffsetRef.current = t;
    setCurrentTime(t);
    if (playing) play(t);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (gainRef.current) gainRef.current.gain.value = v;
  }

  function fmt(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  if (!currentFile) return null;

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: "linear-gradient(135deg,#060e18,#071a18)",
      borderTop: "1px solid #0f2a3a",
      fontFamily: "monospace",
    }}>
      {/* Collapse toggle */}
      <div onClick={() => setCollapsed(!collapsed)}
        style={{display:"flex",justifyContent:"center",padding:"2px",cursor:"pointer",
          borderBottom:"1px solid #0a1a24"}}>
        {collapsed
          ? <ChevronUp size={12} color="#4a8a9a"/>
          : <ChevronDown size={12} color="#4a8a9a"/>}
      </div>

      {!collapsed && <div style={{padding:"8px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        {/* File name */}
        <div style={{fontSize:10,color:"#22d3ee",minWidth:0,overflow:"hidden",
          textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>
          🎵 {currentFile.name}
        </div>

        {/* Controls */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>playing?pause():play()}
            style={{background:"#22d3ee22",border:"1px solid #22d3ee44",borderRadius:6,
              padding:"4px 10px",cursor:"pointer",color:"#22d3ee",display:"flex",alignItems:"center",gap:4}}>
            {playing ? <Pause size={12}/> : <Play size={12}/>}
          </button>
          <button onClick={()=>{stop();startOffsetRef.current=0;setCurrentTime(0);}}
            style={{background:"#0f2a3a",border:"1px solid #1a3a4a",borderRadius:6,
              padding:"4px 8px",cursor:"pointer",color:"#4a8a9a",display:"flex",alignItems:"center"}}>
            <Square size={12}/>
          </button>
        </div>

        {/* Time */}
        <span style={{fontSize:9,color:"#4a8a9a",minWidth:70}}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>

        {/* Progress */}
        <div style={{flex:1,position:"relative",minWidth:100}}>
          <div style={{height:3,background:"#0f2a3a",borderRadius:2}}>
            <div style={{height:"100%",width:pct+"%",background:"#22d3ee",borderRadius:2,transition:"width 0.1s"}}/>
          </div>
          <input type="range" min={0} max={duration} step={0.01} value={currentTime}
            onChange={seek}
            style={{position:"absolute",top:-4,left:0,right:0,width:"100%",
              opacity:0,cursor:"pointer",height:12}}/>
        </div>

        {/* Volume */}
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <Volume2 size={11} color="#4a8a9a"/>
          <input type="range" min={0} max={1} step={0.05} value={volume}
            onChange={handleVolume}
            style={{width:60,accentColor:"#22d3ee"}}/>
        </div>

        {/* Profile badge */}
        <span style={{fontSize:9,color:"#4a8a9a",background:"#0f2a3a",
          padding:"2px 8px",borderRadius:4}}>
          {currentFile.profile?.toUpperCase()}
        </span>
      </div>}
    </div>
  );
}
