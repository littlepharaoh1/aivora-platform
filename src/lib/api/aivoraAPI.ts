/**
 * aivoraAPI.ts — Aivora Platform API Layer
 * Centralized API interface for all platform operations
 */

import { supabase } from "../supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data:    T | null;
  error:   string | null;
  success: boolean;
}

export interface UserProfile {
  id:         string;
  email:      string;
  role:       "owner" | "admin" | "user";
  createdAt:  string;
  lastSeen:   string;
  usage: {
    filesProcessed: number;
    totalMinutes:   number;
    benchmarkRuns:  number;
  };
}

export interface ProcessingJob {
  id:          string;
  userId:      string;
  fileName:    string;
  status:      "queued"|"running"|"done"|"failed";
  score:       number;
  lufs:        number;
  snrDb:       number;
  createdAt:   string;
  completedAt: string;
}

export interface UsageStats {
  totalJobs:      number;
  passedJobs:     number;
  failedJobs:     number;
  avgScore:       number;
  totalMinutes:   number;
  lastActivity:   string;
}

// ── Auth API ──────────────────────────────────────────────────────────────────

export const authAPI = {
  async signIn(email: string, password: string): Promise<ApiResponse<UserProfile>> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email, password
      });
      if(error) return { data:null, error:error.message, success:false };
      const profile = await authAPI.getProfile(data.user.id);
      return { data:profile.data, error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Auth failed", success:false };
    }
  },

  async signOut(): Promise<ApiResponse<null>> {
    try {
      await supabase.auth.signOut();
      return { data:null, error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Sign out failed", success:false };
    }
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async getProfile(userId: string): Promise<ApiResponse<UserProfile>> {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if(error) return { data:null, error:error.message, success:false };
      return { data, error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  },

  async onAuthChange(callback: (user: UserProfile|null) => void) {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if(session?.user) {
        const profile = await authAPI.getProfile(session.user.id);
        callback(profile.data);
      } else {
        callback(null);
      }
    });
  }
};

// ── Jobs API ──────────────────────────────────────────────────────────────────

export const jobsAPI = {
  async createJob(job: Omit<ProcessingJob,"id"|"createdAt"|"completedAt">): Promise<ApiResponse<ProcessingJob>> {
    try {
      const { data, error } = await supabase
        .from("processing_jobs")
        .insert([{ ...job, created_at: new Date().toISOString() }])
        .select()
        .single();
      if(error) return { data:null, error:error.message, success:false };
      return { data, error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  },

  async updateJob(id: string, updates: Partial<ProcessingJob>): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from("processing_jobs")
        .update(updates)
        .eq("id", id);
      if(error) return { data:null, error:error.message, success:false };
      return { data:null, error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  },

  async getJobs(userId: string, limit=50): Promise<ApiResponse<ProcessingJob[]>> {
    try {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending:false })
        .limit(limit);
      if(error) return { data:null, error:error.message, success:false };
      return { data: data ?? [], error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  },

  async getUsageStats(userId: string): Promise<ApiResponse<UsageStats>> {
    try {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("status,score,created_at")
        .eq("user_id", userId);
      if(error) return { data:null, error:error.message, success:false };

      const jobs = data ?? [];
      const passed = jobs.filter((j: {status:string}) => j.status==="done").length;
      const failed = jobs.filter((j: {status:string}) => j.status==="failed").length;
      const scores = jobs.filter((j: {score:number}) => j.score>0).map((j: {score:number}) => j.score);
      const avgScore = scores.length>0 ? scores.reduce((a:number,b:number)=>a+b)/scores.length : 0;

      return {
        data: {
          totalJobs:    jobs.length,
          passedJobs:   passed,
          failedJobs:   failed,
          avgScore:     Math.round(avgScore),
          totalMinutes: jobs.length * 2,
          lastActivity: jobs[0]?.created_at ?? "",
        },
        error:null, success:true
      };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  }
};

// ── Bench API ─────────────────────────────────────────────────────────────────

export const benchAPI = {
  async saveResult(result: {
    taskId: string; userId: string; score: number;
    passed: boolean; grade: string; hash: string;
  }): Promise<ApiResponse<null>> {
    try {
      const { error } = await supabase
        .from("bench_results")
        .insert([{ ...result, created_at: new Date().toISOString() }]);
      if(error) return { data:null, error:error.message, success:false };
      return { data:null, error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  },

  async getLeaderboard(taskId: string): Promise<ApiResponse<{userId:string;score:number;grade:string}[]>> {
    try {
      const { data, error } = await supabase
        .from("bench_results")
        .select("user_id,score,grade")
        .eq("task_id", taskId)
        .order("score", { ascending:false })
        .limit(20);
      if(error) return { data:null, error:error.message, success:false };
      return { data: (data ?? []).map((r: {user_id:string;score:number;grade:string}) => ({userId:r.user_id,score:r.score,grade:r.grade})), error:null, success:true };
    } catch(e: unknown) {
      return { data:null, error: e instanceof Error ? e.message : "Failed", success:false };
    }
  }
};
