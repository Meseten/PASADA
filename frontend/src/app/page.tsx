"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="absolute top-6 right-6 p-2 rounded-full bg-card border shadow-sm hover:bg-accent transition-colors">
      {theme === "dark" ? <Sun size={20} className="text-slate-200" /> : <Moon size={20} className="text-slate-700" />}
    </button>
  )
}

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverReady, setServerReady] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const checkServer = async () => {
      try {
        const res = await fetch(`${API_URL}/stats/global`);
        if (res.ok) {
          setServerReady(true);
          clearInterval(interval);
        }
      } catch (e) {
        setServerReady(false);
      }
    };
    checkServer();
    interval = setInterval(checkServer, 1500);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverReady) return;
    setLoading(true);
    setError("");

    try {
      const formData = new URLSearchParams();
      formData.append("username", username);
      formData.append("password", password);

      const res = await fetch(`${API_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      if (res.ok) {
        const data = await res.json();
        
        localStorage.setItem("pasada_token", data.access_token);
        localStorage.setItem("pasada_full_name", data.full_name);
        localStorage.setItem("pasada_role", data.role || "Clerk");
        
        localStorage.setItem("token", data.access_token);
        localStorage.setItem("full_name", data.full_name);
        
        router.push("/dashboard");
      } else {
        const errData = await res.json();
        setError(errData.detail || "Invalid credentials");
      }
    } catch (err) {
      setError("Server connection failed. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 text-foreground p-4 relative">
      <ThemeToggle />
      <div className="max-w-md w-full bg-card border border-border p-8 rounded-2xl shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-full flex items-center justify-center text-xl font-bold mb-4 shadow-sm">
            P
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">PASADA</h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">Predictive Franchise Administration System</p>
        </div>

        {!serverReady ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-8 bg-muted/30 rounded-xl border border-border">
            <Loader2 className="h-8 w-8 animate-spin text-slate-900 dark:text-white" />
            <p className="text-sm font-bold text-slate-900 dark:text-white animate-pulse">Booting local server engine...</p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded-lg font-bold text-center">
                {error}
              </div>
            )}
            
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Authorized Full Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="E.g. JUAN DELA CRUZ"
                className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all uppercase text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="space-y-1.5 relative">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Secure Passcode</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all pr-12 text-slate-900 dark:text-white"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-900 dark:hover:text-white p-1 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 text-white font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 mt-2 shadow-md"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : "Secure Login"}
            </button>
          </form>
        )}

        <div className="mt-8 text-center border-t border-border pt-6">
          <p className="text-sm text-muted-foreground font-medium">
            New Administrative Personnel?{" "}
            <button onClick={() => router.push("/signup")} className="text-slate-900 dark:text-white hover:underline font-bold">
              Register Account
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}