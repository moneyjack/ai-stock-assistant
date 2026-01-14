import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// 初始化 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 初始化 Supabase (使用 Service Role Key 繞過 RLS 讀取資料)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  try {
    const { user_id, action, tradeDetails } = await req.json();

    if (!user_id) return NextResponse.json({ advice: "無法識別用戶身份。" });

    // --- 1. 並行抓取市場與用戶數據 ---
    const [spy, qqq, btc] = await Promise.all([
      getMarketData('SPY'),
      getMarketData('QQQ'),
      getMarketData('BTC-USD')
    ]);

    // 抓取現金 (為了計算資金佔比)
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('cash_balance')
      .eq('user_id', user_id)
      .single();

    // 抓取持倉
    const { data: positions } = await supabase
      .from('positions')
      .select('symbol, avg_price, quantity, current_price')
      .eq('user_id', user_id);

    // 抓取歷史 (過濾資金操作)
    const { data: history } = await supabase
      .from('trade_history')
      .select('symbol, entry_price, exit_price, quantity, exit_date, reason_for_exit')
      .eq('user_id', user_id)
      .neq('symbol', 'DEPOSIT')
      .neq('symbol', 'WITHDRAW')
      .order('exit_date', { ascending: false })
      .limit(50);

    const cash = portfolio?.cash_balance || 0;

    // --- 2. 準備 Prompt 變數 ---
    
    // 計算這筆擬定交易的總金額
    const tradeValue = tradeDetails ? (parseFloat(tradeDetails.price) * parseFloat(tradeDetails.quantity)) : 0;
    
    // 計算目前總資產 (現金 + 持倉市值)
    const currentEquity = positions?.reduce((sum, p) => sum + ((p.current_price || p.avg_price) * p.quantity), 0) + cash;
    
    // 計算交易後佔比 (Position Sizing)
    const positionSizePercent = currentEquity > 0 ? ((tradeValue / currentEquity) * 100).toFixed(1) : "0";

    const marketContext = `
    【即時大盤】SPY: ${spy.change}, QQQ: ${qqq.change}, BTC: ${btc.change}
    【用戶資金】現金: $${cash.toFixed(0)}, 總淨值: $${currentEquity.toFixed(0)}
    `;

    const databaseContext = `
    【當前持倉】${JSON.stringify(positions)}
    【交易歷史】${JSON.stringify(history)}
    `;

    // --- 3. 根據場景組裝 System Prompt ---

    const systemPrompt = `
    你是一位極度嚴格的「華爾街避險基金風控官」。你的職責不是預測股價，而是保護用戶的本金。
    
    ${marketContext}
    ${databaseContext}
    
    你的分析風格：
    1. **毒舌但專業**：如果有高風險行為，請直接批評。
    2. **數據說話**：引用具體的曝險比例 (Exposure %) 和板塊集中度。
    3. **繁體中文**：使用台灣/香港的金融術語 (如：注碼、板塊、左側交易)。
    `;

    let userPrompt = "";

    if (action === 'PRE_TRADE_CHECK') {
        // --- 核心修改：升級版下單檢查 Prompt ---
        userPrompt = `
        🛑 **交易攔截檢查 (Pre-Trade Risk Check)**
        
        我正準備下單：【${tradeDetails.type === 'BUY' ? '買入' : '賣出'} ${tradeDetails.symbol}】，
        數量：${tradeDetails.quantity} 股，價格：$${tradeDetails.price}。
        
        這筆交易總值 $${tradeValue.toFixed(0)}，約佔我總資產的 ${positionSizePercent}%。
        
        請針對以下 **4 個維度** 進行嚴格審查，並在最後給出「批准」或「駁回」建議：

        1. **資金注碼 (Position Sizing)**：
           - 這筆交易佔比 ${positionSizePercent}% 是否過重？符合一般散戶 (5-10%) 或激進 (20%+) 的安全標準嗎？
           - 我目前的現金 ($${cash}) 是否足夠應對波動？

        2. **板塊與分散 (Portfolio Concentration)**：
           - 檢查我的【當前持倉】，我是否已經持有太多同行業的股票？(例如已有 NVDA 又買 AMD)
           - 這筆交易會讓我的投資組合更平衡，還是更極端？

        3. **歷史教訓 (Trade History)**：
           - 搜尋歷史紀錄，我過去在 ${tradeDetails.symbol} 或類似股票上是賺是賠？我有沒有「越跌越買」或「太早賣出」的壞習慣？

        4. **大盤時機 (Market Condition)**：
           - 參考 SPY (${spy.change}) 和 QQQ (${qqq.change})。
           - 我是在順勢交易，還是在接刀子 (逆勢)？現在的波動率適合進場嗎？

        請用 **點列式** 簡短回答 (200字內)，最後給出明確的結論。
        `;
    } else {
        // Dashboard 一般分析
        userPrompt = `
        請對我的投資組合進行全面健檢：
        1. **績效歸因**：我的資產與大盤(${spy.change})相比表現如何？
        2. **持倉風險**：我有沒有過度集中在某個板塊 (如科技股)？
        3. **下一步建議**：具體該減倉哪一支，或該保留現金？
        `;
    }

    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "gpt-4o-mini",
      temperature: 0.7,
    });

    return NextResponse.json({ advice: completion.choices[0].message.content });

  } catch (error) {
    console.error("Analysis API Error:", error);
    return NextResponse.json({ advice: "無法連線至風控中心，請自行判斷風險。" });
  }
}
async function getMarketData(symbol: string) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
    const data = await res.json();
    const meta = data.chart.result[0].meta;
    const regularMarketPrice = meta.regularMarketPrice;
    const previousClose = meta.chartPreviousClose;
    const changePercent = ((regularMarketPrice - previousClose) / previousClose) * 100;
    return { 
      symbol, 
      price: regularMarketPrice, 
      change: changePercent.toFixed(2) + '%' 
    };
  } catch (e) {
    return { symbol, price: 0, change: '0%' };
  }
}