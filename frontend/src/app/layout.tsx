"use client"
import "./globals.css"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState, useCallback, useRef } from "react"
import { 
  Moon, 
  Sun, 
  UploadCloud, 
  ArchiveX, 
  Settings, 
  LogOut, 
  LayoutDashboard, 
  ClipboardList, 
  Map, 
  Pin, 
  Trash2, 
  Lock, 
  Unlock, 
  AlertTriangle, 
  ShieldCheck, 
  Wifi, 
  WifiOff, 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Copy,
  ClipboardPaste,
  ListChecks,
  Printer 
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { API_URL, fetchWithAuth, clearAuthAndRedirect } from "@/lib/api"
import { startTour, stopTour } from "@/lib/tutorial"

// THEME STATUS: the button always shows which mode is ON right now (sun = Light
// Mode ON, moon = Dark Mode ON), with a matching tooltip and aria-label. The
// title mirrors the tooltip for native hover outside the webview.
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-8 h-8" />
  const isDark = theme === "dark"
  const tooltip = isDark
    ? "Dark Mode is ON. Click to switch to Light Mode."
    : "Light Mode is ON. Click to switch to Dark Mode."
  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      data-tip={tooltip}
      data-tip-side="right"
      data-tour="theme-toggle"
      aria-label={tooltip}
      title={tooltip}
      className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent transition-colors"
    >
      <Sun className="absolute h-4 w-4 transition-all duration-300 rotate-0 scale-100 dark:-rotate-90 dark:scale-0 text-amber-600 dark:text-amber-300" />
      <Moon className="absolute h-4 w-4 transition-all duration-300 rotate-90 scale-0 dark:rotate-0 dark:scale-100 text-slate-500 dark:text-slate-200" />
    </button>
  )
}

