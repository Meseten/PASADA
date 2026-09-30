"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { API_URL, describeAuthError } from "@/lib/api";

function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) return <div className="absolute top-6 right-6 w-10 h-10" />;
    // Same position and status semantics as the login page's toggle: an
    // absolutely-positioned 40px circle. WebView2 on older Windows 10 builds
    // mis-renders flex-centered icon pairs, so the plain variant here keeps
    // one icon per state, exactly like the login page.
    const isDark = theme === "dark";
    const tooltip = isDark
        ? "Dark Mode is ON. Click to switch to Light Mode."
        : "Light Mode is ON. Click to switch to Dark Mode.";
    return (
        <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            data-tip={tooltip}
            aria-label={tooltip}
            title={tooltip}
            className="absolute top-6 right-6 flex items-center justify-center w-10 h-10 rounded-full bg-card border shadow-sm hover:bg-accent transition-colors z-50"
        >
            {isDark ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-slate-700" />}
        </button>
    );
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

    // DIAGNOSTIC STATE
    const [connError, setConnError] = useState("");

    useEffect(() => {
        let interval: NodeJS.Timeout;
        const checkServer = async () => {
            try {
                // FIX: Match the login page's health probe to unblock the UI
                const res = await fetch(`${API_URL}/health?_t=${Date.now()}`, { method: "GET", cache: "no-store" });
                if (res.ok) {
                    setServerReady(true);
                    setConnError("");
                    clearInterval(interval);
                } else {
                    setConnError(`Server returned status: ${res.status}`);
                }
            } catch (e: any) {
                setServerReady(false);
                setConnError(e.message || String(e));
            }
        };
        
        checkServer();
        interval = setInterval(checkServer, 1500);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const autoGen = `${firstName.trim()} ${lastName.trim()}`.trim();
        setUsername(autoGen);
    }, [firstName, lastName]);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!serverReady) return;
        
        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        
        setLoading(true);
        setError("");
        
        try {
            const res = await fetch(`${API_URL}/signup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    // uppercase sa submit na lang (yung input may text-transform sa CSS)
                    first_name: firstName.trim().toUpperCase(),
                    last_name: lastName.trim().toUpperCase(),
                    username: username.trim().toUpperCase(),
                    password: password,
                    role: "Clerk", 
                }),
            });
            
            if (res.ok) {
                router.push("/");
            } else {
                const errData = await res.json().catch(() => ({}));
                setError(errData.detail || "Registration failed. Username may already be taken.");
            }
        } catch (err) {
            setError(describeAuthError(err, "Cannot connect to PASADA. Open the PASADA program on this computer first, then try again."));
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
                    <p className="text-muted-foreground mt-1 text-sm font-medium">Register New Account</p>
                </div>
                
                {!serverReady ? (
                    <div className="flex flex-col items-center justify-center space-y-4 py-8 bg-muted/30 rounded-xl border border-border">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-900 dark:text-white" />
                        <p className="text-sm font-bold text-slate-900 dark:text-white animate-pulse">Connecting to server...</p>
                        
                        {/* ON-SCREEN DIAGNOSTIC OUTPUT */}
                        {connError && (
                            <p className="text-[10px] font-mono text-red-500 max-w-xs text-center break-words opacity-80 px-4">
                                Diagnostic: {connError}
                            </p>
                        )}
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
                                    onChange={(e) => setFirstName(e.target.value)}
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
                                    onChange={(e) => setLastName(e.target.value)}
                                    onBlur={() => setLastName(lastName.trim())}
                                    className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all uppercase text-slate-900 dark:text-white"
                                    required
                                />
                            </div>
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Full Username</label>
                            <input
                                type="text"
                                value={username}
                                readOnly
                                className="w-full bg-muted/60 border border-border rounded-lg px-4 py-3 text-sm font-bold text-slate-500 dark:text-slate-400 cursor-not-allowed uppercase"
                            />
                        </div>
                        
                        <div className="space-y-1.5 relative">
                            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Password (8+ Characters)</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="********"
                                    className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all pr-12 text-slate-900 dark:text-white [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    data-tip={showPassword ? "Hide the password" : "Show the password"}
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
                            Log In
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}