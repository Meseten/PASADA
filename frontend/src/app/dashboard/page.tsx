"use client";

import { useEffect, useState } from "react";
import { Database, Users, AlertTriangle, ArchiveX, Activity, Calendar, Globe, MapPin, Settings2, Loader2 } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:43888";
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
  const [activePrediction, setActivePrediction] = useState("");
  const [predictionData, setPredictionData] = useState<any>(null);
  const [population, setPopulation] = useState("");
  const [roadLength, setRoadLength] = useState("");
  const [isUpdatingRoute, setIsUpdatingRoute] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/stats/global`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
          setActivePrediction((prev) => {
            if (prev === "" && data.route_breakdown.length > 0) {
              return data.route_breakdown[0].route;
            }
            return prev;
          });
        }
      } catch (e) {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchML = async () => {
    if (!activePrediction) return;
    try {
      const res = await fetch(`${API_URL}/predict/${activePrediction}`);
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

  useEffect(() => {
    fetchML();
    setPopulation("");
    setRoadLength("");
  }, [activePrediction]);

  const handleUpdateRouteData = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!population || !roadLength) return;
    setIsUpdatingRoute(true);
    const token = localStorage.getItem("token") || "";
    try {
      const res = await fetch(`${API_URL}/route_data/${activePrediction}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          population: parseInt(population),
          road_length_km: parseFloat(roadLength)
        })
      });
      if (res.ok) {
        await fetchML();
        setPopulation("");
        setRoadLength("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingRoute(false);
    }
  };

  if (!stats) {
    return (
      <div className="p-8 text-muted-foreground font-medium text-lg flex items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" /> Loading Dashboard Data...
      </div>
    );
  }

  const compliantCount = stats.total_system_capacity - stats.vacant_slots - stats.flagged_pending;
  const pieData = [
    { name: 'Active Operators', value: Math.max(0, compliantCount) },
    { name: '1-Year Non-Renewal', value: stats.flagged_pending },
    { name: '2+ Years Non-Renewal / Vacant', value: stats.vacant_slots },
  ];
  const activeRoutes = stats.route_breakdown.map(r => r.route);
  const statusText = predictionData?.forecast_period || "";
  let clusterColor = "bg-blue-50/50 border-blue-500/20 text-blue-600 dark:bg-blue-950/20";
  let textColor = "text-blue-600";
  if (statusText.includes("GREEN CLUSTER")) {
    clusterColor = "bg-emerald-50/50 border-emerald-500/30 text-emerald-700 dark:bg-emerald-950/20";
    textColor = "text-emerald-600";
  } else if (statusText.includes("YELLOW CLUSTER")) {
    clusterColor = "bg-amber-50/50 border-amber-500/30 text-amber-700 dark:bg-amber-950/20";
    textColor = "text-amber-600";
  } else if (statusText.includes("RED CLUSTER")) {
    clusterColor = "bg-red-50/50 border-red-500/30 text-red-700 dark:bg-red-950/20";
    textColor = "text-red-600";
  }

  return (
    <div className="space-y-4 p-4 md:p-6 animate-in fade-in duration-500 bg-background min-h-screen">
      <header className="mb-4">
        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">
          Franchise Registry Dashboard
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm font-medium">
          Overview of municipal tricycle operators and route counts.
        </p>
      </header>

      {/* KPI SUMMARY CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-card border-l-4 border-l-slate-700 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-muted-foreground">Total Registered Operators</p>
            <Database className="text-slate-400" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">
              {stats.total_system_capacity}
            </h3>
            <p className="text-[10px] font-semibold text-muted-foreground mt-0.5">
              Total operators across all 19 routes
            </p>
          </div>
        </div>

        <div className="bg-card border-l-4 border-l-emerald-500 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-emerald-600">Active Operators</p>
            <Users className="text-emerald-500/50" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-emerald-600">
              {Math.max(0, compliantCount)}
            </h3>
            <p className="text-[10px] font-semibold text-emerald-600/70 mt-0.5">
              Current year active renewals
            </p>
          </div>
        </div>

        <div className="bg-card border-l-4 border-l-amber-500 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-amber-600">1-Year Non-Renewal</p>
            <AlertTriangle className="text-amber-500/50" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-amber-600">
              {stats.flagged_pending}
            </h3>
            <p className="text-[10px] font-semibold text-amber-600/70 mt-0.5">
              Pending renewal from last year
            </p>
          </div>
        </div>

        <div className="bg-card border-l-4 border-l-red-500 border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs font-bold text-red-600">2+ Years Non-Renewal / Vacant</p>
            <ArchiveX className="text-red-500/50" size={16} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-red-600">
              {stats.vacant_slots}
            </h3>
            <p className="text-[10px] font-semibold text-red-600/70 mt-0.5">
              Revoked or unassigned slots
            </p>
          </div>
        </div>
      </div>

      {/* TIME-SERIES VOLUME CHARTS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Daily Volume</p>
            <Activity className="text-blue-500" size={14} />
          </div>
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-black">{stats.daily_apps}</h3>
            <div className="w-24 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.daily_trend}>
                  <XAxis dataKey="name" hide />
                  <Tooltip
                    labelFormatter={(label) => `${label}`}
                    formatter={(value: any) => [value, ""]}
                    separator=""
                    contentStyle={{ fontSize: '10px', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold', backgroundColor: '#1e293b', color: '#f8fafc', border: 'none' }}
                    itemStyle={{ color: '#60a5fa' }}
                    cursor={{ stroke: 'rgba(59, 130, 246, 0.2)' }}
                  />
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
                  <Tooltip
                    labelFormatter={(label) => `Week of ${label}`}
                    formatter={(value: any) => [value, ""]}
                    separator=""
                    contentStyle={{ fontSize: '10px', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold', backgroundColor: '#1e293b', color: '#f8fafc', border: 'none' }}
                    itemStyle={{ color: '#60a5fa' }}
                    cursor={{ stroke: 'rgba(59, 130, 246, 0.2)' }}
                  />
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
                  <Tooltip
                    labelFormatter={(label) => `${label}`}
                    formatter={(value: any) => [value, ""]}
                    separator=""
                    contentStyle={{ fontSize: '10px', borderRadius: '4px', padding: '2px 6px', fontWeight: 'bold', backgroundColor: '#1e293b', color: '#f8fafc', border: 'none' }}
                    itemStyle={{ color: '#60a5fa' }}
                    cursor={{ fill: 'transparent' }}
                  />
                  <Bar dataKey="val" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* COMPLIANCE PIE & ROUTE DISTRIBUTION BAR CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
        <div className="lg:col-span-2 bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col">
          <div className="flex flex-col mb-1">
            <h3 className="text-sm font-bold text-foreground">Operator Compliance</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Share of active, pending, and revoked operators.</p>
          </div>
          <div className="flex-1 min-h-[140px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value">
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any) => [value, ""]}
                  separator=""
                  contentStyle={{ fontSize: '11px', borderRadius: '6px', padding: '4px 8px', fontWeight: 'bold', border: 'none', backgroundColor: '#1e293b', color: '#f8fafc' }}
                  itemStyle={{ color: '#60a5fa' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-3 text-[9px] font-bold text-slate-700 dark:text-slate-200">
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-500 rounded-sm"></div> Active</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-amber-500 rounded-sm"></div> 1-Year</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500 rounded-sm"></div> 2+ Years</div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col">
          <div className="flex flex-col mb-1">
            <h3 className="text-sm font-bold text-foreground">Route Distribution</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total active operators per TODA line.</p>
          </div>
          <div className="flex-1 min-h-[140px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.route_breakdown}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="route" angle={-90} textAnchor="end" height={50} fontSize={8} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8' }} />
                <YAxis fontSize={9} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8' }} />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ fontSize: '11px', borderRadius: '6px', padding: '4px 8px', fontWeight: 'bold', border: 'none', backgroundColor: '#1e293b', color: '#f8fafc' }}
                  itemStyle={{ color: '#60a5fa' }}
                  formatter={(value: any) => [value, "Operators"]}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ROUTE DENSITY ANALYSIS */}
      <div className="bg-card border border-border p-5 rounded-xl shadow-sm">
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <MapPin className="w-4 h-4 text-slate-700 dark:text-slate-300" />
          Route Density Analysis
        </h3>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {activeRoutes.map((toda) => (
            <button
              key={toda}
              onClick={() => setActivePrediction(toda)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all border shadow-sm ${
                activePrediction === toda
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:text-white dark:border-blue-600"
                  : "bg-background text-slate-700 dark:text-slate-200 border-border hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {toda}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`col-span-1 border rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-inner h-[160px] transition-colors duration-500 ${clusterColor}`}>
            <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-80">
              SATURATION STATUS
            </p>
            <h2 className="text-sm md:text-md font-black mb-2 leading-tight px-2">
              {predictionData ? predictionData.forecast_period : "AWAITING DATA"}
            </h2>
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`text-4xl font-black ${textColor}`}>
                {predictionData ? predictionData.expected_renewals : "0"}
              </h3>
            </div>
            <p className="text-[10px] font-bold opacity-80 mb-2">
              Current Active Fleet
            </p>
            <div className="bg-background/80 backdrop-blur-sm border border-border/50 px-3 py-1 rounded-md text-[10px] font-bold shadow-sm">
              {predictionData ? predictionData.model_confidence : "Density Score: 0.00"}
            </div>
          </div>
          <div className="col-span-2 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[160px]">
              <div>
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Activity size={12} /> Contributing Factors
                </h4>
                <div className="space-y-2 relative group">
                  {predictionData ? predictionData.feature_importances.map((feat: any) => (
                    <div key={feat.factor} className="flex items-center gap-3 relative">
                      <span className="w-1/2 text-[9px] font-bold text-right text-muted-foreground truncate">
                        {feat.factor}
                      </span>
                      <div className="w-1/2 bg-muted rounded-full h-2.5 overflow-hidden relative cursor-crosshair">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-1000 ${feat.factor.includes('Density') ? 'bg-slate-700 dark:bg-slate-300' : 'bg-blue-500'}`}
                          style={{ width: `${feat.weight}%` }}
                        ></div>
                      </div>
                    </div>
                  )) : (
                    <div className="text-xs font-medium text-muted-foreground italic text-center py-4 bg-muted/30 rounded-lg border border-border">
                      Insufficient demographic data.
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-muted/20 border border-border/50 rounded-lg p-3 flex flex-col justify-between">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Settings2 size={12} /> Adjust Route Parameters
                </h4>
                <form onSubmit={handleUpdateRouteData} className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] font-bold w-20 shrink-0 text-foreground">
                      Population:
                    </label>
                    <input
                      type="number"
                      required
                      value={population}
                      onChange={(e) => setPopulation(e.target.value)}
                      placeholder="e.g. 5000"
                      className="flex-1 h-7 text-xs px-2 rounded-md border border-input bg-background font-mono shadow-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[9px] font-bold w-20 shrink-0 text-foreground">
                      Road (km):
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={roadLength}
                      onChange={(e) => setRoadLength(e.target.value)}
                      placeholder="e.g. 5.5"
                      className="flex-1 h-7 text-xs px-2 rounded-md border border-input bg-background font-mono shadow-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isUpdatingRoute}
                    className="w-full h-7 mt-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md text-[10px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isUpdatingRoute ? "Updating..." : "Update Route Factors"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}