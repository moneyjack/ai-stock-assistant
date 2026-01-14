import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

  try {
    // 使用 Yahoo Finance 的搜尋 API (公開且免費)
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&quotesCount=1&newsCount=0`
    );
    const data = await response.json();

    if (data.quotes && data.quotes.length > 0) {
      const match = data.quotes[0];
      // 簡單驗證：檢查抓到的 symbol 是否跟輸入的差不多
      // 這裡我們回傳股票的全名 (longname)，可以用來顯示在前端
      return NextResponse.json({ 
        valid: true, 
        symbol: match.symbol, 
        name: match.longname || match.shortname,
        exchange: match.exchange
      });
    }

    return NextResponse.json({ valid: false });
  } catch (error) {
    return NextResponse.json({ valid: false });
  }
}