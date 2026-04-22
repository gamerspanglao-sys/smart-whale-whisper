import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Direct connection to project — Lovable build env vars are intentionally bypassed
const SUPABASE_URL = "https://hcrffntjzzlpjhzsppna.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcmZmbnRqenpscGpoenNwcG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNTg0MzIsImV4cCI6MjA4NDczNDQzMn0.l9OcL2Ma5iHPtoK9ori5bTkil1iuNRre06Pe0h1YN3E";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});