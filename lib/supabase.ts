import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Position = {
  id: string;
  symbol: string;
  price: number;
  avg_price: number;
  quantity: number;
  purchase_date: string;
  created_at: string;
  updated_at: string;
};
