console.log('ENV URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('ENV KEY:', import.meta.env.VITE_SUPABASE_ANON_KEY);

import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
