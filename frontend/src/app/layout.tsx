"use client"

import { Inter } from "next/font/google"
import "./globals.css"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState, useCallback } from "react"
import { Moon, Sun, UploadCloud, ArchiveX, Settings, Search, LogOut } from "lucide-react"
import { Input } from "@/components/ui/input"

const inter = Inter({ subsets: ["latin"] })

// FIXED: Using localhost bypasses Windows 10/11 WebView2 Loopback Restriction
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-2 rounded-md hover:bg-accent transition-colors">
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-slate-700" />
      <Moon className="absolute top-4 h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-slate-200" />
    </button>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [activeRoutes, setActiveRoutes] = useState<string[]>([])
  const [routeSearch, setRouteSearch] = useState("")
  
  const [userName, setUserName] = useState("System User")
  const [userRole, setUserRole] = useState("Clerk")

  const fetchRoutes = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/stats/global`)
      if (res.ok) {
        const data = await res.json()
        const routes = data.route_breakdown.map((r: any) => r.route)
        setActiveRoutes(routes)
      }
    } catch (e) { console.error("Sidebar route fetch failed") }
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
    
    const storedName = localStorage.getItem("pasada_full_name") || localStorage.getItem("full_name")
    const storedRole = localStorage.getItem("pasada_role")
    
    if (storedName) setUserName(storedName)
    if (storedRole) setUserRole(storedRole)
    
    if (pathname !== "/" && pathname !== "/signup") {
      fetchRoutes()
    }

    window.addEventListener('toda_imported', fetchRoutes)
    return () => window.removeEventListener('toda_imported', fetchRoutes)
  }, [pathname, fetchRoutes])

  const handleLogout = () => {
    localStorage.removeItem("pasada_token")
    localStorage.removeItem("pasada_full_name")
    localStorage.removeItem("full_name")
    localStorage.removeItem("token")
    localStorage.removeItem("pasada_role")
    router.push("/")
  }

  const isAuthPage = pathname === "/" || pathname === "/signup"

  if (!mounted) return null

  if (isAuthPage) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
            {children}
          </ThemeProvider>
        </body>
      </html>
    )
  }

  const filteredRoutes = activeRoutes.filter(r => r.toLowerCase().includes(routeSearch.toLowerCase()))

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <div className="flex h-screen overflow-hidden bg-background">
            <aside className="w-64 border-r bg-card hidden md:flex flex-col">
              <div className="px-4 py-6 flex justify-between items-center border-b border-border">
                {/* TFRU LOGO INTEGRATION */}
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
              <nav className="flex-1 space-y-1 p-4 overflow-y-auto custom-scrollbar">
                <Link href="/dashboard" className="flex items-center rounded-md px-3 py-2 text-sm font-bold hover:bg-accent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">Dashboard</Link>
                <Link href="/logs" className="flex items-center rounded-md px-3 py-2 text-sm font-bold hover:bg-accent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">Audit Logs</Link>
                <Link href="/import" className="flex items-center rounded-md px-3 py-2 text-sm font-bold hover:bg-accent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  <UploadCloud className="mr-2 h-4 w-4" /> Data Migration
                </Link>
                <Link href="/inactive" className="flex items-center rounded-md px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-500/10 transition-colors mt-2">
                  <ArchiveX className="mr-2 h-4 w-4" /> Inactive Lines
                </Link>
                <Link href="/settings" className="flex items-center rounded-md px-3 py-2 text-sm font-bold hover:bg-accent text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors mt-2">
                  <Settings className="mr-2 h-4 w-4" /> Configuration
                </Link>
                
                {activeRoutes.length > 0 && (
                  <div className="pt-6 pb-2 space-y-3">
                    <p className="px-3 text-xs font-black text-muted-foreground uppercase tracking-widest">Active TODA Lines</p>
                    <div className="px-3 relative">
                      <Search className="absolute left-5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input 
                        placeholder="Filter lines..." 
                        value={routeSearch}
                        onChange={(e) => setRouteSearch(e.target.value)}
                        className="h-8 pl-8 text-xs font-semibold bg-muted/50 focus-visible:ring-1 border-border/60" 
                      />
                    </div>
                  </div>
                )}
                
                <div className="space-y-1 mt-1">
                  {filteredRoutes.map((route) => (
                    <Link key={route} href={`/toda/${route}`} className="flex items-center rounded-md px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-accent transition-colors">
                      {route}
                    </Link>
                  ))}
                  {activeRoutes.length > 0 && filteredRoutes.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground font-semibold italic">No lines match your search.</div>
                  )}
                </div>
              </nav>
              <div className="p-4 border-t border-border space-y-4 bg-muted/10">
                <p className="text-xs font-bold text-muted-foreground">Status: <span className="text-emerald-500">Online</span></p>
                <button 
                  onClick={handleLogout} 
                  className="w-full flex items-center justify-center gap-2 py-3 bg-card border border-border hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 text-muted-foreground rounded-lg text-sm font-black shadow-sm transition-all"
                >
                  <LogOut size={16} /> Secure Logout
                </button>
              </div>
            </aside>
            <main className="flex-1 overflow-y-auto bg-background/95">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}