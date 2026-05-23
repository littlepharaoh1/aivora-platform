// Node.js test setup — shim import.meta.env
(globalThis as any).import = {
  meta: {
    env: {
      VITE_SUPABASE_URL:      "http://localhost:54321",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    }
  }
};
