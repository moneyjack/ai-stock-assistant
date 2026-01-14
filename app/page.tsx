'use client';
import ChatBot from '@/components/ChatBot';
import { useState, useEffect } from 'react';
import { supabase, type TradeHistory, type Position } from '@/lib/supabase';
import { useRouter } from 'next/navigation'; // <--- 新增：用來跳轉頁面
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  TrendingUp, 
  TrendingDown, 
  Plus,  
  Minus, 
  Sparkles, 
  Wallet,
  ArrowRightLeft,
  CheckCircle2, 
  XCircle, 
  Loader2,
  LogOut, 
  User,
  LayoutDashboard   
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { MiniChart, AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid // <--- 新增這些
} from 'recharts';


export default function Dashboard() {
  
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null); // <--- 新增：用來存當前用戶資料
  const [formData, setFormData] = useState({
    symbol: '',
    price: '',
    quantity: '',
    date: new Date().toISOString().split('T')[0], // 預設今天 (YYYY-MM-DD)
    deductCash: true // 預設為「要扣款」(一般交易)
  });
  const [selectedSymbol, setSelectedSymbol] = useState("SPY");
  const router = useRouter(); // <--- 新增：初始化 router
  const { toast } = useToast();
  const [cash, setCash] = useState(0); // 存現金
  const [userEmail, setUserEmail] = useState("");
  const [isValidSymbol, setIsValidSymbol] = useState<boolean | null>(null);
  const [stockName, setStockName] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [tradeAdvice, setTradeAdvice] = useState(""); // 存 AI 給的建議
  const [pendingTrade, setPendingTrade] = useState<any>(null); // 暫存要買的資料
  const [showConfirmation, setShowConfirmation] = useState(false); // 控制彈窗顯示
  const [analysisResult, setAnalysisResult] = useState<string>("");
  const [aiInsight, setAiInsight] = useState("AI 正在分析市場數據...");
  const [analyzing, setAnalyzing] = useState(false);

  // --- 計算圓餅顏色 ---
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1'];
  // --- 計算圓餅圖數據 ---
  const allocationData = [
    // 1. 現金
    { name: 'Cash', value: cash },
    // 2. 各個股票持倉
    ...positions.map(p => ({
      name: p.symbol,
      value: (p.current_price || p.avg_price) * p.quantity
    }))
  ].filter(item => item.value > 0); // 過濾掉價值為 0 的項目
  const [equityData, setEquityData] = useState<any[]>([]);
  // 修改 useEffect：一進來先檢查登入，再抓資料
  useEffect(() => {
    const checkUserAndFetch = async () => {
      // 1. 檢查是否登入
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        // 沒登入 -> 踢去登入頁
        router.push('/login');
        return;
      }

      // 有登入 -> 存起來，並開始抓資料
      setUser(user);
      setUserEmail(user.email || "Trader"); // <--- 存 Email
      fetchPositions();
      fetchPortfolio(user.id);
      fetchHistory(); 
    };

    checkUserAndFetch();
  }, [router]);
  
  const fetchPositions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPositions(data || []);
    } catch (error) {
      console.error('Error fetching positions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load positions',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
// A. 嘗試記錄今天的淨值 (如果今天還沒記過)
  const recordDailySnapshot = async (currentTotalEquity: number) => {
    if (!user || currentTotalEquity <= 0) return;

    const today = new Date().toISOString().split('T')[0]; // 格式: YYYY-MM-DD

    // 先檢查今天是否已經有紀錄 (雖然 DB 有 unique constraint，但先檢查比較乾淨)
    const { data: existing } = await supabase
      .from('equity_snapshots')
      .select('id')
      .eq('user_id', user.id)
      .eq('snapshot_date', today)
      .maybeSingle();

    if (!existing) {
      // 今天沒紀錄 -> 寫入一筆
      await supabase.from('equity_snapshots').insert([
        {
          user_id: user.id,
          total_equity: currentTotalEquity,
          snapshot_date: today
        }
      ]);
      // 寫入後重新抓取圖表
      fetchEquityHistory();
    }
  };

  // B. 抓取歷史走勢圖數據
  const fetchEquityHistory = async () => {
    if (!user) return;
    
    // 抓取最近 30 天的數據 (或是全部)
    const { data, error } = await supabase
      .from('equity_snapshots')
      .select('snapshot_date, total_equity')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: true }); // 日期從舊到新

    if (!error && data) {
      // 格式化日期，讓 X 軸好看一點 (例如 "01/14")
      const formattedData = data.map(item => ({
        date: new Date(item.snapshot_date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        value: item.total_equity
      }));
      setEquityData(formattedData);
    }
  };
  // State
  const [history, setHistory] = useState<TradeHistory[]>([]);

  // Fetch Function (放在 fetchPositions 附近)
  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('trade_history')
      .select('*')
      .order('exit_date', { ascending: false }); // 最近賣出的在上面
    
    if (!error && data) {
      setHistory(data);
    }
  };


  // 把這段邏輯加到你的 useEffect 或 fetchPositions 附近
