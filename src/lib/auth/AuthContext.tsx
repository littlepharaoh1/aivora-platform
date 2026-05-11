/**
 * AuthContext.tsx — Supabase Auth + Role System
 * Aivora Platform Enterprise Auth
 */

import React, {
  createContext, useContext, useEffect, useState, type ReactNode
} from "react";
import { supabase } from "../supabase";
import { getRoleFromEmail } from "./adminAllowlist";
import type { User, Session } from "@supabase/supabase-js";

export interface AivoraUser {
  uid:          string;
  email:        string;
  displayName:  string;
  photoURL:     string;
  role:         string;
  provider:     string;
  createdAt:    string;
  lastLoginAt:  string;
}

interface AuthContextValue {
  user:          AivoraUser | null;
  session:       Session | null;
  loading:       boolean;
  error:         string | null;
  signInGoogle:  () => Promise<void>;
  signOut:       () => Promise<void>;
  isAdmin:       boolean;
  isOwner:       boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(u: User): AivoraUser {
  const meta = u.user_metadata || {};
  return {
    uid:         u.id,
    email:       u.email ?? "",
    displayName: meta.full_name || meta.name || u.email?.split("@")[0] || "User",
    photoURL:    meta.avatar_url || meta.picture || "",
    role:        getRoleFromEmail(u.email ?? ""),
    provider:    u.app_metadata?.provider ?? "email",
    createdAt:   u.created_at ?? "",
    lastLoginAt: u.last_sign_in_at ?? "",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AivoraUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    // Restore session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setSession(data.session);
        setUser(mapUser(data.session.user));
      }
      setLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, sess) => {
        setSession(sess);
        setUser(sess?.user ? mapUser(sess.user) : null);
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  async function signInGoogle() {
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://aivora-platform.vercel.app",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (err) { setError(err.message); setLoading(false); }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }

  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const isOwner = user?.role === "owner";

  return (
    <AuthContext.Provider value={{
      user, session, loading, error,
      signInGoogle, signOut, isAdmin, isOwner,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
