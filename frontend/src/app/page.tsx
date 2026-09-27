// 25010 Characteristic: Usability, Reliability  
"use client";  
  
import { useState, useEffect } from "react";  
import { useRouter } from "next/navigation";  
import { Eye, EyeOff, Loader2, Moon, Sun, ShieldQuestion, ArrowLeft, KeyRound, Lock } from "lucide-react";  
import { useTheme } from "next-themes";  
import { API_URL } from "@/lib/api";  

function ThemeToggle() {  
  const { theme, setTheme } = useTheme();  
  const [mounted, setMounted] = useState(false);  

  useEffect(() => setMounted(true), []);  
  if (!mounted) return <div className="absolute top-6 right-6 w-10 h-10" />;  

  // Same status semantics as the sidebar control: the icon shows which mode
  // is ON right now, and the label says so out loud.
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
      <Sun className={`absolute w-5 h-5 transition-all duration-300 ${isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100 text-amber-500"}`} />  
      <Moon className={`absolute w-5 h-5 transition-all duration-300 ${isDark ? "rotate-0 scale-100 opacity-100 text-slate-200" : "-rotate-90 scale-0 opacity-0"}`} />  
    </button>  
  );  
}  

type RecoverStep = "username" | "questions" | "newpass";

export default function Login() {  
  const router = useRouter();  
  const [username, setUsername] = useState("");  
  const [password, setPassword] = useState("");  
  const [showPassword, setShowPassword] = useState(false);  
  const [error, setError] = useState("");  
  const [loading, setLoading] = useState(false);  
  const [serverReady, setServerReady] = useState(false);  
  const [isCheckingSession, setIsCheckingSession] = useState(true);  

  // DIAGNOSTIC STATE
  const [connError, setConnError] = useState("");

  // FORGOT PASSWORD (SECURITY QUESTIONS) STATE
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [recoverStep, setRecoverStep] = useState<RecoverStep>("username");
  const [recQuestions, setRecQuestions] = useState<{ q1: string; q2: string; q3: string } | null>(null);
  const [recAnswers, setRecAnswers] = useState({ a1: "", a2: "", a3: "" });
  const [recUsername, setRecUsername] = useState("");
  const [recNewPassword, setRecNewPassword] = useState("");
  const [recSuccess, setRecSuccess] = useState("");

  useEffect(() => {  
    if (typeof window !== "undefined" && (localStorage.getItem("token") || localStorage.getItem("pasada_token"))) {  
      router.replace("/dashboard");  
      return;  
    }  
    setIsCheckingSession(false);  
  
    let interval: NodeJS.Timeout;  
    const checkServer = async () => {  
      try {  
        const res = await fetch(`${API_URL}/health?_t=${Date.now()}`, {  
          method: "GET",  
          cache: "no-store"  
        });  
        if (res.ok) {  
          setServerReady(true);  
          setConnError(""); // Clear error on success
          if (interval) clearInterval(interval);  
        } else {
          setConnError(`Server returned status: ${res.status}`);
        }
      } catch (e: any) {  
        setServerReady(false);  
        setConnError(e.message || String(e));
      }  
    };  
    checkServer();  
    interval = setInterval(checkServer, 1000);  
    return () => {  
      if (interval) clearInterval(interval);  
    };  
  }, [router]);  
  
  const handleLogin = async (e: React.FormEvent) => {  
    e.preventDefault();  
    if (!serverReady) return;  
  
    setLoading(true);  
    setError("");  
  
    try {  
      const res = await fetch(`${API_URL}/token`, {  
        method: "POST",  
        headers: {  
            "Content-Type": "application/json",  
        },  
        body: JSON.stringify({  
            // uppercase sa submit na lang, yung input may text-transform na sa CSS
            username: username.trim().toUpperCase(),  
            password: password  
        }),  
        cache: "no-store"  
      });  
  
      if (res.ok) {  
        const data = await res.json();  
        localStorage.setItem("pasada_token", data.access_token);  
        localStorage.setItem("pasada_full_name", data.full_name);  
        localStorage.setItem("pasada_role", data.role || "Clerk");  
  
        localStorage.setItem("token", data.access_token);  
        localStorage.setItem("full_name", data.full_name);  
  
        router.replace("/dashboard");  
      } else {  
        const errData = await res.json();  
        setError(errData.detail || "Invalid login credentials.");  
      }  
    } catch (err) {  
      setError("Cannot connect to PASADA. Open the PASADA program on this computer first, then try again.");  
    } finally {  
      setLoading(false);  
    }  
  };  

  // --- RECOVERY FLOW ---
  const startRecovery = () => {
    setMode("recover");
    setRecoverStep("username");
    setError("");
    setRecSuccess("");
    setRecQuestions(null);
    setRecAnswers({ a1: "", a2: "", a3: "" });
    setRecNewPassword("");
  };

  const handleRecoverLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverReady) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/recovery/questions?username=${encodeURIComponent(recUsername.trim())}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecQuestions({ q1: data.q1, q2: data.q2, q3: data.q3 });
        setRecoverStep("questions");
      } else {
        setError(data.detail || "Could not find recovery questions for that account.");
      }
    } catch (err) {
      setError("Cannot connect to PASADA. Open the PASADA program on this computer first, then try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverReady) return;
    if (recNewPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/recovery/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: recUsername.trim(),
          a1: recAnswers.a1,
          a2: recAnswers.a2,
          a3: recAnswers.a3,
          new_password: recNewPassword,
        }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecSuccess(data.message || "Password updated. You can now sign in with the new password.");
        setTimeout(() => {
          setMode("login");
          setUsername(recUsername.trim().toUpperCase());
        }, 2500);
      } else {
        setError(data.detail || "Recovery did not go through. Check your answers and try again.");
      }
    } catch (err) {
      setError("Cannot connect to PASADA. Open the PASADA program on this computer first, then try again.");
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => {
    setMode("login");
    setError("");
    setRecSuccess("");
    setRecQuestions(null);
  };
  
  if (isCheckingSession) return null;  
  
  return (  
    <div className="min-h-screen flex items-center justify-center bg-muted/20 text-foreground p-4 relative">  
      <ThemeToggle />  
  
      <div className="max-w-md w-full bg-card border border-border p-8 rounded-2xl shadow-xl">  
        <div className="flex flex-col items-center mb-8">  
          <img src="/TFRU.png" alt="TFRU Logo" className="w-20 h-20 object-contain mb-2 rounded-full shadow-md border border-border" />  
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">PASADA</h1>  
          <p className="text-muted-foreground mt-1 text-sm font-medium">
            {mode === "login" ? "Franchise Registry System" : "Account Recovery"}
          </p>  
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
        ) : mode === "login" ? (  
          <form onSubmit={handleLogin} className="space-y-5 animate-in fade-in">  
            {error && (  
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded-lg font-bold text-center" role="alert">  
                {error}  
              </div>  
            )}  
  
            <div className="space-y-1.5">  
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Full Name</label>  
              <input   
                type="text"   
                value={username}   
                onChange={(e) => setUsername(e.target.value)}   
                placeholder="E.g. JUAN DELA CRUZ"
                aria-label="Full Name"
                data-tip="The full name you registered, e.g. JUAN DELA CRUZ"
                className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-slate-900/50 dark:focus:ring-white/50 transition-all uppercase text-slate-900 dark:text-white"   
                required   
              />  
            </div>  
  
            <div className="space-y-1.5 relative">  
              <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Password</label>  
              <div className="relative">  
                <input   
                  type={showPassword ? "text" : "password"}   
                  value={password}   
                  onChange={(e) => setPassword(e.target.value)}   
                  placeholder="********"
                  aria-label="Password"
                  data-tip="Your PASADA password. Forgot it? Use Forgot Password below."
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
              {loading ? <Loader2 size={18} className="animate-spin" /> : "Log In"}  
            </button>  

            <div className="text-center">
              <button
                type="button"
                onClick={startRecovery}
                data-tip="Locked out? Answer your three security questions to set a new password on this computer."
                className="text-sm text-muted-foreground hover:text-blue-600 font-bold transition-colors inline-flex items-center gap-1.5"
              >
                <ShieldQuestion size={14} /> Forgot Password?
              </button>
            </div>
          </form>  
        ) : (
          <div className="space-y-5 animate-in fade-in">
            {error && (  
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded-lg font-bold text-center" role="alert">  
                {error}  
              </div>  
            )}
            {recSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm rounded-lg font-bold text-center">
                <Lock size={14} className="inline mr-1.5" /> {recSuccess}
              </div>
            )}

            {recoverStep === "username" && (
              <form onSubmit={handleRecoverLookup} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Step 1 of 3: Your Account</label>
                  <input
                    type="text"
                    value={recUsername}
                    onChange={(e) => setRecUsername(e.target.value)}
                    placeholder="E.g. JUAN DELA CRUZ"
                    aria-label="Account full name"
                    data-tip="The full name on the account you want to recover"
                    className="w-full bg-muted/40 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all uppercase text-slate-900 dark:text-white"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  data-tip="Finds your security questions. They were set in Settings > Security, or when the account was created."
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-60"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />} Find My Questions
                </button>
              </form>
            )}

            {recoverStep === "questions" && recQuestions && (
              <form onSubmit={handleRecoverReset} className="space-y-4">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Step 2 of 3: Answer Your Questions</p>
                {([recQuestions.q1, recQuestions.q2, recQuestions.q3] as const).map((q, i) => (
                  <div key={i} className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground">{q}</label>
                    <input
                      type="text"
                      value={[recAnswers.a1, recAnswers.a2, recAnswers.a3][i]}
                      onChange={(e) => setRecAnswers((prev) => ({ ...prev, [`a${i + 1}`]: e.target.value }))}
                      className="w-full bg-muted/40 border border-border rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-white"
                      data-tip={`Answer to security question ${i + 1}. Capitalization does not matter.`}
                      aria-label={q}
                      required
                    />
                  </div>
                ))}
                <div className="border-t border-border pt-4 space-y-1.5">
                  <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">New Password (8+ characters)</label>
                  <input
                    type="password"
                    value={recNewPassword}
                    onChange={(e) => setRecNewPassword(e.target.value)}
                    placeholder="********"
                    aria-label="New password"
                    data-tip="The new password you will use from now on. At least 8 characters."
                    className="w-full bg-muted/40 border border-border rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-900 dark:text-white [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  data-tip="Checks all three answers and sets the new password in one go. Five wrong tries locks recovery for 15 minutes."
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-60"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />} Verify and Set New Password
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={backToLogin}
              data-tip="Back to the sign-in screen"
              className="w-full text-sm text-muted-foreground hover:text-slate-900 dark:hover:text-white font-bold transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <ArrowLeft size={14} /> Back to Log In
            </button>
          </div>
        )}  
  
        {mode === "login" && (
          <div className="mt-8 text-center border-t border-border pt-6">  
            <p className="text-sm text-muted-foreground font-medium">  
              No account yet?{" "}  
              <button onClick={() => router.push("/signup")} data-tip="Create the first account on this computer" className="text-slate-900 dark:text-white hover:underline font-bold">  
                Register Account  
              </button>  
            </p>  
          </div>  
        )}
      </div>  
    </div>  
  );  
}  
