import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// 介面定義
interface MarketData {
  symbol: string;
  price: number;
  change: string;
  peRatio?: number;
  marketCap?: string;
  targetPrice?: number;
  news?: string[];
  rsi?: string;  
  lastEarnings?: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- 輔助函數：動態載入 yahoo-finance2 並抓取數據 ---
async function getRichMarketData(symbol: string): Promise<MarketData> {
  console.log(`🚀 [Yahoo-2] Fetching data for ${symbol}...`);

  let yahooFinance: any;

  try {
    // 1. 動態匯入 + 強制轉型 (關鍵修正)
    // 我們加上 "as any" 告訴 TypeScript：別管這包東西原本的型別定義了，讓我自己處理。
    const pkg = await import('yahoo-finance2') as any;
    
    // 2. 暴力尋找 Class Constructor
    // 現在 TS 不會報錯了，因為 pkg 是 any 型別
    const YahooFinanceClass = pkg.YahooFinance || pkg.default?.YahooFinance || pkg.default;

    // 判斷抓到的是類別 (需要 new) 還是單例物件 (直接用)
    if (typeof YahooFinanceClass === 'function') {
        yahooFinance = new YahooFinanceClass();
    } else {
        yahooFinance = YahooFinanceClass;
    }
    
    // 抑制通知 (選用)
    if (yahooFinance && typeof yahooFinance.suppressNotices === 'function') {
        yahooFinance.suppressNotices(['yahooSurvey', 'queue']);
    }

  } catch (initError) {
    console.error("❌ Yahoo Library Init Failed:", initError);
    return { symbol, price: 0, change: 'InitError', news: [], lastEarnings: "系統錯誤" };
  }

  try {
    // A. 抓取核心數據
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: [
        'price', 
        'summaryDetail', 
        'defaultKeyStatistics', 
        'financialData', 
        'earnings', 
        'recommendationTrend'
      ]
    });

    // B. 抓取新聞
    const newsResult = await yahooFinance.search(symbol, { newsCount: 3 });
    const newsTitles = newsResult.news.map((n: any) => `[新聞] ${n.title}`);

    // C. 抓取歷史股價
    // 使用 as any 避開 TypeScript 型別錯誤
    // C. 抓取歷史股價 (修正 range 報錯問題)
    // Yahoo-finance2 強制要求 period1 (起始日)，我們手動計算 20 天前 (確保有足夠交易日)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // 抓 30 天比較保險，因為有假日

    // 使用 as any 避開型別檢查
    // 我們改用 period1，並移除 range
    const chartData = await yahooFinance.chart(symbol, { 
        period1: startDate.toISOString().split('T')[0], // 格式: YYYY-MM-DD
        interval: '1d' 
    }) as any;
    
    // 計算簡單趨勢
    let trend = "盤整中";
    if (chartData && chartData.quotes && chartData.quotes.length >= 2) {
        const quotes = chartData.quotes;
        const lastClose = quotes[quotes.length - 1].close;
        const prevClose = quotes[quotes.length - 2].close;
        
        if (lastClose && prevClose) {
            trend = lastClose > prevClose ? "短期看漲 (Up)" : "短期看跌 (Down)";
        }
    }

    // D. 處理財報
    let earningsStr = "財報數據暫缺";
    try {
        const history = result.earnings?.earningsChart?.quarterly;
        
        if (history && history.length > 0) {
            const latest = history.slice().reverse().find((q: any) => q.actual !== undefined && q.actual !== null);
            if (latest) {
                const actual = latest.actual;
                const estimate = latest.estimate;
                const date = latest.date;
                
                const diff = ((actual - estimate) / Math.abs(estimate)) * 100;
                const status = diff > 0 ? "優於預期 (Beat)" : "低於預期 (Miss)";
                
                earningsStr = `${date} 季報: EPS ${actual} vs 預測 ${estimate} (${status} ${Math.abs(diff).toFixed(1)}%)`;
            }
        }
    } catch (e) {
        console.warn("Earnings process error:", e);
    }

    return {
      symbol,
      price: result.financialData?.currentPrice || 0,
      change: result.financialData?.recommendationKey || "Hold",
      peRatio: result.summaryDetail?.trailingPE || 0,
      marketCap: result.summaryDetail?.marketCap ? (result.summaryDetail.marketCap / 1000000000).toFixed(2) + "B" : "N/A",
      targetPrice: result.financialData?.targetMeanPrice || 0,
      news: newsTitles,
      rsi: trend,
      lastEarnings: earningsStr
    };

  } catch (error: any) {
    console.error(`❌ [Yahoo-2] Fetch Error for ${symbol}:`, error.message);
    return { symbol, price: 0, change: 'N/A', news: [], lastEarnings: "數據抓取失敗" };
  }
}

export async function POST(req: Request) {
    try {
        const { messages, user_id } = await req.json();
    
        if (!user_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const recentMessages = messages.slice(-6);
        const lastUserMsg = messages[messages.length - 1].content.toUpperCase();
        const stockMatch = lastUserMsg.match(/([A-Z]{2,5})/); 
        const targetSymbol = stockMatch ? stockMatch[0] : null;
    
        let stockData: MarketData | null = null;
        let spyData: MarketData | null = null;
    
        if (targetSymbol) {
            // 並行抓取
            [stockData, spyData] = await Promise.all([
                getRichMarketData(targetSymbol),
                getRichMarketData('SPY') 
            ]);
        } else {
            spyData = await getRichMarketData('SPY');
        }
    
        const systemPrompt = `
        你是一位 **華爾街避險基金 (Hedge Fund) 的資深晶片分析師**。
        你的客戶每個月付費 $10,000 美金，是為了聽你的 **「具體觀點」**。
    
        【目前掌握的數據】
        - 目標股票: ${targetSymbol}
        - 現價: $${stockData?.price}
        - 分析師平均目標價: $${stockData?.targetPrice}
        - 華爾街建議: ${stockData?.change} (Strong Buy / Hold / Sell)
        - 財報表現: ${stockData?.lastEarnings}
        - 市盈率 (PE): ${stockData?.peRatio}
        - 近期新聞頭條: ${JSON.stringify(stockData?.news)}
        - 技術面趨勢: ${stockData?.rsi}
        - 大盤狀況 (SPY): ${JSON.stringify(spyData)}
    
        【你的回答規則】
        1. **數據導向**：每一句話都要有數字支持。
        2. **財報解讀**：重點分析【財報表現】是 Beat 還是 Miss。
        3. **結合時事**：根據新聞標題給出解釋。
        4. **給出明確建議**：進場點位與止損點位。
        5. **語氣**：繁體中文，專業犀利。
        `;
    
        const completion = await openai.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            ...recentMessages
          ],
          model: "gpt-4o-mini",
        });
    
        return NextResponse.json({ response: completion.choices[0].message.content });
    
      } catch (error) {
        console.error("AI Error:", error);
        return NextResponse.json({ error: "AI Error" }, { status: 500 });
      }
}