import { createClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL; const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key) throw new Error('缺少 Supabase 环境变量');
export const supabase=createClient(url,key);
