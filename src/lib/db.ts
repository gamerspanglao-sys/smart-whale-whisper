import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export const supabase = createClient<Database>(
  "https://hcrffntjzzlpjhzsppna.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjcmZmbnRqenpscGpoenNwcG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNTg0MzIsImV4cCI6MjA4NDczNDQzMn0.l9OcL2Ma5iHPtoK9ori5bTkil1iuNRre06Pe0h1YN3E",
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