// HOISTED ROUTE ITEM: Prevents React from trashing the component instance and resetting scroll
const RouteItem = ({ route, isPinned, pathname, togglePin, deleteRoute, showDelete }: { route: string, isPinned: boolean, pathname: string, togglePin: (e: React.MouseEvent, r: string) => void, deleteRoute: (e: React.MouseEvent, r: string) => void, showDelete: boolean }) => {
  // Trailing-slash-proof comparison so the current route lights up the same
  // way in dev and in the packaged app.
  const norm = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const isActive = norm === `/toda/${route}`;
  return (
  <div className="relative group flex items-center">
      <Link 
        href={`/toda/${route}`} 
        prefetch={false} 
        aria-current={isActive ? 'page' : undefined}
        className={`flex-1 min-w-0 flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${isActive ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}
      >
          <Map className="mr-2 h-4 w-4 opacity-50" /> <span className="truncate">{route}</span>
      </Link>
      {/* PIN/DELETE: aria-labels only, no tooltip bubbles. The nav is the
          sidebar's own scroll container, so any bubble poking sideways here
          reappears as a sideways scrollbar on the TODA Lines list itself.
          DELETE shows for the Admin only: wiping a whole line is an office
          decision, and the API refuses it for clerks anyway. */}
      <div className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-card px-1 rounded">
          <button
            onClick={(e) => togglePin(e, route)}
            aria-label={isPinned ? "Unpin Route" : "Pin Route"}
            title={isPinned ? "Unpin this route from the top" : "Pin this route to the top"}
            className="p-1 hover:text-blue-600 transition-colors"
          >
              <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current text-blue-600' : 'text-slate-400'}`} />
          </button>
          {showDelete && (
            <button
              onClick={(e) => deleteRoute(e, route)}
              aria-label="Delete Entire Route"
              title={`Delete the ${route} line and every record on it. Asks first. Admin only.`}
              className="p-1 hover:text-red-600 transition-colors"
            >
                <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
            </button>
          )}
      </div>
  </div>
  );
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [activeRoutes, setActiveRoutes] = useState<string[]>([])
  const [pinnedRoutes, setPinnedRoutes] = useState<string[]>([])
  const [routeSearch, setRouteSearch] = useState("")
  const [globalSearch, setGlobalSearch] = useState("")
  const [userName, setUserName] = useState("System User")
  const [userRole, setUserRole] = useState("Clerk")
  const [isNetworkOnline, setIsNetworkOnline] = useState(true)
  // Set once the account name is known: the LAN broadcast name IS the
  // account name, so other computers show WHO uses this machine, not a
  // PC label. Cleared on logout alongside the session.
  const [nameSyncedForUser, setNameSyncedForUser] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const isScrollingRef = useRef(false) // Guard against restoring while actively scrolling
  // Focused by the / shortcut from any non-records page (the records page
  // focuses its own search box instead).
  const globalSearchRef = useRef<HTMLInputElement>(null)

  // PIN Lock State
  const [isLocked, setIsLocked] = useState(false)
  const [pinInput, setPinInput] = useState("")
  const [pinError, setPinError] = useState("")

  // In the packaged app the WebView's own right-click menu offers Reload,
  // which re-requests the current route from the asset protocol and can brick
  // the window. Instead of blocking right-click entirely, a small in-app menu
  // replaces it: Back, Forward, and a SAFE Reload that re-renders through the
  // client router (never re-requests the HTML document), so right-click works
  // and reload cannot brick. The browser preview keeps its normal menu.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; copy: boolean; paste: boolean } | null>(null)
  // Bumping this remounts the page content: the honest equivalent of a browser
  // reload, but through React instead of the asset protocol.
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("__TAURI_INTERNALS__" in window)) return
    const openMenu = (e: MouseEvent) => {
      e.preventDefault()
      const selection = window.getSelection()
      setCtxMenu({
        x: Math.min(e.clientX, window.innerWidth - 210),
        y: Math.min(e.clientY, window.innerHeight - 230),
        copy: !!selection && selection.toString().length > 0,
        // Paste needs the async clipboard read; the webview may refuse it,
        // in which case the menu simply omits the item.
        paste: !!(navigator.clipboard && "readText" in navigator.clipboard),
      })
    }
    document.addEventListener("contextmenu", openMenu)
    return () => document.removeEventListener("contextmenu", openMenu)
  }, [])
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null) }
    window.addEventListener("click", close)
    window.addEventListener("blur", close)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("blur", close)
      window.removeEventListener("keydown", onKey)
    }
  }, [ctxMenu])

  // GLOBAL KEYBOARD SHORTCUTS: / focuses the sidebar search from any page
  // (records pages focus their own search instead), Alt+1..5 jump between
  // pages. Skipped while typing or when a dialog is open, and on the sign-in
  // screen. Plain browser shortcuts like Ctrl+C / Ctrl+V keep working.
  // Alt+1..5 live in the onGlobalKey handler further down, next to "/".

  // COMPUTER NAME = ACCOUNT NAME: after sign-in (and whenever it changes),
  // announce the signed-in user's name on the LAN instead of a PC name. The
  // request is authenticated, so a name can only ever be set by someone who
  // is signed in on this machine.
  useEffect(() => {
    if (normAuthPath === "/" || normAuthPath === "/signup") return
    const token = localStorage.getItem("token") || localStorage.getItem("pasada_token")
    if (!token || !userName || userName === "System User") return
    if (nameSyncedForUser === userName) return
    let cancelled = false
    fetchWithAuth(`${API_URL}/system/computer-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: userName }),
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data?.name) setNameSyncedForUser(userName) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userName, pathname, nameSyncedForUser])

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/stats/global`)
      if (res.ok) {
        const data = await res.json()
        const routes = data.route_breakdown.map((r: any) => r.route)
        // Strictly compare to avoid re-rendering and changing the array reference if identical
        setActiveRoutes(prev => (prev.length === routes.length && prev.every((r, i) => r === routes[i]) ? prev : routes))
      }
    } catch (e) {
      console.error("Sidebar route fetch failed")
    }
  }, [])

  // INITIAL MOUNT ONLY: Evaluate PIN lock status independently of pathname changes
  useEffect(() => {
    const token = localStorage.getItem("token") || localStorage.getItem("pasada_token");
    const savedPin = localStorage.getItem("pasada_pin");
    const isUnlocked = sessionStorage.getItem("pasada_pin_unlocked");
    
    if (token && savedPin && !isUnlocked) {
      setIsLocked(true);
    }
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
    
    setIsNetworkOnline(navigator.onLine)
    const handleOnline = () => setIsNetworkOnline(true)
    const handleOffline = () => setIsNetworkOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    const storedName = localStorage.getItem("pasada_full_name") || localStorage.getItem("full_name")
    const storedRole = localStorage.getItem("pasada_role")
    const storedPinned = localStorage.getItem("pasada_pinned_routes")
    
    if (storedName) setUserName(storedName)
    if (storedRole) setUserRole(storedRole)
    if (storedPinned) setPinnedRoutes(JSON.parse(storedPinned))
    
    if (normAuthPath !== "/" && normAuthPath !== "/signup") {
      fetchRoutes()
    }
    
    window.addEventListener('toda_imported', fetchRoutes)
    
    return () => {
      window.removeEventListener('toda_imported', fetchRoutes)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [pathname, fetchRoutes])

  // PERSIST SIDEBAR SCROLL POSITION
  useEffect(() => {
    // Only restore if the user isn't actively scrolling to prevent fighting the manual scroll
    if (navRef.current && !isScrollingRef.current) {
      const savedScroll = sessionStorage.getItem('sidebarScroll');
      if (savedScroll) navRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, [pathname]);

  const handleScroll = () => {
    isScrollingRef.current = true; // Set guard to true during active scrolling
    
    // Debounce the storage set to prevent synchronous disk I/O lag while scrolling
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      if (navRef.current) {
        sessionStorage.setItem('sidebarScroll', navRef.current.scrollTop.toString());
      }
      isScrollingRef.current = false; // Reset guard after debounce finishes
    }, 150);
  };

  const handleLogout = () => {
    // Forget the name sync too: the next account that signs in re-announces
    // its own name, and until then the machine keeps its last label.
    setNameSyncedForUser(null)
    clearAuthAndRedirect();
  }

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (globalSearch.trim()) {
      router.push(`/search?q=${encodeURIComponent(globalSearch.trim())}`);
      setGlobalSearch("");
    }
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const msgBuffer = new TextEncoder().encode(pinInput);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        if (hashHex === localStorage.getItem("pasada_pin")) {
            setIsLocked(false);
            sessionStorage.setItem("pasada_pin_unlocked", "true");
            setPinError("");
            setPinInput("");
        } else {
            setPinError("Incorrect PIN.");
            setPinInput("");
        }
    } catch(e) {
        setPinError("Security verification error.");
    }
  };

  const togglePin = (e: React.MouseEvent, route: string) => {
    e.preventDefault();
    e.stopPropagation();
    let updated = [...pinnedRoutes];
    if (updated.includes(route)) {
        updated = updated.filter(r => r !== route);
    } else {
        updated.push(route);
    }
    setPinnedRoutes(updated);
    localStorage.setItem("pasada_pinned_routes", JSON.stringify(updated));
  };

  const deleteRoute = async (e: React.MouseEvent, route: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete the entire ${route} line and all its records? This action cannot be undone.`)) {
        try {
            const res = await fetchWithAuth(`${API_URL}/api/routes/${route}`, {
                method: "DELETE"
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                if (body.status === "ticket_filed") {
                    // Clerk path: nothing was deleted; the Admin must approve.
                    alert(body.message || "Request sent to the Admin for approval.");
                    return;
                }
                if (pinnedRoutes.includes(route)) {
                    const updatedPins = pinnedRoutes.filter(r => r !== route);
                    setPinnedRoutes(updatedPins);
                    localStorage.setItem("pasada_pinned_routes", JSON.stringify(updatedPins));
                }
                alert(`Route ${route} deleted successfully.`);
                fetchRoutes();
                
                if (pathname === `/toda/${route}`) {
                    router.push('/dashboard');
                }
            } else {
                alert(body.detail || `Failed to delete route ${route}.`);
            }
        } catch (error) {
            alert("Network error while deleting route.");
        }
    }
  };

  // Trailing-slash-proof: the static export serves "/signup/" (trailingSlash
  // in next.config), so the raw compare flipped false mid-navigation and the
  // sidebar flashed around the login/register card (the reported "jumping").
  // Declared BEFORE the effects that read it.
  const normAuthPath = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
  const isAuthPage = normAuthPath === "/" || normAuthPath === "/signup"

  // Restore keyboard shortcuts the earlier edit removed.
  const onGlobalKey = (e: KeyboardEvent) => {
    if (isAuthPage) return
    const ae = document.activeElement as HTMLElement | null
    const isTyping = !!ae && (
      ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable
    )
    if (isTyping || document.querySelector('[role="dialog"]')) return
    if (e.key === "/" && !e.altKey && !e.ctrlKey && !e.metaKey && !pathname.startsWith("/toda/")) {
      e.preventDefault()
      globalSearchRef.current?.focus()
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const idx = ["1", "2", "3", "4", "5"].indexOf(e.key)
      if (idx >= 0) {
        e.preventDefault()
        router.push(["/dashboard", "/logs", "/import", "/inactive", "/settings"][idx])
      }
    }
  }
  useEffect(() => {
    window.addEventListener("keydown", onGlobalKey)
    return () => window.removeEventListener("keydown", onGlobalKey)
  }, [isAuthPage, router])

  // First-run tutorial: runs once per device, right after login, and can be
  // replayed from Settings. Only starts when a token already exists, so the
  // login screen itself is never covered.
  useEffect(() => {
    if (isAuthPage) return
    const token = localStorage.getItem("token") || localStorage.getItem("pasada_token")
    if (!token) return
    const seen = localStorage.getItem("pasada_tour_done")
    if (seen === "1") return
    const t = setTimeout(() => {
      localStorage.setItem("pasada_tour_done", "1")
      startTour()
    }, 400)
    return () => {
      clearTimeout(t)
      stopTour()
    }
  }, [isAuthPage])

  const filteredRoutes = activeRoutes.filter(r => r.toLowerCase().includes(routeSearch.toLowerCase()))
  const pinnedList = filteredRoutes.filter(r => pinnedRoutes.includes(r));
  const unpinnedList = filteredRoutes.filter(r => !pinnedRoutes.includes(r));

  // Trailing-slash-proof current path: dev servers and some redirects hand
  // back "/dashboard/" where the packaged app uses "/dashboard", and the
  // exact compare left the sidebar with no highlighted page at all.
  const normPath = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          /* System font stack on purpose: the desktop app runs air-gapped and
             its CSP only allows self-hosted assets, so no webfont is fetched. */
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }
          /* Tooltips: the [data-tip] attribute is the single source. ONE look
             everywhere (dark bubble, light text, both themes, same as the
             chart tooltips) so nothing flips white/black between modes. They
             appear on hover and keyboard focus after a short delay, and
             disappear INSTANTLY when the pointer leaves (fade-out has no
             delay, which is what made them feel stuck before). */
          /* LAYERED on purpose: this rule must never beat Tailwind utilities.
             Unlayered CSS wins the cascade over @layer utilities, and when it
             was unlayered it silently stripped the absolute position from every
             data-tip element that also carried the class, so the login theme
             toggle and the password eye button fell out of place on every OS
             (looked like a Windows/WebView2 bug; it was not). Inside
             the base layer, utilities like .absolute always win, while static
             elements still get the relative anchor their tooltip needs. */
          @layer base { [data-tip] { position: relative; } }
          [data-tip]::after {
            content: attr(data-tip);
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #0f172a;
            color: #f8fafc;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.4;
            padding: 5px 9px;
            border-radius: 6px;
            white-space: pre-line;
            max-width: min(280px, calc(100vw - 24px));
            width: max-content;
            text-align: center;
            pointer-events: none;
            opacity: 0;
            transition: opacity 100ms ease-out 0ms;
            z-index: 80;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          }
          [data-tip]:hover::after,
          [data-tip]:focus-visible::after {
            content: attr(data-tip);
            opacity: 1;
            transition: opacity 120ms ease-out 350ms;
          }
          [data-tip]:active::after { opacity: 0; transition: none; }
          /* keep tooltips inside the right edge of the window */
          [data-tip-align-right]:hover::after,
          [data-tip-align-right]:focus-visible::after { left: auto; right: 0; transform: none; }
          [data-tip-align-right]::after { left: auto; right: 0; transform: none; }
          /* SIDEBAR PLACEMENT: the sidebar hugs the left edge, so a centered
             bubble pokes out of the window. Elements there opt into a bubble
             that opens to the RIGHT into the open content area instead. */
          [data-tip-side='right']::after {
            bottom: auto;
            top: 50%;
            left: calc(100% + 8px);
            transform: translateY(-50%);
            text-align: left;
          }
          /* TOP-OF-PAGE PLACEMENT: a bubble above an element near the top of
             the window would be cut off; these open downward instead. */
          [data-tip-below]::after { bottom: auto; top: calc(100% + 6px); }
        `}} />
      </head>
      <body className="antialiased text-foreground bg-background">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          
          {/* ========================================================= */}
          {/* REDESIGNED PIN LOCK OVERLAY                               */}
          {/* ========================================================= */}
          {isLocked && !isAuthPage && (
              <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/40 dark:bg-black/60 backdrop-blur-md animate-in fade-in duration-300 p-4">
                  <div className="w-full max-w-[420px] bg-card border border-border/60 p-8 md:p-10 rounded-[2rem] shadow-[0_0_40px_rgba(0,0,0,0.1)] dark:shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
                      
                      {/* Subtle Top Color Accent */}
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-600" />
                      
                      <div className="flex flex-col items-center mb-8 text-center mt-2">
                          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-2xl flex items-center justify-center mb-5 shadow-sm border border-blue-100 dark:border-blue-800">
                              <ShieldCheck className="w-8 h-8" />
                          </div>
                          <h2 className="text-2xl font-black tracking-tight text-foreground">Welcome back,</h2>
                          <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-0.5">{userName}</p>
                          <p className="text-sm text-muted-foreground font-medium mt-3 px-2 leading-relaxed">
                            Please enter your security PIN to resume your authorized session.
                          </p>
                      </div>

                      <form onSubmit={handleUnlock} className="space-y-6">
                          {pinError && (
                              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-xl font-bold flex items-center justify-center gap-2 animate-in slide-in-from-top-2 fade-in">
                                  <AlertTriangle size={16} /> {pinError}
                              </div>
                          )}
                          
                          <div className="space-y-2">
                              <input 
                                type="password" 
                                autoFocus 
                                value={pinInput} 
                                onChange={e => setPinInput(e.target.value)} 
                                placeholder="••••" 
                                className="w-full bg-muted/30 border-2 border-border/80 rounded-xl px-4 text-center text-4xl tracking-[0.5em] font-black h-20 focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition-all text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-700" 
                                required 
                              />
                          </div>

                          <button type="submit" className="w-full bg-blue-600 text-white font-bold h-14 rounded-xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-600/25 flex items-center justify-center gap-2 text-base">
                              <Unlock size={18} /> Unlock PASADA
                          </button>
                      </form>

                      <div className="mt-8 text-center border-t border-border/50 pt-6">
                          <button onClick={handleLogout} className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-red-600 font-bold transition-colors">
                              <LogOut size={16} /> Not {userName.split(' ')[0]}? Log out
                          </button>
                      </div>
                  </div>
              </div>
          )}

          {isAuthPage ? (
            children
          ) : (
            <div className="flex h-screen overflow-hidden bg-background">
              <aside className="w-60 min-w-52 border-r bg-card hidden md:flex flex-col">
                <div className="px-4 py-5 flex justify-between items-center border-b border-border">
                  <div className="flex items-center gap-3">
                    <img src="/TFRU.png" alt="TFRU" className="w-9 h-9 rounded-full shadow-sm border border-border" />
                    <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">PASADA</div>
                  </div>
                  <ThemeToggle />
                </div>
                <div className="px-3 py-3 border-b border-border bg-muted/20">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{userName}</p>
                  <p className="text-xs text-muted-foreground font-medium">{userRole}</p>
                </div>
                
                {/* FIXED TOP: pages, search, and the line filter never move. Only the route list below scrolls. */}
                <div className="shrink-0 px-3 pt-3 space-y-1">
                  {/* WHERE AM I: the current page gets a solid blue bar plus a
                      bold blue pill, so it reads at a glance even in a long
                      sidebar or dark mode. */}
                  <Link prefetch={false} href="/dashboard" data-tour="dashboard-nav" aria-current={normPath === '/dashboard' ? 'page' : undefined} className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${normPath === '/dashboard' ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                  </Link>
                  <Link prefetch={false} href="/logs" aria-current={normPath === '/logs' ? 'page' : undefined} className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${normPath === '/logs' ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Activity History
                  </Link>
                  <Link prefetch={false} href="/import" aria-current={normPath === '/import' ? 'page' : undefined} className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${normPath === '/import' ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <UploadCloud className="mr-2 h-4 w-4" /> Import Records
                  </Link>
                  
                  <Link prefetch={false} href="/inactive" aria-current={normPath === '/inactive' ? 'page' : undefined} className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${normPath === '/inactive' ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-500 hover:bg-accent hover:text-slate-900'}`}>
                    <ArchiveX className="mr-2 h-4 w-4" /> Inactive Operators
                  </Link>
                  
                  <Link prefetch={false} href="/settings" data-tour="tour-settings" aria-current={normPath === '/settings' ? 'page' : undefined} className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${normPath === '/settings' ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </Link>

                  {/* ADMIN CONSOLE: only the office Admin sees this entry. A
                      clerk who guesses the URL still gets a refusal screen,
                      and the API enforces the same rule server-side. */}
                  {userRole === "Admin" && (
                    <Link prefetch={false} href="/admin" aria-current={normPath === '/admin' ? 'page' : undefined} className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${normPath === '/admin' ? 'bg-blue-100/70 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-l-4 border-blue-600 shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                      <ShieldCheck className="mr-2 h-4 w-4" /> Admin Console
                    </Link>
                  )}

                  {/* GLOBAL SEARCH */}
                  <form onSubmit={handleGlobalSearch} className="px-1 pb-1" data-tour="global-search">
                    <Input
                      ref={globalSearchRef}
                      type="search"
                      placeholder="Search all records... ( / )"
                      aria-label="Search all records. Press the slash key from any page to jump here."
                      title="Search every record in the municipality. Press / from any page to jump to this box."
                      value={globalSearch}
                      onChange={(e) => setGlobalSearch(e.target.value)}
                      className="h-9 text-xs font-bold bg-muted/30 border border-border shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
                    />
                  </form>
                  
                  {activeRoutes.length > 0 && (
                    <div className="pb-2" data-tour="route-search">
                      <p className="px-3 text-xs font-black text-muted-foreground uppercase tracking-widest">TODA Lines</p>
                      <div className="px-3 pt-1">
                        <Input
                          type="search"
                          placeholder="Filter lines..."
                          aria-label="Filter TODA lines"
                          value={routeSearch}
                          onChange={(e) => setRouteSearch(e.target.value)}
                          className="h-8 pl-8 text-[11px] font-semibold bg-background border border-border shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* THE ONLY SCROLLING PART: the list of routes */}
                {/* overflow-x-hidden: the route list is the only scrolling part
                    of the sidebar, and nothing inside it may ever add a
                    sideways scrollbar to the TODA Lines list. */}
                <nav ref={navRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-4 custom-scrollbar">
                  <div className="space-y-1 mt-1">
                    {pinnedList.length > 0 && (
                        <div className="mb-2">
                            <p className="px-3 text-[10px] font-black text-blue-600/70 uppercase tracking-widest mb-1 mt-2 flex items-center gap-1"><Pin size={10} className="fill-current"/> Pinned Routes</p>
                            {pinnedList.map(route => <RouteItem key={`pinned-${route}`} route={route} isPinned={true} pathname={pathname} togglePin={togglePin} deleteRoute={deleteRoute} showDelete={userRole === "Admin"} />)}
                        </div>
                    )}
                    <div className="mb-2">
                        {pinnedList.length > 0 && unpinnedList.length > 0 && <p className="px-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 mt-2">All Routes</p>}
                        {unpinnedList.map(route => <RouteItem key={`unpinned-${route}`} route={route} isPinned={false} pathname={pathname} togglePin={togglePin} deleteRoute={deleteRoute} showDelete={userRole === "Admin"} />)}
                    </div>
                    {activeRoutes.length > 0 && filteredRoutes.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground font-semibold italic">No routes found.</div>
                    )}
                  </div>
                </nav>
                
                <div className="p-3 border-t border-border space-y-3 bg-muted/10">
                  {/* CONNECTION STATUS: one line, dot + label + ON text, so the
                      state reads at a glance and matches the theme control. */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-muted-foreground">Connection</span>
                    <span
                      data-tour="footer-status"
                      data-tip={isNetworkOnline ? "Sync works normally while online." : "No network. Records stay on this computer and sync later."}
                      data-tip-side="right"
                      className={`flex items-center gap-1.5 text-xs font-black px-2 py-1 rounded-full border ${
                        isNetworkOnline
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                          : "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30"
                      }`}
                    >
                      {isNetworkOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                      {isNetworkOnline ? "Online" : "Offline Mode"}
                    </span>
                  </div>
                  <button 
                    onClick={handleLogout} 
                    className="w-full flex items-center justify-center gap-2 py-3 bg-card border border-border hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 text-muted-foreground rounded-lg text-sm font-black shadow-sm transition-colors"
                  >
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              </aside>
              
              {/* overflow-x-clip: a tooltip bubble that pokes past the right
                  edge must never create a sideways scrollbar on the page.
                  Table scrolling still works: tables scroll inside their own
                  overflow-x-auto wrappers. */}
              <main key={reloadTick} className="flex-1 overflow-y-auto overflow-x-clip bg-background/95">
                {children}
              </main>
            </div>
          )}
          {/* IN-APP RIGHT-CLICK MENU (Tauri only): Back / Forward / safe
              Reload / Copy. Reload here re-renders through the client router,
              so it can never trigger the asset-protocol reload that bricked
              the packaged window. In a normal browser the native menu stays. */}
          {ctxMenu && (
            <div
              className="fixed z-[100000] min-w-[190px] bg-popover text-popover-foreground border border-border rounded-xl shadow-xl py-1.5 animate-in fade-in zoom-in-95 duration-100"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                onClick={() => { setCtxMenu(null); router.back() }}
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" /> Back
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                onClick={() => { setCtxMenu(null); router.forward() }}
              >
                <ArrowRight className="h-4 w-4 text-muted-foreground" /> Forward
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                onClick={() => {
                  setCtxMenu(null)
                  if (normAuthPath === "/" || normAuthPath === "/signup") {
                    router.replace("/")
                  } else {
                    setReloadTick(t => t + 1)
                  }
                }}
              >
                <RotateCw className="h-4 w-4 text-muted-foreground" /> Reload page
              </button>
              {ctxMenu.copy && (
                <button
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                  onClick={() => {
                    setCtxMenu(null)
                    const text = window.getSelection()?.toString() || ""
                    if (text && navigator.clipboard) navigator.clipboard.writeText(text)
                  }}
                >
                  <Copy className="h-4 w-4 text-muted-foreground" /> Copy
                </button>
              )}
              {ctxMenu.paste && (
                <button
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                  onClick={() => {
                    setCtxMenu(null)
                    const target = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
                    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
                      navigator.clipboard.readText().then(text => {
                        if (text) {
                          const start = target.selectionStart ?? target.value.length
                          const end = target.selectionEnd ?? target.value.length
                          const next = target.value.slice(0, start) + text + target.value.slice(end)
                          const setter = Object.getOwnPropertyDescriptor(
                            target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
                            "value"
                          )?.set
                          setter?.call(target, next)
                          target.dispatchEvent(new Event("input", { bubbles: true }))
                          const caret = start + text.length
                          target.setSelectionRange(caret, caret)
                        }
                      }).catch(() => {})
                    }
                  }}
                >
                  <ClipboardPaste className="h-4 w-4 text-muted-foreground" /> Paste
                </button>
              )}
              <button
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                onClick={() => {
                  setCtxMenu(null)
                  document.body.click()
                  try { document.execCommand("selectAll") } catch {}
                }}
              >
                <ListChecks className="h-4 w-4 text-muted-foreground" /> Select all
              </button>
              <div className="my-1 border-t border-border/60" />
              <button
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-semibold hover:bg-accent hover:text-accent-foreground text-left"
                onClick={() => {
                  setCtxMenu(null)
                  window.print()
                }}
              >
                <Printer className="h-4 w-4 text-muted-foreground" /> Print page
              </button>
            </div>
          )}
        </ThemeProvider>
      </body>
    </html>
  )
}