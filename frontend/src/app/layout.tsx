"use client"
import "./globals.css"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState, useCallback, useRef } from "react"
import { Moon, Sun, UploadCloud, ArchiveX, Settings, Search, LogOut, LayoutDashboard, ClipboardList, Map, Pin, Trash2 } from "lucide-react"
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
        prefetch={false} // FIX: Disables aggressive background fetching on scroll
        className={`flex-1 flex items-center rounded-md px-3 py-2 text-sm font-bold transition-all ${pathname === `/toda/${route}` ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}
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

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/stats/global`)
      if (res.ok) {
        const data = await res.json()
        const routes = data.route_breakdown.map((r: any) => r.route)
        setActiveRoutes(routes)
      }
    } catch (e) {
      console.error("Sidebar route fetch failed")
    }
  }, [])

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
    if (navRef.current) {
      const savedScroll = sessionStorage.getItem('sidebarScroll');
      if (savedScroll) navRef.current.scrollTop = parseInt(savedScroll, 10);
    }
  }, [pathname, activeRoutes]);

  const handleScroll = () => {
    // Debounce the storage set to prevent synchronous disk I/O lag while scrolling
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      if (navRef.current) sessionStorage.setItem('sidebarScroll', navRef.current.scrollTop.toString());
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
                  <Link prefetch={false} href="/dashboard" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-all ${pathname === '/dashboard' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                  </Link>
                  <Link prefetch={false} href="/logs" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-all ${pathname === '/logs' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <ClipboardList className="mr-2 h-4 w-4" /> Activity History
                  </Link>
                  <Link prefetch={false} href="/import" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-all ${pathname === '/import' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
                    <UploadCloud className="mr-2 h-4 w-4" /> Import Records
                  </Link>
                  
                  <Link prefetch={false} href="/inactive" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-all mt-2 ${pathname === '/inactive' ? 'bg-muted/70 text-slate-800 dark:text-slate-200 border-l-4 border-slate-500 shadow-sm' : 'text-slate-500 hover:bg-accent hover:text-slate-900'}`}>
                    <ArchiveX className="mr-2 h-4 w-4" /> Inactive Operators
                  </Link>
                  
                  <Link prefetch={false} href="/settings" className={`flex items-center rounded-md px-3 py-2 text-sm font-bold transition-all mt-2 mb-4 ${pathname === '/settings' ? 'bg-blue-50/50 text-blue-600 border-l-4 border-blue-600' : 'text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-slate-900 dark:hover:text-white'}`}>
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
                    className="w-full flex items-center justify-center gap-2 py-3 bg-card border border-border hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 text-muted-foreground rounded-lg text-sm font-black shadow-sm transition-all"
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