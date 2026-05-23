import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://cjhmhbyjlswugerqdbuv.supabase.co";
const supabaseKey = "sb_publishable_tQEhehKOcl3VGGCEehth-Q_-W-mQ2Ns";

export const supabase = createClient(supabaseUrl, supabaseKey);
;