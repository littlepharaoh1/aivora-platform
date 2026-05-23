// Shim import.meta.env for Node.js test environment
import { register } from 'node:module';

const _env = {
  VITE_SUPABASE_URL: 'http://localhost:54321',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
};

// Patch globalThis
globalThis.__vite_meta_env__ = _env;
