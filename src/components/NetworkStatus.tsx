// @ts-nocheck
/**
 * NetworkStatus.tsx — Network indicator + offline queue status
 */
import React, { useState, useEffect } from "react";
import { getQueue, getPendingCount } from "../lib/offline/offlineQueue";
import { trackEvent } from "../lib/tracking/activityTracker";
import { useAuth } from "../lib/auth/AuthContext";

export default function NetworkStatus() {
  const [online,  setOnline]  = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(getPendingCount());
  const { user } = useAuth();

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      setPending(getPendingCount());
      trackEvent({
        eventType: "app_loaded",
        module:    "network",
        userId:    user?.uid,
        userEmail: user?.email,
        metadata:  { network: "online" },
      });
      // Trigger sync
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready.then(sw => {
          sw.sync.register("aivora-sync").catch(() => {});
        });
      }
    }

    function handleOffline() {
      setOnline(false);
      trackEvent({
        eventType: "error_occurred",
        module:    "network",
        userId:    user?.uid,
        userEmail: user?.email,
        metadata:  { network: "offline" },
      });
    }

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for SW sync messages
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", e => {
        if (e.data?.type === "SYNC_QUEUE") {
          setSyncing(true);
          setTimeout(() => { setSyncing(false); setPending(0); }, 2000);
        }
      });
    }

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [user]);

  // Refresh pending count
  useEffect(() => {
    const interval = setInterval(() => setPending(getPendingCount()), 5000);
    return () => clearInterval(interval);
  }, []);

  const color  = !online ? "#ef4444" : syncing ? "#f59e0b" : "#10b981";
  const label  = !online ? "Offline" : syncing ? "Syncing..." : "Online";
  const dot    = !online ? "●" : syncing ? "◌" : "●";

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,
      padding:"3px 8px",borderRadius:20,
      background:color+"11",border:"1px solid "+color+"33"}}>
      <span style={{color,fontSize:8,animation:syncing?"spin 1s linear infinite":undefined}}>
        {dot}
      </span>
      <span style={{fontSize:8,color,fontFamily:"monospace",fontWeight:700}}>
        {label}
      </span>
      {pending > 0 && (
        <span style={{fontSize:7,color:"#f59e0b",background:"#f59e0b22",
          padding:"1px 5px",borderRadius:3}}>
          {pending} queued
        </span>
      )}
    </div>
  );
}
