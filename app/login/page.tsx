// app/login/page.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

// 初始化 Supabase Client (這裡直接用環境變數)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage('登入失敗: ' + error.message)
    } else {
      router.push('/') // 登入成功跳轉回首頁
      router.refresh()
    }
    setLoading(false)
  }

  const handleSignUp = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setMessage('註冊失敗: ' + error.message)
    } else {
      setMessage('註冊成功！請檢查信箱驗證連結，或直接嘗試登入（視 Supabase 設定而定）。')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-xl border border-gray-700">
        <h2 className="text-3xl font-bold text-center text-blue-500">AI Stock Agent</h2>
        <p className="text-center text-gray-400">請先登入以管理您的投資組合</p>
        
        {message && (
          <div className="p-3 text-sm bg-gray-700 border border-gray-600 rounded text-yellow-300">
            {message}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              required
              className="w-full p-3 rounded bg-gray-900 border border-gray-700 focus:border-blue-500 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">密碼</label>
            <input
              type="password"
              required
              className="w-full p-3 rounded bg-gray-900 border border-gray-700 focus:border-blue-500 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 font-bold text-white bg-blue-600 rounded hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? '處理中...' : '登入 (Sign In)'}
          </button>
        </form>

        <div className="text-center">
          <button
            onClick={handleSignUp}
            disabled={loading}
            className="text-sm text-gray-400 hover:text-white underline"
          >
            還沒有帳號？點此註冊 (Sign Up)
          </button>
        </div>
      </div>
    </div>
  )
}