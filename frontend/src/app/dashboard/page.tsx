"use client";

import { useEffect, useState } from "react";
import { Database, Users, AlertTriangle, ArchiveX, Activity, Calendar, Globe } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const COLORS = ['#10b981', '#f59e0b', '#ef4444']; 

interface GlobalStats {
  total_system_capacity: number;
  vacant_slots: number;
  daily_apps: number;
  weekly_apps: number;
  monthly_apps: number;
  yearly_apps: number;
  flagged_pending: number;
  route_breakdown: { route: string; count: number }[];
  daily_trend: { name: string; val: number }[];
  weekly_trend: { name: string; val: number }[];
  monthly_trend: { name: string; val: number }[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [activePrediction, setActivePrediction] = useState("GLOBAL SYSTEM");
  const [predictionData, setPredictionData] = useState<any>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/stats/global`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (e) {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchML = async () => {
      try {
        const route = activePrediction === "GLOBAL SYSTEM" ? "ALL" : activePrediction;
        const res = await fetch(`${API_URL}/predict/${route}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            setPredictionData(data[0]); 
          } else {
            setPredictionData(null);
          }
        }
      } catch (e) {
        setPredictionData(null);
      }
    };
    fetchML();
  }, [activePrediction]);

  if (!stats) return <div className="p-8 text-muted-foreground animate-pulse font-medium text-lg">Synchronizing Telemetry...</div>;

  const compliantCount = stats.total_system_capacity - stats.vacant_slots - stats.flagged_pending;
  const pieData = [
    { name: 'Active & Compliant', value: Math.max(0, compliantCount) },
    { name: 'Pending (1-Yr)', value: stats.flagged_pending },
    { name: 'Revoked/Vacant', value: stats.vacant_slots },
  ];

  const activeRoutes = ["GLOBAL SYSTEM", ...stats.route_breakdown.map(r => r.route)];

  return (
    <div className="space-y-4 p-4 md:p-6 animate-in fade-in duration-500 bg-background min-h-screen">
      <header className="mb-4">
        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">PASADA Administration Dashboard</h1>
        <p className="text-muted-foreground mt-0.5 text-sm font-medium">Overview of the LGU Franchise Registry.</p>
      </header>

      {/* COMPACT TOP ROW: KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-card border-l-4 border-l-slate-700 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-muted-foreground">Total Registered Operators</p>
            <Database className="text-slate-400" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">{stats.total_system_capacity}</h3>
            <p className="text-[10px] font-semibold text-muted-foreground mt-0.5">Total system-wide records</p>
          </div>
        </div>

        <div className="bg-card border-l-4 border-l-emerald-500 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-emerald-600">Yearly Compliant</p>
            <Users className="text-emerald-500/50" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-emerald-600">{Math.max(0, compliantCount)}</h3>
            <p className="text-[10px] font-semibold text-emerald-600/70 mt-0.5">Active for current year</p>
          </div>
        </div>

        <div className="bg-card border-l-4 border-l-amber-500 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-amber-600">Flagged (Pending)</p>
            <AlertTriangle className="text-amber-500/50" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-amber-600">{stats.flagged_pending}</h3>
            <p className="text-[10px] font-semibold text-amber-600/70 mt-0.5">1-Year Non-Renewal Offense</p>
          </div>
        </div>

        <div className="bg-card border-l-4 border-l-red-500 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-red-600">Vacant / Revoked</p>
            <ArchiveX className="text-red-500/50" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-red-600">{stats.vacant_slots}</h3>
            <p className="text-[10px] font-semibold text-red-600/70 mt-0.5">Inactive or 2+ Yrs Non-Renewal</p>
          </div>
        </div>
      </div>

      {/* COMPACT SECOND ROW: VOLUME CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Aggregate Daily</p>
            <Activity className="text-blue-500" size={14} />
          </div>
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-black">{stats.daily_apps}</h3>
            <div className="w-24 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.daily_trend}>
                  <XAxis dataKey="name" hide />
                  <Tooltip labelFormatter={(label) => `${label}`} formatter={(value: any) => [value, ""]} separator="" contentStyle={{ fontSize: '10px', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold' }} cursor={{ stroke: 'rgba(59, 130, 246, 0.2)' }} />
                  <Line type="monotone" dataKey="val" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2, fill: "#3b82f6" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Weekly Volume</p>
            <Activity className="text-blue-500" size={14} />
          </div>
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-black">{stats.weekly_apps}</h3>
            <div className="w-24 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.weekly_trend}>
                  <XAxis dataKey="name" hide />
                  <Tooltip labelFormatter={(label) => `Week of ${label}`} formatter={(value: any) => [value, ""]} separator="" contentStyle={{ fontSize: '10px', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold' }} cursor={{ stroke: 'rgba(59, 130, 246, 0.2)' }} />
                  <Line type="monotone" dataKey="val" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2, fill: "#3b82f6" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Monthly Volume</p>
            <Calendar className="text-blue-500" size={14} />
          </div>
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-black">{stats.monthly_apps}</h3>
            <div className="w-24 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.monthly_trend}>
                  <XAxis dataKey="name" hide />
                  <Tooltip labelFormatter={(label) => `${label}`} formatter={(value: any) => [value, ""]} separator="" contentStyle={{ fontSize: '10px', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold' }} cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="val" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* COMPACT THIRD ROW: DONUT & ROUTE BAR CHART */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
        <div className="lg:col-span-2 bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col">
          <div className="flex flex-col mb-1">
            <h3 className="text-sm font-bold text-foreground">Franchise Compliance Status</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Proportion of active, pending, and revoked operators.</p>
          </div>
          <div className="flex-1 min-h-[140px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => [value, ""]} separator="" contentStyle={{ fontSize: '11px', borderRadius: '6px', padding: '4px', fontWeight: 'bold', border: '1px solid hsl(var(--border))' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-3 text-[9px] font-bold">
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-500 rounded-sm"></div> Active</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-amber-500 rounded-sm"></div> Pending</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500 rounded-sm"></div> Revoked</div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col">
          <div className="flex flex-col mb-1">
            <h3 className="text-sm font-bold text-foreground">Route Distribution</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total active registered operators per TODA line.</p>
          </div>
          <div className="flex-1 min-h-[140px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.route_breakdown}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="route" angle={-90} textAnchor="end" height={50} fontSize={8} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                <YAxis fontSize={9} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                <Tooltip 
                  cursor={{ fill: 'transparent' }} 
                  contentStyle={{ fontSize: '11px', borderRadius: '6px', padding: '4px 8px', fontWeight: 'bold', border: '1px solid hsl(var(--border))' }}
                  formatter={(value: any) => [value, "Ops"]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* COMPACT FOURTH ROW: ML ENGINE */}
      <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3"><Globe className="w-4 h-4 text-slate-700 dark:text-slate-300" /> Algorithmic Predictive Volume</h3>
        
        <div className="flex flex-wrap gap-1.5 mb-4">
          {activeRoutes.map((toda) => (
            <button
              key={toda}
              onClick={() => setActivePrediction(toda)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all border shadow-sm ${
                activePrediction === toda 
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900" 
                  : "bg-background text-muted-foreground hover:bg-muted border-border"
              }`}
            >
              {toda}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="col-span-1 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-500/20 rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-inner h-[160px]">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
              TARGET FORECAST: {predictionData ? predictionData.forecast_period : "NEXT 30 DAYS"}
            </p>
            <h2 className="text-5xl font-black text-blue-600 mb-1">
              {predictionData ? predictionData.expected_renewals : "0"}
            </h2>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Expected Renewals</p>
            <div className="bg-background border border-border px-3 py-1 rounded-md text-[10px] font-bold text-muted-foreground shadow-sm">
              Accuracy: {predictionData ? predictionData.model_confidence : "± 0 Renewals"}
            </div>
          </div>

          <div className="col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-6 h-[160px]">
              <div>
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Activity size={12} /> AI Feature Weights
                </h4>
                <div className="space-y-2 relative group">
                  {predictionData ? predictionData.feature_importances.map((feat: any) => (
                    <div key={feat.factor} className="flex items-center gap-3 relative">
                      <span className="w-1/2 text-[9px] font-bold text-right text-muted-foreground truncate">{feat.factor}</span>
                      <div className="w-1/2 bg-muted rounded-full h-2.5 overflow-hidden relative cursor-crosshair">
                        <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-1000" style={{ width: `${feat.weight}%` }}></div>
                        <div className="absolute inset-0 flex items-center justify-end pr-1.5 opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-[8px] font-black text-white bg-black/50 px-1 rounded-sm">{feat.weight}%</span>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="text-xs font-medium text-muted-foreground italic text-center py-4 bg-muted/30 rounded-lg border border-border">
                      Insufficient historical data.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Time-Series Trend Analysis</h4>
                <div className="h-[120px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={predictionData ? predictionData.historical_trend : []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                      <Tooltip 
                        labelFormatter={(label) => `${label}`}
                        contentStyle={{ fontSize: '10px', backgroundColor: 'hsl(var(--card))', borderRadius: '6px', padding: '4px', fontWeight: 'bold', border: '1px solid hsl(var(--border))' }}
                        itemStyle={{ color: '#10b981' }}
                      />
                      <Line type="monotone" dataKey="volume" stroke="#10b981" strokeWidth={2} dot={{ r: 2, fill: "#10b981" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}