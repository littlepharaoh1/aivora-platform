import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Handle OAuth redirect hash BEFORE creating client
const hasOAuthToken = window.location.hash.includes("access_token");

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: hasOAuthToken, // true only during OAuth redirect
    persistSession:     true,
    autoRefreshToken:   true,
  }
});

// Clear hash after Supabase reads it
if(hasOAuthToken) {
  setTimeout(() => {
    window.history.replaceState({}, "", window.location.pathname);
  }, 500);
}
