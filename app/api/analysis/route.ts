import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// 定義清晰的數據介面
interface MarketData {
  symbol: string;
  price: number;
  changePercent: number;
  changeLabel: string;   // "Buy", "Hold" etc.
  peRatio?: number;
  targetPrice?: number;
  rsi?: string;  
  lastEarnings?: string; // 財報數據
  sector?: string;       // 新增：板塊資訊 (幫助 AI 分析集中度)
  ma50?: number;         // 新增：50日均線
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- 核心：使用 yahoo-finance2 抓取深度數據 (包含防呆機制) ---
async function getRichMarketData(symbol: string): Promise<MarketData> {
  // 對於非股票代碼 (如 USDT) 直接跳過
  if (symbol.includes('USD') || symbol.length > 5) {
      return { symbol, price: 0, changePercent: 0, changeLabel: 'N/A' };
  }

  try {
    // 1. 動態匯入 + 強制轉型 (解決 Next.js 部署問題)
    const pkg = await import('yahoo-finance2') as any;
    const YahooFinanceClass = pkg.YahooFinance || pkg.default?.YahooFinance || pkg.default;
    const yahooFinance = typeof YahooFinanceClass === 'function' ? new YahooFinanceClass() : YahooFinanceClass;
    
    // 抑制警告
    if (yahooFinance?.suppressNotices) yahooFinance.suppressNotices(['yahooSurvey', 'queue']);

    // 2. 抓取基本面 (Quote Summary)
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: ['price', 'summaryDetail', 'financialData', 'earnings', 'defaultKeyStatistics', 'assetProfile']
    });

    // 3. 抓取 K 線計算 RSI (修正 period1 錯誤)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 40); // 抓 40 天確保數據足夠
    const chartData = await yahooFinance.chart(symbol, { 
        period1: startDate.toISOString().split('T')[0], 
        interval: '1d' 
    }) as any;

    // 計算簡單趨勢
    let trend = "盤整";
    if (chartData?.quotes?.length >= 2) {
        const quotes = chartData.quotes;
        const last = quotes[quotes.length - 1].close;
        const prev = quotes[quotes.length - 5]?.close || quotes[0].close; // 與 5 天前比較
        trend = last > prev ? "短多 (Up)" : "短空 (Down)";
    }

    // 4. 處理財報 (Earnings Beat/Miss)
    let earningsStr = "無財報數據";
    try {
        const history = result.earnings?.earningsChart?.quarterly;
        if (history?.length > 0) {
            const latest = history.slice().reverse().find((q: any) => q.actual !== undefined);
            if (latest) {
                const diff = ((latest.actual - latest.estimate) / Math.abs(latest.estimate)) * 100;
                earningsStr = `EPS ${diff > 0 ? "Beat" : "Miss"} ${Math.abs(diff).toFixed(1)}%`;
            }
        }
    } catch (e) {}
    const fiftyDayAvg = result.summaryDetail?.fiftyDayAverage?.raw || 0;
    return {
      symbol,
      price: result.financialData?.currentPrice || 0,
      changePercent: (result.price?.regularMarketChangePercent || 0) * 100,
      changeLabel: result.financialData?.recommendationKey || "N/A",
      peRatio: result.summaryDetail?.trailingPE || 0,
      targetPrice: result.financialData?.targetMeanPrice || 0,
      rsi: trend,
      lastEarnings: earningsStr,
      ma50: fiftyDayAvg,
      sector: result.assetProfile?.sector || "Unknown" // 抓取板塊
    };

  } catch (error: any) {
    console.error(`❌ Data Error for ${symbol}:`, error.message);
    return { 
        symbol, price: 0, changePercent: 0, changeLabel: 'Error', 
        peRatio: 0, targetPrice: 0, rsi: 'Unknown', lastEarnings: '數據暫缺', sector: 'Unknown'
    };
  }
}

