"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const API_URL = "http://127.0.0.1:43888";

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="absolute top-6 right-6 p-2 rounded-full bg-card border shadow-sm hover:bg-accent transition-colors">
      {theme === "dark" ? <Sun size={20} className="text-slate-200" /> : <Moon size={20} className="text-slate-700" />}
    </button>
  )
}

export default function Signup() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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

  // DEFINITIVE FIX: Auto-generates Username based on trimmed names
  useEffect(() => {
    const autoGen = `${firstName.trim()} ${lastName.trim()}`.trim();
    setUsername(autoGen);
  }, [firstName, lastName]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverReady) return;
    
    if (password.length < 8) {
      setError("Passcode must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          username: username.trim(),
          password: password,
          role: "Clerk", 
        }),
      });

      if (res.ok) {
        router.push("/");
      } else {
        const errData = await res.json();
        setError(errData.detail || "Registration failed. Username may be taken.");
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
          <img src="/TFRU.png" alt="TFRU Logo" className="w-20 h-20 object-contain mb-2 rounded-full shadow-md border border-border bg-white" />
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">PASADA</h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">New Administrative Registration</p>
        </div>

        {!serverReady ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-8 bg-muted/30 rounded-xl border border-border">
            <Loader2 className="h-8 w-8 animate-spin text-slate-900 dark:text-white" />
            <p className="text-sm font-bold text-slate-900 dark:text-white animate-pulse">Connecting to local server...</p>
          </div>
        ) : (
          <form onSubmit={handleSignup} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded-lg font-bold text-center">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value.toUpperCase())}
                  onBlur={() => setFirstName(firstName.trim())}
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all uppercase text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value.toUpperCase())}
                  onBlur={() => setLastName(lastName.trim())}
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all uppercase text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">System Username</label>
              <input
                type="text"
                value={username}
                readOnly
                className="w-full bg-muted/60 border border-border rounded-lg px-4 py-3 text-sm font-bold text-slate-500 dark:text-slate-400 cursor-not-allowed uppercase"
              />
            </div>

            <div className="space-y-1.5 relative">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Secure Passcode (Min. 8)</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  // DEFINITIVE FIX: Removes the duplicated Windows Edge eye icon
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all pr-12 text-slate-900 dark:text-white [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
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
              {loading ? <Loader2 size={18} className="animate-spin" /> : "Complete Registration"}
            </button>
          </form>
        )}

        <div className="mt-8 text-center border-t border-border pt-6">
          <p className="text-sm text-muted-foreground font-medium">
            Return to {" "}
            <button onClick={() => router.push("/")} className="text-slate-900 dark:text-white hover:underline font-bold">
              Secure Login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}