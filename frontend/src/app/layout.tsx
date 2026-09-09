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
  Search, 
  LogOut, 
  LayoutDashboard, 
  ClipboardList, 
  Map, 
  Pin, 
  Trash2, 
  Lock, 
  Unlock, 
  AlertTriangle, 
  ShieldCheck 
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { API_URL, fetchWithAuth, clearAuthAndRedirect } from "@/lib/api"

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-8 h-8" />
  return (
    <button 
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")} 
      className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-accent transition-colors"
    >
      <Sun className="absolute h-4 w-4 transition-all duration-300 rotate-0 scale-100 dark:-rotate-90 dark:scale-0 text-slate-700" />
      <Moon className="absolute h-4 w-4 transition-all duration-300 rotate-90 scale-0 dark:rotate-0 dark:scale-100 text-slate-200" />
    </button>
  )
}

// HOISTED ROUTE ITEM: Prevents React from trashing the component instance and resetting scroll
const RouteItem = ({ route, isPinned, pathname, togglePin, deleteRoute }: { route: string, isPinned: boolean, pathname: string, togglePin: (e: React.MouseEvent, r: string) => void, deleteRoute: (e: React.MouseEvent, r: string) => void }) => (
  <div className="relative group flex items-center">
      <Link 
        href={`/toda/${route}`} 
        prefetch={false} 
        className={`flex-1 flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${pathname === `/toda/${route}` ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}
      >
          <Map className="mr-2 h-4 w-4 opacity-50" /> {route}
      </Link>
      <div className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-background/80 px-1 rounded">
          <button onClick={(e) => togglePin(e, route)} className="p-1 hover:text-blue-600 transition-colors" title={isPinned ? "Unpin Route" : "Pin Route"}>
              <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current text-blue-600' : 'text-slate-400'}`} />
          </button>
          <button onClick={(e) => deleteRoute(e, route)} className="p-1 hover:text-red-600 transition-colors" title="Delete Entire Route">
              <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
          </button>
      </div>
  </div>
);

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
  const navRef = useRef<HTMLElement>(null)
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const isScrollingRef = useRef(false) // Guard against restoring while actively scrolling

  // PIN Lock State
  const [isLocked, setIsLocked] = useState(false)
  const [pinInput, setPinInput] = useState("")
  const [pinError, setPinError] = useState("")

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
    
    if (pathname !== "/" && pathname !== "/signup") {
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
            if (res.ok) {
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
                const err = await res.json();
                alert(err.detail || `Failed to delete route ${route}.`);
            }
        } catch (error) {
            alert("Network error while deleting route.");
        }
    }
  };

  const isAuthPage = pathname === "/" || pathname === "/signup"

  const filteredRoutes = activeRoutes.filter(r => r.toLowerCase().includes(routeSearch.toLowerCase()))
  const pinnedList = filteredRoutes.filter(r => pinnedRoutes.includes(r));
  const unpinnedList = filteredRoutes.filter(r => !pinnedRoutes.includes(r));

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700;900&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: `
          body { font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }
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
              <aside className="w-64 border-r bg-card hidden md:flex flex-col">
                <div className="px-4 py-6 flex justify-between items-center border-b border-border">
                  <div className="flex items-center gap-3">
                    <img src="/TFRU.png" alt="TFRU" className="w-9 h-9 rounded-full shadow-sm border border-border" />
                    <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">PASADA</div>
                  </div>
                  <ThemeToggle />
                </div>
                <div className="px-4 py-4 border-b border-border bg-muted/20">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{userName}</p>
                  <p className="text-xs text-muted-foreground font-medium">{userRole}</p>
                </div>
                
                <nav ref={navRef} onScroll={handleScroll} className="flex-1 space-y-1 p-4 overflow-y-auto custom-scrollbar">
                  <Link prefetch={false} href="/dashboard" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${pathname === '/dashboard' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                  </Link>
                  <Link prefetch={false} href="/logs" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${pathname === '/logs' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Activity History
                  </Link>
                  <Link prefetch={false} href="/import" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors ${pathname === '/import' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <UploadCloud className="mr-2 h-4 w-4" /> Import Records
                  </Link>
                  
                  <Link prefetch={false} href="/inactive" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors mt-2 ${pathname === '/inactive' ? 'bg-muted/70 text-slate-800 dark:text-slate-200 border-l-4 border-slate-500 shadow-sm' : 'text-slate-500 hover:bg-accent hover:text-slate-900'}`}>
                    <ArchiveX className="mr-2 h-4 w-4" /> Inactive Operators
                  </Link>
                  
                  <Link prefetch={false} href="/settings" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-colors mt-2 mb-4 ${pathname === '/settings' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <Settings className="mr-2 h-4 w-4" /> Settings
                  </Link>

                  {/* GLOBAL SEARCH */}
                  <form onSubmit={handleGlobalSearch} className="px-1 mb-6 relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Search all records..." 
                      value={globalSearch}
                      onChange={(e) => setGlobalSearch(e.target.value)}
                      className="h-10 pl-9 text-xs font-bold bg-muted/30 border border-border shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg" 
                    />
                  </form>
                  
                  {activeRoutes.length > 0 && (
                    <div className="pt-2 pb-2 space-y-3">
                      <p className="px-3 text-xs font-black text-muted-foreground uppercase tracking-widest">TODA Lines</p>
                      <div className="px-3 relative">
                        <Search className="absolute left-5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input 
                          placeholder="Filter lines..." 
                          value={routeSearch}
                          onChange={(e) => setRouteSearch(e.target.value)}
                          className="h-8 pl-8 text-[11px] font-semibold bg-background border border-border shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500" 
                        />
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-1 mt-1">
                    {pinnedList.length > 0 && (
                        <div className="mb-2">
                            <p className="px-3 text-[10px] font-black text-blue-600/70 uppercase tracking-widest mb-1 mt-2 flex items-center gap-1"><Pin size={10} className="fill-current"/> Pinned Routes</p>
                            {pinnedList.map(route => <RouteItem key={`pinned-${route}`} route={route} isPinned={true} pathname={pathname} togglePin={togglePin} deleteRoute={deleteRoute} />)}
                        </div>
                    )}
                    <div className="mb-2">
                        {pinnedList.length > 0 && unpinnedList.length > 0 && <p className="px-3 text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 mt-2">All Routes</p>}
                        {unpinnedList.map(route => <RouteItem key={`unpinned-${route}`} route={route} isPinned={false} pathname={pathname} togglePin={togglePin} deleteRoute={deleteRoute} />)}
                    </div>
                    {activeRoutes.length > 0 && filteredRoutes.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground font-semibold italic">No routes found.</div>
                    )}
                  </div>
                </nav>
                
                <div className="p-4 border-t border-border space-y-4 bg-muted/10">
                  <p className="text-xs font-bold text-muted-foreground">
                    Status: <span className={isNetworkOnline ? "text-emerald-500" : "text-red-500"}>{isNetworkOnline ? "Online" : "Offline Mode"}</span>
                  </p>
                  <button 
                    onClick={handleLogout} 
                    className="w-full flex items-center justify-center gap-2 py-3 bg-card border border-border hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 text-muted-foreground rounded-lg text-sm font-black shadow-sm transition-colors"
                  >
                    <LogOut size={16} /> Log out
                  </button>
                </div>
              </aside>
              
              <main className="flex-1 overflow-y-auto bg-background/95">
                {children}
              </main>
            </div>
          )}
        </ThemeProvider>
      </body>
    </html>
  )
}