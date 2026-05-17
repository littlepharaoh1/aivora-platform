/**
 * useAuth.ts — Authentication Hook
 */
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";

export interface AuthState {
  user:    User | null;
  loading: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser]       = useState<User|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  const email  = user?.email ?? "";
  const isOwner = email === "zikaaaa460@gmail.com";
  const isAdmin = email === "aivoraailtduk@gmail.com" || isOwner;

  return { user, loading, isOwner, isAdmin };
}
