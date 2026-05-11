"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, Users, AlertTriangle, CalendarClock, Globe, BrainCircuit, PieChart as PieChartIcon, BarChart3, Database, ArchiveX } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts'

interface GlobalStats {
  total_system_capacity: number; vacant_slots: number; daily_apps: number; weekly_apps: number; monthly_apps: number;
  yearly_apps: number; flagged_pending: number; revoked: number;
  route_breakdown: { route: string; count: number }[];
  daily_trend: { name: string; val: number }[];
  monthly_trend: { name: string; val: number }[];
}

interface Forecast {
  forecast_period: string; expected_renewals: number; model_confidence: string;
  feature_importances: { factor: string; weight: number }[];
  historical_trend: { month: string; volume: number }[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"
const PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444'];

export default function Dashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [forecastData, setForecastData] = useState<Forecast | null>(null)
  const [activeRoute, setActiveRoute] = useState("ALL")

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`${API_URL}/stats/global`)
        if (response.ok) setStats(await response.json())
      } catch (error) {}
    }
    fetchStats()
  }, [])

  useEffect(() => {
    const fetchForecast = async () => {
      try {
        const response = await fetch(`${API_URL}/predict/${activeRoute}`)
        if (response.ok) {
          const data = await response.json()
          setForecastData(data.length > 0 ? data[0] : null)
        }
      } catch (error) {}
    }
    fetchForecast()
  }, [activeRoute])

  if (!stats) return <div className="p-8 pt-6 animate-pulse text-muted-foreground font-medium text-lg">Establishing Uplink to Command Center...</div>

  const complianceData = [
    { name: 'Active & Compliant', value: stats.yearly_apps },
    { name: 'Pending (1-Yr)', value: stats.flagged_pending },
    { name: 'Revoked/Vacant', value: stats.vacant_slots },
  ];

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 min-h-screen bg-muted/5 transition-all">
      <div>
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">PASADA Administration Dashboard</h2>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">Overview of the LGU Franchise Registry.</p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-slate-700 shadow-sm bg-slate-50/50 dark:bg-slate-900/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-slate-700 dark:text-slate-300">Total Registered Operators</CardTitle>
            <Database className="h-4 w-4 text-slate-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-black text-slate-700 dark:text-slate-300">{stats.total_system_capacity}</div><p className="text-xs text-muted-foreground font-medium mt-1">Total system-wide records</p></CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-green-700 dark:text-green-400">Yearly Compliant</CardTitle>
            <Users className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-black text-green-600">{stats.yearly_apps}</div><p className="text-xs text-muted-foreground font-medium mt-1">Active for current year</p></CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 shadow-sm bg-amber-50/30 dark:bg-amber-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-amber-700 dark:text-amber-400">Flagged (Pending)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-black text-amber-500">{stats.flagged_pending}</div><p className="text-xs text-muted-foreground font-medium mt-1">1-Year Non-Renewal Offense</p></CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500 shadow-sm bg-red-50/30 dark:bg-red-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-red-700 dark:text-red-400">Vacant / Revoked</CardTitle>
            <ArchiveX className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent><div className="text-2xl font-black text-destructive">{stats.vacant_slots}</div><p className="text-xs text-muted-foreground font-medium mt-1">Inactive or 2+ Yrs Non-Renewal</p></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm border-border/40">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex justify-between">Daily Volume <Activity className="h-4 w-4 text-blue-500"/></CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-foreground">{stats.daily_apps}</div>
              <div className="h-10 w-24"><ResponsiveContainer width="100%" height="100%"><LineChart data={stats.daily_trend}><Line type="monotone" dataKey="val" stroke="#3b82f6" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/40">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex justify-between">Weekly Volume <Activity className="h-4 w-4 text-blue-500"/></CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-foreground">{stats.weekly_apps}</div></CardContent>
        </Card>
        <Card className="shadow-sm border-border/40">
          <CardHeader className="pb-2"><CardTitle className="text-xs font-bold text-muted-foreground uppercase flex justify-between">Monthly Volume <CalendarClock className="h-4 w-4 text-blue-500"/></CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-foreground">{stats.monthly_apps}</div>
              <div className="h-10 w-24"><ResponsiveContainer width="100%" height="100%"><BarChart data={stats.monthly_trend}><Bar dataKey="val" fill="#3b82f6" radius={[2, 2, 0, 0]}/></BarChart></ResponsiveContainer></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-md border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><PieChartIcon className="h-5 w-5 text-primary"/> Franchise Compliance Status</CardTitle>
            <CardDescription>Current proportion of active, pending, and revoked/vacant operators.</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={complianceData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {complianceData.map((entry, index) => <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                </Pie>
                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-md border-border/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary"/> Route Distribution</CardTitle>
            <CardDescription>Total active registered operators per TODA line.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.route_breakdown} margin={{ top: 10, right: 10, left: -20, bottom: 90 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="route" tick={{fontSize: 10}} tickLine={false} axisLine={false} interval={0} angle={-45} textAnchor="end" height={80} />
                <YAxis tick={{fontSize: 11}} tickLine={false} axisLine={false} />
                <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px' }} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 shadow-xl border-border/50 bg-card/95">
        <CardHeader className="bg-card pb-4 border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-xl"><Globe className="h-5 w-5 text-primary" /> Algorithmic Predictive Volume</CardTitle>
          <div className="flex gap-2 mt-4 flex-wrap">
            <button onClick={() => setActiveRoute("ALL")} className={`px-4 py-1.5 text-xs font-bold rounded-full border transition-all duration-300 ${activeRoute === "ALL" ? 'bg-primary text-primary-foreground scale-105 shadow-md' : 'bg-muted/50 hover:bg-accent'}`}>GLOBAL SYSTEM</button>
            {stats.route_breakdown.map((r) => (
              <button key={r.route} onClick={() => setActiveRoute(r.route)} className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all duration-300 ${activeRoute === r.route ? 'bg-primary text-primary-foreground scale-105 shadow-md' : 'bg-muted/50 hover:bg-accent'}`}>{r.route}</button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {forecastData ? (
            <div className="space-y-8">
              <div className="grid md:grid-cols-3 gap-8">
                <div className="col-span-1 flex flex-col justify-center items-center text-center p-6 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl border border-blue-100 dark:border-blue-900 shadow-inner">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">Target Forecast: {forecastData.forecast_period}</p>
                  <h3 className="text-7xl font-black text-blue-600 dark:text-blue-400 tracking-tighter">{forecastData.expected_renewals}</h3>
                  <p className="text-sm font-semibold mt-1">Expected Renewals</p>
                  <Badge variant="outline" className="mt-4 bg-background font-mono shadow-sm">Accuracy: {forecastData.model_confidence}</Badge>
                </div>
                
                <div className="col-span-2 flex flex-col">
                  <h4 className="text-sm font-bold text-muted-foreground uppercase mb-4 flex items-center gap-2"><BrainCircuit className="h-4 w-4"/> AI Feature Importance Weights</h4>
                  <div className="flex-1 w-full min-h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={forecastData.feature_importances} layout="vertical" margin={{ top: 0, right: 30, left: 40, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.2} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="factor" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'currentColor' }} width={140} />
                        <RechartsTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Bar dataKey="weight" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-border/50">
                <h4 className="text-sm font-bold text-muted-foreground uppercase mb-6 text-center">Historical Time-Series Trend Analysis</h4>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecastData.historical_trend} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                      <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontWeight: 'bold' }} />
                      <Line type="monotone" dataKey="volume" stroke="#10b981" strokeWidth={4} dot={{ r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
             <div className="h-32 flex items-center justify-center text-muted-foreground text-sm border-2 border-dashed rounded-xl bg-muted/20">Insufficient data to train model.</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}