export async function POST(req: Request) {
  try {
    const { user_id, action, tradeDetails } = await req.json();
    if (!user_id) return NextResponse.json({ advice: "身份驗證失敗" });

    // --- 1. 數據準備 ---
    // 抓取用戶資產
    const { data: portfolio } = await supabase.from('portfolios').select('cash_balance').eq('user_id', user_id).single();
    const { data: positions } = await supabase.from('positions').select('symbol, avg_price, quantity').eq('user_id', user_id);
    const cash = portfolio?.cash_balance || 0;

    // 抓取「大盤」與「持倉股票」的深度數據
    // 如果是 Pre-Trade，重點抓交易標的；如果是 Dashboard，重點抓持倉分析
    const targetSymbol = action === 'PRE_TRADE_CHECK' ? tradeDetails.symbol : 'SPY';
    
    // 取得所有持倉的 Symbol 列表 (去重)
    const distinctSymbols = Array.from(new Set(positions?.map(p => p.symbol) || []));
    // 為了效能，最多只抓前 5 支重倉股 + SPY + 目標股票
    const symbolsToFetch = ['SPY', targetSymbol, ...distinctSymbols.slice(0, 5)]; 
    const uniqueSymbols = Array.from(new Set(symbolsToFetch));

    // 並行抓取所有需要的市場數據
    const marketDataResults = await Promise.all(uniqueSymbols.map(s => getRichMarketData(s)));
    const marketMap = new Map(marketDataResults.map(data => [data.symbol, data]));

    const spyData = marketMap.get('SPY');
    const targetData = marketMap.get(targetSymbol);

    // --- 2. 構建分析上下文 ---
    const holdingAnalysis = positions?.map(p => {
        const data = marketMap.get(p.symbol);
        const marketValue = (data?.price || 0) * p.quantity;
        return {
            symbol: p.symbol,
            sector: data?.sector || "Other",
            value: marketValue,
            trend: data?.rsi,
            earnings: data?.lastEarnings
        };
    });

    const totalEquity = (holdingAnalysis?.reduce((sum, h) => sum + h.value, 0) || 0) + cash;

    const dataContext = `
    【大盤環境 (SPY)】趨勢: ${spyData?.rsi}, 建議: ${spyData?.changeLabel}
    【用戶資產】現金: $${cash.toFixed(0)}, 總值: $${totalEquity.toFixed(0)}
    【持倉深度分析】${JSON.stringify(holdingAnalysis)}
    ${action === 'PRE_TRADE_CHECK' ? `【擬交易標的 (${targetSymbol})】數據: ${JSON.stringify(targetData)}` : ''}
    `;

    // --- 3. 華爾街分析師 Prompt ---
    const systemPrompt = `
    你是一位 **華爾街避險基金 (Hedge Fund) 的資深投資組合經理**。
    你的客戶付費訂閱你的週報，他們需要 **「數據背後的洞察」**，而不是廢話。

    ${dataContext}

    【分析規則】
    1. **拒絕 "無數據"**：如果財報顯示 "數據暫缺"，請跳過該項分析，不要直接說 "無數據支持"。
    2. **板塊連動 (Correlation)**：請觀察【持倉深度分析】中的 sector 欄位。如果有 2 支以上同板塊 (如 Technology)，請警告集中風險。
    3. **Alpha 歸因**：指出哪支股票是當前的 "領頭羊" (Trend=Up)，哪支是 "拖油瓶" (Trend=Down)。
    4. **行動建議**：
       - Dashboard 模式：請建議 "減碼" 表現最差且趨勢向下的股票。
       - Pre-Trade 模式：如果大盤 (SPY) 是 Down，請嚴格審查買入行為 (接刀風險)。
    5. **趨勢與基本面結合**：
   - 當評價 "拖油瓶" (Down Trend) 時，請檢查其財報 (Earnings)。
   - 如果財報是 "Beat" 但股價跌，請提示可能是 "錯殺" 或 "大盤拖累"。
   - 如果財報是 "Miss" 且股價跌，請強烈建議 "立即止損"。
    6. **語氣**：繁體中文，專業、犀利、數據導向。
    【行動建議規則】
    - 給出止損建議時，請參考該股票的 "50日均線 (MA50)"。
    - 例如：「跌破 50日均線 ($125) 則止損」。
    `;

    const userPrompt = action === 'PRE_TRADE_CHECK' 
        ? `我想${tradeDetails.type === 'BUY' ? '買入' : '賣出'} ${targetSymbol}，數量 ${tradeDetails.quantity}。請根據其財報 (${targetData?.lastEarnings}) 與估值，給出批准或駁回建議。`
        : `請對我的投資組合進行健檢。我有沒有過度集中在某個板塊？建議我現在該做什麼調整？`;

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "gpt-4o-mini",
    });

    return NextResponse.json({ advice: completion.choices[0].message.content });

  } catch (error: any) {
    console.error("Analysis Error:", error);
    return NextResponse.json({ advice: "市場連線異常，無法提供即時建議。" });
  }
}