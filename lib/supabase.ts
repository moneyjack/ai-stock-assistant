import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Position = {
  id: number;
  user_id: string;
  symbol: string;
  avg_price: number;
  quantity: number;
  // --- 確保加上這行 ---
  current_price?: number; // 加個 ? 代表可能是 null (剛買入還沒更新時)
  // ------------------
  created_at: string;
};

// 確保你有這個 Type 定義
export type TradeHistory = {
  id: number;
  symbol: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl_amount?: number; // 如果資料庫有自動算
  pnl_percent?: number;
  entry_date: string;
  exit_date: string;
  reason_for_exit: string;
};