const fetchPortfolio = async (userId: string) => {
    let { data, error } = await supabase
        .from('portfolios')
        .select('cash_balance')
        .eq('user_id', userId)
        .single();

    if (!data) {
        // 如果還沒有帳戶，自動創建一個初始帳戶
        const { data: newData, error: createError } = await supabase
            .from('portfolios')
            .insert([{ user_id: userId, cash_balance: 100000 }]) // 預設 10萬
            .select()
            .single();
        if (newData) setCash(newData.cash_balance);
    } else {
        setCash(data.cash_balance);
    }
};

// 記得在 useEffect 拿到 user 後呼叫它：
// fetchPortfolio(user.id);
// 處理賣出 (平倉) 邏輯
  // 處理賣出 (支援分批賣出)
  const handleSell = async (position: Position) => {
    // 1. 詢問要賣多少股
    const input = window.prompt(
      `您目前持有 ${position.quantity} 股 ${position.symbol}。\n請輸入要賣出的數量：`,
      position.quantity.toString() // 預設填入全部數量
    );

    if (input === null) return; // 用戶按取消
    
    const sellQuantity = parseFloat(input);

    // 2. 驗證輸入
    if (isNaN(sellQuantity) || sellQuantity <= 0 || sellQuantity > position.quantity) {
      alert("請輸入有效的數量！不能超過持有股數。");
      return;
    }

    // 3. 計算價格與盈虧
    // 如果有 update_prices.py 跑出來的 current_price 就用，沒有就讓用戶手動確認
    let exitPrice = position.current_price || position.avg_price;
    
    // 如果是自動抓的價格，最好讓用戶確認一下最終成交價
    const priceInput = window.prompt(
      `確認賣出價格 (預設為市價):`,
      exitPrice.toString()
    );
    if (priceInput) exitPrice = parseFloat(priceInput);

    if (!user) return;

    try {
      setLoading(true);

      // --- A. 寫入歷史紀錄 (只記錄賣出的那部分) ---
     // 寫入交易歷史 (賣出)
      const { error: historyError } = await supabase.from('trade_history').insert([
        {
          user_id: user.id,
          symbol: position.symbol,
          action: 'SELL',    // <--- 新增這行
          entry_price: position.avg_price,
          exit_price: exitPrice,
          quantity: sellQuantity,
          entry_date: position.created_at,
          exit_date: new Date().toISOString(),
          reason_for_exit: sellQuantity === position.quantity ? 'Full Close' : 'Partial Close'
        }
      ]);

      if (historyError) throw historyError;

      // --- B. 處理持倉 (更新 或 刪除) ---
      if (sellQuantity === position.quantity) {
        // 情境 1: 全部賣光 -> 刪除倉位
        const { error: deleteError } = await supabase
          .from('positions')
          .delete()
          .eq('id', position.id);
        if (deleteError) throw deleteError;
        
        toast({ title: '已清倉', description: `${position.symbol} 全數賣出` });

      } else {
        // 情境 2: 部分賣出 -> 更新剩餘數量
        const remainingQty = position.quantity - sellQuantity;
        const { error: updateError } = await supabase
          .from('positions')
          .update({ quantity: remainingQty }) // 只改數量，成本價不變
          .eq('id', position.id);
        if (updateError) throw updateError;

        toast({ title: '減倉成功', description: `賣出 ${sellQuantity} 股，剩餘 ${remainingQty} 股` });
      }
      const returnAmount = exitPrice * sellQuantity;

      // 加錢
      await supabase.from('portfolios').update({
          cash_balance: cash + returnAmount
      }).eq('user_id', user.id);

      setCash(cash + returnAmount);
      // 4. 重新整理列表
      fetchPositions();

    } catch (error) {
      console.error('Error selling position:', error);
      toast({
        title: 'Error',
        description: '交易失敗',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  // 處理存入/取出資金
  // 處理存入/取出資金 (並寫入歷史紀錄)
  const handleCashOperation = async (type: 'deposit' | 'withdraw') => {
    const isDeposit = type === 'deposit';
    const actionText = isDeposit ? '存入' : '提取';
    const input = window.prompt(`請輸入要${actionText}的金額：`);
    
    if (!input) return;
    const amount = parseFloat(input);

    if (isNaN(amount) || amount <= 0) {
      alert("請輸入有效金額");
      return;
    }

    if (!isDeposit && amount > cash) {
      alert("餘額不足！");
      return;
    }

    // 計算新餘額
    const newBalance = isDeposit ? cash + amount : cash - amount;

    try {
      setLoading(true);

      // 1. 更新現金餘額 (Portfolios)
      const { error: portfolioError } = await supabase
        .from('portfolios')
        .update({ cash_balance: newBalance })
        .eq('user_id', user.id);

      if (portfolioError) throw portfolioError;

      // 2. 寫入交易歷史 (Trade History) - 關鍵修改
      // 使用 "Entry 0, Exit 1" 的技巧來代表存入，反之代表取出
     // 寫入交易歷史 (資金)
      const { error: historyError } = await supabase.from('trade_history').insert([
        {
          user_id: user.id,
          symbol: isDeposit ? 'USD' : 'USD', // 資金操作通常 Symbol 寫幣種比較專業
          action: isDeposit ? 'DEPOSIT' : 'WITHDRAW', // <--- 新增這行
          entry_price: 1, 
          exit_price: 1, 
          quantity: amount,
          entry_date: new Date().toISOString(),
          exit_date: new Date().toISOString(),
          reason_for_exit: isDeposit ? 'Cash In' : 'Cash Out'
        }
      ]);
      if (historyError) throw historyError;

      // 3. 更新前端
      setCash(newBalance);
      fetchHistory(); // 重新抓取歷史列表，讓新紀錄顯示出來
      
      toast({
        title: 'Success',
        description: `成功${actionText} $${amount.toFixed(2)}`,
      });

    } catch (error: any) {
      console.error(error);
      toast({ title: 'Error', description: '操作失敗: ' + error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };
  // 當 Symbol 輸入框改變時觸發
  const handleSymbolChange = async (val: string) => {
    const symbol = val.toUpperCase();
    setFormData({ ...formData, symbol: symbol });
    
    // 重置狀態
    setIsValidSymbol(null);
    setStockName("");

    if (symbol.length < 2) return; // 太短不檢查

    setIsChecking(true);
    try {
      // 呼叫我們剛剛寫的 API
      const res = await fetch(`/api/stock-check?symbol=${symbol}`);
      const data = await res.json();

      if (data.valid && data.symbol === symbol) {
        setIsValidSymbol(true);
        setStockName(data.name);
      } else {
        setIsValidSymbol(false);
      }
    } catch (error) {
      setIsValidSymbol(false);
    } finally {
      setIsChecking(false);
    }
  };
  // 第一階段：用戶按 Submit -> 呼叫 AI 檢查
  const handlePreTradeCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    // 1. 準備交易資料
    const tradePayload = {
      symbol: formData.symbol,
      price: formData.price,
      quantity: formData.quantity,
      type: 'BUY'
    };

    setPendingTrade(tradePayload);
    setShowConfirmation(true); // 顯示彈窗
    setTradeAdvice("AI 正在分析大盤與您的歷史數據..."); // Loading 文字

    // 2. 呼叫後端
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            user_id: user.id, 
            action: 'PRE_TRADE_CHECK', // 告訴後端這是下單檢查
            tradeDetails: tradePayload
        }),
      });
      const data = await res.json();
      setTradeAdvice(data.advice); // 顯示 AI 建議
    } catch (error) {
      setTradeAdvice("AI 暫時無法連線，您可以選擇直接執行。");
    }
  };

  // 第二階段：用戶看完建議，按「確認執行」 -> 真正寫入資料庫
  const confirmTrade = async () => {
    if (!formData.symbol || !formData.price || !formData.quantity || !formData.date) {
      toast({ title: 'Error', description: 'Please fill in all fields', variant: 'destructive' });
      return;
    }
    
    if (!user) return;

    const purchasePrice = parseFloat(formData.price);
    const purchaseQty = parseFloat(formData.quantity);
    const totalCost = purchasePrice * purchaseQty;
    
    // --- 關鍵修改 1: 只有在「勾選扣款」時才檢查現金 ---
    if (formData.deductCash && totalCost > cash) {
      toast({
        title: '現金不足',
        description: `需要 $${totalCost.toFixed(2)}，但你只有 $${cash.toFixed(2)}`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      // --- 1. 建立持倉 (Positions) ---
      // 不管是不是舊倉位，Position 都是現在存在的
      const { error: insertError } = await supabase.from('positions').insert([
        {
          symbol: formData.symbol.toUpperCase(),
          avg_price: purchasePrice,
          quantity: purchaseQty,
          current_price: purchasePrice, // 暫時設為買入價，等待 Python 更新
          user_id: user.id 
        },
      ]);

      if (insertError) throw insertError;

      // --- 關鍵修改 2: 只有在「勾選扣款」時才更新現金 ---
      let newBalance = cash;
      if (formData.deductCash) {
        newBalance = cash - totalCost;
        const { error: updateError } = await supabase
          .from('portfolios')
          .update({ cash_balance: newBalance })
          .eq('user_id', user.id);

        if (updateError) throw updateError;
        setCash(newBalance); // 更新前端
      }

      // --- 關鍵修改 3: 寫入歷史時，使用用戶選擇的日期 (formData.date) ---
      const { error: historyError } = await supabase.from('trade_history').insert([
        {
          user_id: user.id,
          symbol: formData.symbol.toUpperCase(),
          action: 'BUY',
          entry_price: purchasePrice,
          exit_price: null, // 或 0，視乎你的資料庫設定
          quantity: purchaseQty,
          
          // 使用用戶選的日期，而不是 new Date()
          entry_date: new Date(formData.date).toISOString(),
          exit_date: new Date(formData.date).toISOString(), // 買入當下時間點
          
          reason_for_exit: formData.deductCash ? 'New Position' : 'Imported Position' // 標記來源
        }
      ]);

      // --- 4. 收尾 ---
      setFormData({ 
        symbol: '', price: '', quantity: '', 
        date: new Date().toISOString().split('T')[0], 
        deductCash: true 
      });
      fetchPositions(); 
      fetchHistory();

      toast({
        title: formData.deductCash ? 'Trade Executed' : 'Position Imported',
        description: `Successfully added ${formData.symbol}`,
      });

    } catch (error: any) {
      console.error('Error:', error);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
      setShowConfirmation(false);
      setPendingTrade(null);
    }
  };

  const handleManualAnalysis = async () => {
    if (!user) return;
    
    setAnalyzing(true);
    setAnalysisResult(""); // 清空舊的
    
    try {
      // 呼叫原本的 API (就是我們之前寫好的那個 RAG Agent)
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            user_id: user.id,
            action: 'DASHBOARD_DIAGNOSIS' // 告訴後端這是「整體診斷」
        }),
      });
      
      const data = await res.json();
      setAnalysisResult(data.advice);
    } catch (error) {
      setAnalysisResult("AI 連線失敗，請稍後再試。");
    } finally {
      setAnalyzing(false);
    }
  };
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      router.push('/login'); // 踢回登入頁
    }
  };
 const calculatePL = (position: Position) => {
    // 舊邏輯 (刪除): const currentPrice = position.avg_price ? position.avg_price * 1.05 : 0;
    
    // ✅ 新邏輯: 優先讀取資料庫的 current_price
    // 如果資料庫是 null (腳本還沒跑)，就暫時顯示買入價 (avg_price)，讓盈虧顯示為 0
    const currentPrice = position.current_price ?? position.avg_price ?? 0;
    
    const buyPrice = position.avg_price || 0;
    const pl = (currentPrice - buyPrice) * position.quantity;
    const plPercent = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0;
    
    return { pl, plPercent, currentPrice };
  };

  const totalValue = positions.reduce((sum, pos) => {
    const { currentPrice } = calculatePL(pos);
    return sum + currentPrice * pos.quantity;
  }, 0);

  const totalPL = positions.reduce((sum, pos) => {
    const { pl } = calculatePL(pos);
    return sum + pl;
  }, 0);

 useEffect(() => {
    const currentNetWorth = totalValue + cash;
    
    // 只有當「用戶已登入」且「資產大於 0」且「讀取完成」時才記錄
    if (user && currentNetWorth > 0 && !loading) {
      // 1. 嘗試記錄今天
      recordDailySnapshot(currentNetWorth);
      
      // 2. 如果圖表還沒資料，順便抓歷史紀錄
      if (equityData.length === 0) {
        fetchEquityHistory();
      }
    }
  }, [totalValue, cash, user, loading]); // 當這些數值變動時，React 會重新執行這裡
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="container mx-auto p-6 space-y-6">
        <header className="flex flex-col gap-6 pb-6 border-b border-slate-800">
          {/* 第一排：Logo 與 用戶選單 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-600 rounded-lg">
                <LayoutDashboard className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                  Tik Sir Get Rich AI
                </h1>
                <p className="text-xs text-slate-400">我也許不能保證你賺大錢，但我能保證你不會大賠</p>
              </div>
            </div>

            {/* 用戶資訊與登出按鈕 */}
            <div className="flex items-center gap-4 bg-slate-900 p-2 rounded-full border border-slate-800 pr-4">
              <div className="flex items-center gap-3 pl-2">
                <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <User className="h-4 w-4 text-slate-400" />
                </div>
                <div className="hidden md:block text-sm">
                  <p className="text-slate-200 font-medium leading-none">{userEmail}</p>
                  <p className="text-[10px] text-emerald-400 mt-1">Pro Plan</p>
                </div>
              </div>
              <div className="h-4 w-px bg-slate-800 mx-2"></div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleLogout}
                className="h-8 w-8 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-full transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 第二排：資產數據 (原本的 Cash Balance, Total Value...) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 md:col-span-2">
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 text-slate-400">
                  <Wallet className="h-4 w-4" /> {/* 錢包小圖示 */}
                  <span className="text-sm">Cash Balance</span>
                </div>

                <div className="flex items-center gap-3">
                  {/* 金額顯示 */}
                  <span className="text-2xl font-bold font-mono text-blue-400">
                    ${cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>

                  {/* 按鈕群組 */}
                  <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 rounded-md transition-colors"
                      onClick={() => handleCashOperation('deposit')}
                      title="存入資金 (Deposit)"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>

                    <div className="w-px h-4 bg-slate-800 my-auto"></div> {/* 中間的分隔線 */}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-rose-400 hover:text-rose-300 hover:bg-slate-800 rounded-md transition-colors"
                      onClick={() => handleCashOperation('withdraw')}
                      title="提取資金 (Withdraw)"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
              <p className="text-sm text-slate-400 text-right ">Total Value</p>
              <p className="text-2xl font-bold font-mono text-right">${totalValue.toFixed(2)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
              <div className="text-right">
                <p className="text-sm text-slate-400">Total P/L</p>
                <p
                  className={`text-2xl font-bold font-mono   ${totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                >
                  {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </header>

      
               {/* --- 新增：長駐的詳細走勢圖 (全寬) --- */}
        <div className="w-full h-[500px] bg-slate-900 border border-slate-800 rounded-lg overflow-hidden mb-6 shadow-xl relative">
          {/* 加入一個標題列，顯示當前看的是哪支 */}
          <div className="absolute top-0 left-0 z-10 bg-slate-900/80 px-4 py-2 text-xs font-bold text-slate-400 border-b border-slate-800/50 backdrop-blur-sm rounded-br-lg">
            正在查看: <span className="text-emerald-400 text-lg ml-2">{selectedSymbol}</span>
          </div>

          <AdvancedRealTimeChart 
            key={selectedSymbol}
            theme="dark" 
            symbol={selectedSymbol}
            autosize
            hide_side_toolbar={false} // 顯示右側繪圖工具列 (超專業)
            interval="D"              // 預設日線
            timezone="Asia/Hong_Kong" // 設定時區
            style="1"                 // 1 = 蠟燭圖
            locale="en"
            toolbar_bg="#0f172a"      // 配合你的背景色
            enable_publishing={false}
            allow_symbol_change={true} // 允許用戶自己在圖表上改代號
            container_id="tradingview_widget"
          />
        </div> 
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100">Positions</CardTitle>
                <CardDescription className="text-slate-400">
                  Your current stock holdings
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-8 text-slate-400">
                    Loading positions...
                  </div>
                ) : positions.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    No positions yet. Add your first position below.
                  </div>
                ) : (
                  <div className="rounded-md border border-slate-800 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-800 hover:bg-slate-800/50">
                          <TableHead className="text-slate-300">
                            Symbol
                          </TableHead>
                          <TableHead className="text-slate-300">
                            Purchase Price
                          </TableHead>
                          <TableHead className="text-slate-300">
                            Current Price
                          </TableHead>
                          <TableHead className="text-slate-300">
                            Quantity
                          </TableHead>
                          <TableHead className="text-slate-300">
                            Total Value
                          </TableHead>
                          <TableHead className="text-slate-300 text-right">
                            P/L
                          </TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {positions.map((position) => {
                          const { pl, plPercent, currentPrice } =
                            calculatePL(position);
                          const isPositive = pl >= 0;

                          return (
                            <TableRow
                              key={position.id}
                              // 1. 點擊時，更新 selectedSymbol
                              onClick={() => {
                                setSelectedSymbol(position.symbol);
                                // 順便把畫面捲動到最上面看圖表 (選用)
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              // 2. 樣式調整：如果是被選中的股票，背景變亮一點 (bg-slate-800)
                              className={`border-slate-800 cursor-pointer transition-colors ${
                                selectedSymbol === position.symbol ? 'bg-slate-800 border-l-4 border-l-blue-500' : 'hover:bg-slate-800/50'
                              }`}
                            >
                              <TableCell className="font-bold text-slate-100">
                                {position.symbol}
                              </TableCell>
                              <TableCell className="text-slate-300">
                                ${position.avg_price.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-slate-300">
                                ${currentPrice.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-slate-300">
                                {position.quantity}
                              </TableCell>
                              <TableCell className="text-slate-300">
                                ${(currentPrice * position.quantity).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {isPositive ? (
                                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                                  ) : (
                                    <TrendingDown className="h-4 w-4 text-red-400" />
                                  )}
                                  <span
                                    className={`font-semibold ${
                                      isPositive
                                        ? 'text-emerald-400'
                                        : 'text-red-400'
                                    }`}
                                  >
                                    {isPositive ? '+' : ''}${pl.toFixed(2)}
                                  </span>
                                  <span
                                    className={`text-sm ${
                                      isPositive
                                        ? 'text-emerald-400/70'
                                        : 'text-red-400/70'
                                    }`}
                                  >
                                    ({isPositive ? '+' : ''}
                                    {plPercent.toFixed(2)}%)
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button 
                                  variant="destructive" 
                                  size="sm"
                                  onClick={() => handleSell(position)}
                                  className="h-8 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800"
                                >
                                  Sell
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Add New Position
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Manually add a stock position to your portfolio
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handlePreTradeCheck} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   {/* 修改 Symbol 輸入區塊 */}
                    <div className="space-y-2">
                      <Label htmlFor="symbol" className="text-slate-300">
                        Symbol
                      </Label>
                      <div className="relative">
                        <Input
                          id="symbol"
                          placeholder="AAPL"
                          value={formData.symbol}
                          onChange={(e) => handleSymbolChange(e.target.value)}
                          className={`bg-slate-800 text-slate-100 placeholder:text-slate-500 pr-10 ${
                            isValidSymbol === true ? 'border-emerald-500/50 focus:border-emerald-500' : 
                            isValidSymbol === false ? 'border-red-500/50 focus:border-red-500' : 
                            'border-slate-700'
                          }`}
                        />
                        {/* 右側的小圖示狀態 */}
                        <div className="absolute right-3 top-3">
                          {isChecking ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          ) : isValidSymbol === true ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : isValidSymbol === false ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : null}
                        </div>
                      </div>
                      
                      {/* 顯示股票全名 */}
                      {isValidSymbol === true && (
                        <p className="text-xs text-emerald-400 font-medium truncate">
                          {stockName}
                        </p>
                      )}
                      
                      {/* 顯示錯誤訊息 */}
                      {isValidSymbol === false && (
                        <p className="text-xs text-red-400">
                          找不到此股票代號
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="price" className="text-slate-300">
                        Purchase Price
                      </Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        placeholder="150.00"
                        value={formData.price}
                        onChange={(e) =>
                          setFormData({ ...formData, price: e.target.value })
                        }
                        className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quantity" className="text-slate-300">
                        Quantity
                      </Label>
                      <Input
                        id="quantity"
                        type="number"
                        step="0.01"
                        placeholder="10"
                        value={formData.quantity}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            quantity: e.target.value,
                          })
                        }
                        className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* 1. 交易日期選擇 */}
                    <div className="space-y-2">
                      <Label htmlFor="date" className="text-slate-300">Date</Label>
                      <Input
                        id="date"
                        type="date"
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        className="bg-slate-800 text-slate-100 border-slate-700"
                      />
                    </div>

                    {/* 2. 是否扣款 (Toggle / Checkbox) */}
                    <div className="space-y-2 flex flex-col justify-end h-full pb-2">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="deductCash"
                          checked={formData.deductCash}
                          onChange={(e) => setFormData({ ...formData, deductCash: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-600"
                        />
                        <Label htmlFor="deductCash" className="text-slate-300 cursor-pointer">
                          Deduct from Cash? (扣除現金)
                        </Label>
                      </div>
                      <p className="text-[10px] text-slate-500 pl-6">
                        如果是匯入舊倉位，請取消勾選
                      </p>
                    </div>
                  </div>
                  </div>
                  {/* --- 動態走勢圖 --- */}
                  {isValidSymbol && formData.symbol && (
                    <div className="md:col-span-3 h-[200px] rounded-lg overflow-hidden border border-slate-700/50 my-4">
                      <MiniChart 
                        symbol={formData.symbol}
                        colorTheme="dark"
                        width="100%"
                        height={200}
                        isTransparent={false}
                        autosize={false}
                      />
                    </div>
                  )}

                  <Button
                    type="submit"
                    // 只有當符號有效 (或還沒檢查) 時才允許提交，避免寫入垃圾資料
                    disabled={loading || isValidSymbol === false} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Position
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800 mt-6 lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-slate-100">Trade History</CardTitle>
                <CardDescription className="text-slate-400">
                  Your closed positions and performance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-slate-800 overflow-hidden max-h-[300px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 bg-slate-900/50">
                        <TableHead className="text-slate-300">Symbol</TableHead>
                        <TableHead className="text-slate-300">Date</TableHead>
                        <TableHead className="text-slate-300">Entry</TableHead>
                        <TableHead className="text-slate-300">Exit</TableHead>
                        <TableHead className="text-slate-300">Amount</TableHead>
                        <TableHead className="text-slate-300 text-right">P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-slate-500 py-4">
                            No transaction history.
                          </TableCell>
                        </TableRow>
                      ) : (
                        history.map((trade: any) => { // 暫時用 any，建議更新你的 TS Interface
                          // 根據 action 判斷類型
                          const isBuy = trade.action === 'BUY';
                          const isSell = trade.action === 'SELL';
                          const isDeposit = trade.action === 'DEPOSIT';
                          const isWithdraw = trade.action === 'WITHDRAW';

                          // 計算 P/L (只有 Sell 才有真正的 P/L)
                          let pnl = 0;
                          let showPnL = false;

                          if (isSell) {
                            pnl = (trade.exit_price - trade.entry_price) * trade.quantity;
                            showPnL = true;
                          } else if (isDeposit || isWithdraw) {
                            // 資金操作顯示金額流動
                            pnl = isDeposit ? trade.quantity : -trade.quantity;
                            showPnL = true;
                          }
                          // Buy 的時候 showPnL = false，不顯示 0.00

                          const isPositive = pnl >= 0;

                          return (
                            <TableRow key={trade.id} className="border-slate-800 hover:bg-slate-800/30">
                              
                              {/* 1. Action Tag (取代原本純 Symbol) */}
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <span className="font-bold text-slate-200">{trade.symbol}</span>
                                  <div className="flex">
                                    {isBuy && <Badge className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/50">BUY</Badge>}
                                    {isSell && <Badge className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border-purple-500/50">SELL</Badge>}
                                    {isDeposit && <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border-emerald-500/50">DEPOSIT</Badge>}
                                    {isWithdraw && <Badge className="bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border-orange-500/50">WITHDRAW</Badge>}
                                  </div>
                                </div>
                              </TableCell>

                              <TableCell className="text-slate-400 text-xs">
                                {new Date(trade.exit_date).toLocaleDateString()}
                              </TableCell>

                              {/* 2. Price Details */}
                              <TableCell className="text-slate-400">
                                {/* 如果是資金操作，不顯示價格 */}
                                {isDeposit || isWithdraw ? '-' : `$${trade.entry_price?.toFixed(2)}`}
                              </TableCell>
                              <TableCell className="text-slate-400">
                                {/* 只有 Sell 才顯示賣出價，Buy 顯示 - */}
                                {isSell ? `$${trade.exit_price?.toFixed(2)}` : '-'}
                              </TableCell>
                              
                              {/* 3. Quantity */}
                              <TableCell className="text-slate-400">
                                {isDeposit || isWithdraw ? '-' : trade.quantity}
                              </TableCell>

                              {/* 4. Amount / PnL */}
                              <TableCell className="text-right font-bold">
                                {showPnL ? (
                                    <span className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                                      {isPositive ? '+' : ''}{pnl.toFixed(2)}
                                    </span>
                                ) : (
                                    <span className="text-slate-600">-</span> 
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            {/* --- 新增：淨值走勢圖 (Net Worth Curve) --- */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <span className="text-xl">📈</span> Net Worth History
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Track your total equity growth over time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[250px] w-full">
                  {equityData.length < 2 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
                      <p>Collecting data...</p>
                      <p className="text-xs">你需要至少兩天的登入紀錄才能看到走勢線</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={equityData}>
                        <defs>
                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis 
                          dataKey="date" 
                          stroke="#64748b" 
                          tick={{fontSize: 12}}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis 
                          stroke="#64748b" 
                          tick={{fontSize: 12}}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} // 簡化顯示 e.g. $105k
                          domain={['auto', 'auto']} // 自動調整上下限，讓波動看起來明顯
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                          formatter={(value: number) => [`$${value.toLocaleString()}`, 'Net Worth']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="value" 
                          stroke="#10b981" // 翡翠綠
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorValue)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <div className="lg:col-span-1 space-y-6"> {/* 修改這裡加入 space-y-6 讓卡片有間距 */}
            
            {/* --- 新增：資產配置圓餅圖 --- */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <span className="text-xl">🍰</span> Asset Allocation
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Cash vs. Equity distribution
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60} // 做成甜甜圈圖 (Donut Chart) 比較好看
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {allocationData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.name === 'Cash' ? '#334155' : COLORS[index % COLORS.length]} 
                            stroke="rgba(0,0,0,0)" // 去掉邊框
                          />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                        itemStyle={{ color: '#f8fafc' }}
                        formatter={(value: number) => `$${value.toLocaleString()}`}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={36}
                        iconType="circle"
                        formatter={(value, entry: any) => (
                          <span className="text-slate-300 ml-1">{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* --- 修改後的 AI Portfolio Analysis 卡片 --- */}
            <Card className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 border-slate-800 sticky top-6">
              <CardHeader>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-400" />
                  AI Portfolio Analysis
                </CardTitle>
                <CardDescription className="text-slate-400">
                  On-demand insights powered by GPT-4
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                
                {/* 1. 如果還沒分析，顯示按鈕 */}
                {!analysisResult && !analyzing && (
                  <div className="text-center py-6 space-y-4">
                    <p className="text-sm text-slate-400">
                      點擊下方按鈕，讓 AI 根據即時大盤與您的持倉進行完整健檢。
                    </p>
                    <Button 
                      onClick={handleManualAnalysis}
                      className="bg-blue-600 hover:bg-blue-700 text-white w-full"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      開始分析 (Analyze Now)
                    </Button>
                  </div>
                )}

                {/* 2. 分析中 (Loading) */}
                {analyzing && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-3">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                    <p className="text-sm text-slate-400 animate-pulse">
                      正在讀取大盤數據與歷史交易...
                    </p>
                  </div>
                )}

                {/* 3. 分析結果 (Markdown 樣式) */}
                {analysisResult && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700 text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                      {analysisResult}
                    </div>
                    
                    {/* 重新分析按鈕 */}
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleManualAnalysis}
                      className="w-full border-slate-700 hover:bg-slate-800"
                    >
                      刷新分析 (Refresh)
                    </Button>
                  </div>
                )}
                
              </CardContent>
            </Card>
          </div>
          </div>
        </div>
      </div>
      {showConfirmation && (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-slate-900 border-slate-700 shadow-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              🤖 AI 交易副駕駛
            </CardTitle>
            <CardDescription>
              在您買入 {pendingTrade?.symbol} 之前，請先聽聽分析
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
              <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                {tradeAdvice || <span className="animate-pulse">正在連線華爾街大數據...</span>}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button 
                variant="outline" 
                className="flex-1 border-slate-600 hover:bg-slate-800"
                onClick={() => setShowConfirmation(false)} // 取消
              >
                再想想
              </Button>
              <Button 
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={confirmTrade} // 確認執行
              >
                無視警告，執行交易
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )}
    {user && <ChatBot userId={user.id} />}
    </div>


    
  );
    
}