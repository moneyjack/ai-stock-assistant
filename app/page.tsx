'use client';

import { useState, useEffect } from 'react';
import { supabase, type Position } from '@/lib/supabase';
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
import { TrendingUp, TrendingDown, Plus, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null); // <--- 新增：用來存當前用戶資料
  const [formData, setFormData] = useState({
    symbol: '',
    price: '',
    quantity: '',
  });
  
  const router = useRouter(); // <--- 新增：初始化 router
  const { toast } = useToast();

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
      fetchPositions();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.symbol || !formData.price || !formData.quantity) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all fields',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: 'Error',
        description: 'User not logged in',
        variant: 'destructive',
      });
      return;
    }

    try {
      // <--- 關鍵修改：這裡加入了 user_id: user.id
      const { error } = await supabase.from('positions').insert([
        {
          symbol: formData.symbol.toUpperCase(),
          avg_price: parseFloat(formData.price),
          quantity: parseFloat(formData.quantity),
          user_id: user.id // 這行是解鎖 RLS 42501 錯誤的關鍵
        },
      ]);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Position added successfully',
      });

      setFormData({ symbol: '', price: '', quantity: '' });
      fetchPositions(); // 新增完後重新抓取列表
    } catch (error) {
      console.error('Error adding position:', error);
      toast({
        title: 'Error',
        description: 'Failed to add position: ' + error,
        variant: 'destructive',
      });
    }
  };

  const calculatePL = (position: Position) => {
    // 這裡目前還是假邏輯 (現價 = 買入價 * 1.05)，之後我們會接真實股價 API
    const currentPrice = position.avg_price ? position.avg_price * 1.05 : 0; 
    // 注意：我把 position.price 改成了 position.avg_price 以配合資料庫欄位
    // 如果你的 TypeScript 報錯，請確認 lib/supabase.ts 裡的 Position 定義是否有 avg_price
    
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="container mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between pb-6 border-b border-slate-800">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Portfolio Dashboard
            </h1>
            <p className="text-slate-400 mt-1">
              Track and manage your investments
            </p>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <p className="text-sm text-slate-400">Total Value</p>
              <p className="text-2xl font-bold">${totalValue.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400">Total P/L</p>
              <p
                className={`text-2xl font-bold ${
                  totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
              </p>
            </div>
          </div>
        </header>

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
                              className="border-slate-800 hover:bg-slate-800/50"
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
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="symbol" className="text-slate-300">
                        Symbol
                      </Label>
                      <Input
                        id="symbol"
                        placeholder="AAPL"
                        value={formData.symbol}
                        onChange={(e) =>
                          setFormData({ ...formData, symbol: e.target.value })
                        }
                        className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                      />
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
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Position
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 border-slate-800 sticky top-6">
              <CardHeader>
                <CardTitle className="text-slate-100 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-400" />
                  AI Portfolio Analysis
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Insights powered by AI
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                  <h3 className="font-semibold text-slate-100 mb-2">
                    Portfolio Health
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    Your portfolio shows strong diversification across sectors.
                    Current market conditions suggest a balanced approach to
                    risk management.
                  </p>
                </div>

                <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                  <h3 className="font-semibold text-slate-100 mb-2">
                    Key Insights
                  </h3>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="text-emerald-400 mt-1">•</span>
                      <span>Tech sector showing strong momentum</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-400 mt-1">•</span>
                      <span>Consider rebalancing after recent gains</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-400 mt-1">•</span>
                      <span>Monitor volatility in current holdings</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                  <h3 className="font-semibold text-slate-100 mb-2">
                    Risk Level
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-emerald-400 to-blue-400 h-full rounded-full"
                        style={{ width: '65%' }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-slate-300">
                      Moderate
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}