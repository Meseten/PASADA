"use client"

import { Inter } from "next/font/google"
import "./globals.css"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState, useCallback } from "react"
import { Moon, Sun, UploadCloud, ArchiveX, Settings, Search } from "lucide-react"
import { Input } from "@/components/ui/input"

const inter = Inter({ subsets: ["latin"] })

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="p-2 rounded-md hover:bg-accent transition-colors">
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute top-4 h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [activeRoutes, setActiveRoutes] = useState<string[]>([])
  const [routeSearch, setRouteSearch] = useState("")

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
    
    if (pathname !== "/" && pathname !== "/signup") {
      fetchRoutes()
    }

    // Listen for the custom event from the Bulk Importer to refresh the sidebar instantly
    window.addEventListener('toda_imported', fetchRoutes)
    return () => window.removeEventListener('toda_imported', fetchRoutes)
  }, [pathname, fetchRoutes])

  const handleLogout = () => {
    localStorage.removeItem("pasada_token")
    localStorage.removeItem("pasada_user")
    router.push("/")
  }

  const isAuthPage = pathname === "/" || pathname === "/signup"

  if (!mounted) return null

  if (isAuthPage) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
          </ThemeProvider>
        </body>
      </html>
    )
  }

  const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem("pasada_user") || "{}") : {}
  const filteredRoutes = activeRoutes.filter(r => r.toLowerCase().includes(routeSearch.toLowerCase()))

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="flex h-screen overflow-hidden bg-background">
            <aside className="w-64 border-r bg-card hidden md:flex flex-col">
              <div className="px-4 py-6 flex justify-between items-center border-b">
                <div className="text-2xl font-bold tracking-tight">PASADA</div>
                <ThemeToggle />
              </div>
              <div className="px-4 py-4 border-b bg-muted/20">
                <p className="text-sm font-semibold">{user.full_name || "System User"}</p>
                <p className="text-xs text-muted-foreground">{user.role || "Clerk"}</p>
              </div>
              <nav className="flex-1 space-y-1 p-4 overflow-y-auto custom-scrollbar">
                <Link href="/dashboard" className="flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">Dashboard</Link>
                <Link href="/logs" className="flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">Audit Logs</Link>
                <Link href="/import" className="flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
                  <UploadCloud className="mr-2 h-4 w-4" /> Bulk Import
                </Link>
                <Link href="/inactive" className="flex items-center rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors mt-2">
                  <ArchiveX className="mr-2 h-4 w-4" /> Inactive Lines
                </Link>
                <Link href="/settings" className="flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors mt-2">
                  <Settings className="mr-2 h-4 w-4" /> Configuration
                </Link>
                
                {activeRoutes.length > 0 && (
                  <div className="pt-6 pb-2 space-y-3">
                    <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active TODA Lines</p>
                    <div className="px-3 relative">
                      <Search className="absolute left-5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input 
                        placeholder="Filter lines..." 
                        value={routeSearch}
                        onChange={(e) => setRouteSearch(e.target.value)}
                        className="h-8 pl-8 text-xs bg-muted/50 focus-visible:ring-1" 
                      />
                    </div>
                  </div>
                )}
                
                <div className="space-y-1 mt-1">
                  {filteredRoutes.map((route) => (
                    <Link key={route} href={`/toda/${route}`} className="flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors">
                      {route}
                    </Link>
                  ))}
                  {activeRoutes.length > 0 && filteredRoutes.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground italic">No lines match your search.</div>
                  )}
                </div>
              </nav>
              <div className="p-4 border-t space-y-4 bg-muted/10">
                <p className="text-xs text-muted-foreground">Status: <span className="text-green-500 font-semibold">Online</span></p>
                <button onClick={handleLogout} className="w-full text-left text-sm text-destructive font-medium hover:text-red-600 transition-colors">Secure Logout</button>
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