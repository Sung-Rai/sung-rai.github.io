import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Replace these with your own Supabase project values.
// Use the project URL and publishable/anon key.
// NEVER put the service_role key in frontend code.
const SUPABASE_URL = "https://sdhxraanxtqoittzpwln.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_m1FZ0SosijfqnKiS3czyEQ_W42z25UQ";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);