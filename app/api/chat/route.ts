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
  news?: string[]; // 新增新聞欄位
  rsi?: string;    // 新增技術指標
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- 輔助函數：抓取 Yahoo 深度數據與新聞 ---
async function getRichMarketData(symbol: string): Promise<MarketData> {
  try {
    // 1. 抓取報價與基本面 (Modules: quoteSummary)
    // 這裡我們抓取 'financialData', 'defaultKeyStatistics' 來獲取更多細節
    const res = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,assetProfile,recommendationTrend`);
    const json = await res.json();
    const result = json.quoteSummary.result[0];

    const price = result.financialData.currentPrice.raw;
    const targetPrice = result.financialData.targetMeanPrice.raw;
    const peRatio = result.summaryDetail?.trailingPE?.raw || 0;
    const marketCap = result.summaryDetail?.marketCap?.fmt; // 例如 "150B"
    const recommendation = result.financialData.recommendationKey; // 例如 "buy"

    // 2. 抓取最新新聞 (搜尋 API)
    const newsRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=3`);
    const newsJson = await newsRes.json();
    const newsTitles = newsJson.news.map((n: any) => `[新聞] ${n.title}`).slice(0, 3);

    // 3. 簡單計算 RSI (抓過去 15 天數據)
    // 這裡為了演示簡化邏輯，實戰中可以用 ta.js 庫
    const chartRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=15d`);
    const chartJson = await chartRes.json();
    const closes = chartJson.chart.result[0].indicators.quote[0].close;
    
    // 簡單判斷漲跌趨勢 (這不是嚴謹 RSI，但夠 AI 用來判斷短期強弱)
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const trend = lastClose > prevClose ? "上漲中" : "下跌中";

    return { 
      symbol, 
      price, 
      change: recommendation, // 這裡借用分析師建議
      peRatio,
      marketCap,
      targetPrice,
      news: newsTitles,
      rsi: trend // 簡化版技術指標
    };
  } catch (e) {
    console.error(e);
    return { symbol, price: 0, change: 'N/A', news: [] };
  }
}

export async function POST(req: Request) {
  try {
    const { messages, user_id } = await req.json();

    if (!user_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 1. 偵測用戶想問哪支股票 (簡單的正則表達式)
    // 如果用戶問 "MU 未來走向"，我們抓出 "MU"
    const lastUserMsg = messages[messages.length - 1].content.toUpperCase();
    const stockMatch = lastUserMsg.match(/([A-Z]{2,5})/); 
    const targetSymbol = stockMatch ? stockMatch[0] : null;

    let stockData: MarketData | null = null;
    let spyData: MarketData | null = null;

    // 2. 並行抓取數據
    if (targetSymbol) {
        [stockData, spyData] = await Promise.all([
            getRichMarketData(targetSymbol),
            getRichMarketData('SPY') // 抓大盤做對比
        ]);
    } else {
        // 沒指定股票就抓持倉... (略，維持原本邏輯)
        spyData = await getRichMarketData('SPY');
    }

    // --- 升級版 System Prompt ---
    const systemPrompt = `
    你現在是一位 **華爾街資深股票分析師** (Sell-side Analyst)。
    用戶討厭模稜兩可的廢話 (如「注意風險」)，請根據以下數據給出 **辛辣、明確、有觀點** 的分析。

    【目標股票數據】: ${targetSymbol ? JSON.stringify(stockData) : "用戶未指定特定股票"}
    【大盤環境 (SPY)】: ${JSON.stringify(spyData)}

    你的分析邏輯：
    1. **估值檢查**：目前的 P/E (${stockData?.peRatio}) 跟目標價 ($${stockData?.targetPrice}) 相比，是有肉還是太貴？
    2. **情緒分析**：根據最新的 3 則新聞標題，市場現在是看好還是看壞？
    3. **技術面**：目前的趨勢是 ${stockData?.rsi}，不要叫人去接刀子。
    4. **最終建議**：給出 Buy / Hold / Sell 的明確傾向，並給出理由。

    請用 **繁體中文** 回答，口語化一點，不要像教科書。
    `;

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      model: "gpt-4o-mini",
    });

    return NextResponse.json({ response: completion.choices[0].message.content });

  } catch (error) {
    return NextResponse.json({ error: "AI Error" }, { status: 500 });
  }
}