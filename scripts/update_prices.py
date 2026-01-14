import os
import time
from supabase import create_client, Client
import yfinance as yf
from dotenv import load_dotenv  # <--- 新增這行

load_dotenv('.env') 

# 2. 讀取變數
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not key:
    print("⚠️ 警告：未找到 SUPABASE_SERVICE_ROLE_KEY，正在使用 ANON_KEY (可能會因 RLS 讀不到資料)")
    key = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    raise ValueError("❌ 找不到 Supabase URL 或 Key，請檢查 .env.local 檔案")
    
supabase: Client = create_client(url, key)
def update_prices():
    print("🚀 開始更新股價...")
    
    # 1. 從資料庫抓出所有持倉的股票代號
    # 這裡我們用 distinct 避免重複抓取同一隻股票
    response = supabase.from_("positions").select("symbol").execute()
    positions = response.data
    if not positions:
        print("沒有持倉需要更新")
        return

    # 取得唯一的代號列表 (例如 ['AAPL', 'TSLA'])
    unique_symbols = list(set([p['symbol'] for p in positions]))
    print(f"📋 監控清單: {unique_symbols}")

    # 2. 透過 yfinance 批量抓取現價
    # yfinance 允許一次抓多隻 (e.g. "AAPL TSLA")
    tickers_str = " ".join(unique_symbols)
    tickers = yf.Tickers(tickers_str)

    for symbol in unique_symbols:
        try:
            # 抓取單隻股票資訊
            ticker = tickers.tickers[symbol]
            # yfinance 的 fast_info 通常比 history 更快
            current_price = ticker.fast_info['last_price'] 
            
            if current_price:
                print(f"💰 {symbol} 現價: ${current_price:.2f}")

                # 3. 更新資料庫
                # 這裡會更新所有該代號的持倉 (不管是用戶 A 還是用戶 B 持有)
                data, count = supabase.from_("positions") \
                    .update({"current_price": current_price, "updated_at": "now()"}) \
                    .eq("symbol", symbol) \
                    .execute()
        except Exception as e:
            print(f"❌ 更新 {symbol} 失敗: {e}")

    print("✅ 所有股價更新完畢！")

if __name__ == "__main__":
    # 你可以設個迴圈讓它每分鐘跑一次，或者手動執行
    while True:
        update_prices()
        print("😴 休息 60 秒...")
        time.sleep(60)