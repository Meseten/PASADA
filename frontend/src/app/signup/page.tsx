"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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

  const handleFirstNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setFirstName(val);
    setUsername(`${val} ${lastName}`.trim());
  };

  const handleLastNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setLastName(val);
    setUsername(`${firstName} ${val}`.trim());
  };

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
          first_name: firstName,
          last_name: lastName,
          username: username,
          password: password,
          role: "CLERK"
        }),
      });

      if (res.ok) {
        router.push("/");
      } else {
        const errData = await res.json();
        setError(errData.detail || "Registration failed");
      }
    } catch (err) {
      setError("Server connection failed. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 text-foreground p-4">
      <div className="max-w-md w-full bg-card border border-border p-8 rounded-2xl shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-slate-900 text-white rounded-full flex items-center justify-center text-xl font-bold mb-4 shadow-sm">
            P
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">PASADA</h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">Personnel Registration Portal</p>
        </div>

        {!serverReady ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-8 bg-muted/30 rounded-xl border border-border">
            <Loader2 className="h-8 w-8 animate-spin text-slate-900" />
            <p className="text-sm font-bold text-slate-900 animate-pulse">Booting local server engine...</p>
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
                  onChange={handleFirstNameChange}
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 transition-all text-slate-900"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={handleLastNameChange}
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 transition-all text-slate-900"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Authorized Full Name</label>
              <input
                type="text"
                value={username}
                readOnly
                className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-sm cursor-not-allowed font-black text-slate-500"
              />
              <p className="text-[11px] text-muted-foreground pt-1 font-medium">This exact name will be permanently tied to your audit trail.</p>
            </div>

            <div className="space-y-1.5 relative">
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Secure Passcode</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 transition-all pr-12 text-slate-900"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-900 p-1 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 mt-2 shadow-md"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : "Create Account"}
            </button>
          </form>
        )}

        <div className="mt-8 text-center border-t border-border pt-6">
          <p className="text-sm text-muted-foreground font-medium">
            Already authorized?{" "}
            <button onClick={() => router.push("/")} className="text-slate-900 hover:underline font-bold">
              Return to Login
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}