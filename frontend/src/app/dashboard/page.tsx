"use client"; 

import { useEffect, useState, useCallback } from "react"; 
import { Database, Users, AlertTriangle, ArchiveX, Activity, Calendar, Globe, MapPin, Settings2, Loader2, FileText, CheckCircle2, X, XCircle, Printer } from "lucide-react"; 
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"; 
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { API_URL, fetchWithAuth } from "@/lib/api"; 

const COLORS = ['#10b981', '#f59e0b', '#ef4444']; 

interface GlobalStats {   
  total_system_capacity: number;   
  vacant_slots: number;   
  daily_apps: number;   
  weekly_apps: number;   
  monthly_apps: number;   
  yearly_apps: number;   
  flagged_pending: number;   
  route_breakdown: { route: string; total: number; active: number; count: number }[];   
  daily_trend: { name: string; val: number }[];   
  weekly_trend: { name: string; val: number }[];   
  monthly_trend: { name: string; val: number }[]; 
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function Dashboard() {   
  const [stats, setStats] = useState<GlobalStats | null>(null);   
  const [activePrediction, setActivePrediction] = useState("");   
  const [predictionData, setPredictionData] = useState<any>(null);   
  const [population, setPopulation] = useState("");   
  const [roadLength, setRoadLength] = useState("");   
  const [isUpdatingRoute, setIsUpdatingRoute] = useState(false);   
  const [toasts, setToasts] = useState<Toast[]>([]);

  // PREVIEW MODAL STATE
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [isDownloadingSummary, setIsDownloadingSummary] = useState(false);
  const [isPrintingSummary, setIsPrintingSummary] = useState(false);
  const [summaryWordSuccess, setSummaryWordSuccess] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {     
    const fetchStats = async () => {       
      try {         
        const res = await fetchWithAuth(`${API_URL}/stats/global`);         
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
      } catch (e) {         
        console.error("Dashboard failed to fetch stats", e);       
      }     
    };          
    
    fetchStats();     
    const interval = setInterval(fetchStats, 15000);     
    return () => clearInterval(interval);   
  }, []);   

  const fetchML = async () => {     
    if (!activePrediction) return;     
    try {       
      const res = await fetchWithAuth(`${API_URL}/predict/${activePrediction}`);       
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
    try {       
      const res = await fetchWithAuth(`${API_URL}/route_data/${activePrediction}`, {         
        method: 'POST',         
        headers: {           
          'Content-Type': 'application/json'         
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

  const handleOpenSummaryPreview = async () => {
    setIsSummaryOpen(true);
    setIsSummaryLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/toda-summary`);
      if (res.ok) {
        setSummaryData(await res.json());
      } else {
        showToast("Failed to load summary data.", "error");
      }
    } catch (e) {
      showToast("Network error while loading summary.", "error");
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const handleDownloadSummaryWord = async () => {
    if (isDownloadingSummary || !summaryData) return;
    setIsDownloadingSummary(true);
    const filename = `TOTAL RENEWAL ${summaryData.year}.docx`;
    
    try {
      const response = await fetchWithAuth(`${API_URL}/toda-summary/download/word`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1000);
        
        setSummaryWordSuccess(true);
        showToast(`${filename} downloaded successfully.`, "success");
        setTimeout(() => setSummaryWordSuccess(false), 2000);
      } else {
        showToast("Failed to download Word document.", "error");
      }
    } catch (error) {
      showToast("Network error during download.", "error");
    } finally {
      setIsDownloadingSummary(false);
    }
  };

  const handlePrintSummaryPDF = async () => {
    if (isPrintingSummary || !summaryData) return;
    setIsPrintingSummary(true);
    
    try {
      const response = await fetchWithAuth(`${API_URL}/toda-summary/generate`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        if (blob.type === "application/pdf") {
          const existingIframe = document.getElementById('pasada-print-frame');
          if (existingIframe) document.body.removeChild(existingIframe);
          
          const iframe = document.createElement('iframe');
          iframe.id = 'pasada-print-frame';
          iframe.style.position = 'fixed';
          iframe.style.right = '-2000px';
          iframe.style.bottom = '-2000px';
          iframe.style.width = '500px';
          iframe.style.height = '500px';
          iframe.src = url;
          
          document.body.appendChild(iframe);
          
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (e) {
              console.error(e);
            }
            setIsPrintingSummary(false);
            showToast(`Print dialog opened for TODA Summary.`, "success");
            setTimeout(() => window.URL.revokeObjectURL(url), 300000);
          }, 1500); 
        } else {
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `TOTAL RENEWAL ${summaryData.year}.docx`;
          document.body.appendChild(a);
          a.click();
          setIsPrintingSummary(false);
          showToast(`Downloaded fallback Word doc successfully.`, "success");
          setTimeout(() => document.body.removeChild(a), 100);
        }
      } else {
        setIsPrintingSummary(false);
        showToast("Print generation failed.", "error");
      }
    } catch (error) {
      setIsPrintingSummary(false);
      showToast("Network error during print generation.", "error");
    }
  };

  if (!stats) {     
    return (       
      <div className="space-y-4 p-4 md:p-6 animate-in fade-in duration-500 bg-background min-h-screen">
        <header className="mb-4 space-y-2">
          <div className="h-8 w-64 bg-muted/60 rounded-md animate-pulse"></div>
          <div className="h-4 w-96 bg-muted/60 rounded-md animate-pulse"></div>
        </header>
        
        {/* Skeleton KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border p-4 rounded-xl shadow-sm h-[104px] flex flex-col justify-between animate-pulse">
              <div className="flex justify-between items-center">
                <div className="h-3 w-32 bg-muted/60 rounded"></div>
                <div className="h-4 w-4 bg-muted/60 rounded"></div>
              </div>
              <div>
                <div className="h-8 w-16 bg-muted/60 rounded mb-1.5"></div>
                <div className="h-2 w-40 bg-muted/60 rounded"></div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Skeleton Mini Charts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card border border-border p-4 rounded-xl shadow-sm h-28 flex flex-col justify-between animate-pulse">
              <div className="flex justify-between items-start">
                <div className="h-3 w-24 bg-muted/60 rounded"></div>
                <div className="h-3 w-3 bg-muted/60 rounded"></div>
              </div>
              <div className="flex items-end justify-between">
                <div className="h-8 w-12 bg-muted/60 rounded"></div>
                <div className="h-10 w-24 bg-muted/60 rounded"></div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Skeleton Bottom Grids */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch h-[240px]">
           <div className="lg:col-span-2 bg-card border border-border rounded-xl animate-pulse"></div>
           <div className="lg:col-span-3 bg-card border border-border rounded-xl animate-pulse"></div>
        </div>
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
      
      {/* TODA SUMMARY PREVIEW MODAL */}
      <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
        <DialogContent className="sm:max-w-[700px] shadow-2xl rounded-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-blue-600" /> TODA Renewal Summary Preview
            </DialogTitle>
            <DialogDescription>
              Verify route counts before printing or downloading the official summary document.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {isSummaryLoading ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-sm font-bold text-muted-foreground animate-pulse">Calculating route totals...</p>
              </div>
            ) : summaryData ? (
              <div className="space-y-4">
                
                <div className="border rounded-xl overflow-hidden shadow-sm">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="font-bold w-16">#</TableHead>
                        <TableHead className="font-bold uppercase">TODA</TableHead>
                        <TableHead className="font-bold text-center uppercase">MEMBER PER TODA</TableHead>
                        <TableHead className="font-bold text-center text-emerald-600 uppercase">
                          RENEWAL AS OF <br /> {summaryData.as_of_date}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryData.rows.map((row: any, i: number) => (
                        <TableRow key={row.route}>
                          <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-bold">{row.route}</TableCell>
                          <TableCell className="font-mono text-center text-[15px]">{row.total}</TableCell>
                          <TableCell className="font-mono text-center font-bold text-emerald-600 text-[15px]">{row.renewed}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={2} className="font-black text-right pr-6 uppercase">TOTAL</TableCell>
                        <TableCell className="font-black font-mono text-center text-lg">{summaryData.grand_total}</TableCell>
                        <TableCell className="font-black font-mono text-center text-lg text-emerald-600">{summaryData.grand_renewed}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                <p className="font-medium">Failed to load preview data.</p>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 pt-4 border-t">
            {summaryData && (
              <>
                <Button 
                  variant="outline" 
                  onClick={handleDownloadSummaryWord} 
                  disabled={isDownloadingSummary}
                  className="font-bold"
                >
                  {isDownloadingSummary ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
                  ) : summaryWordSuccess ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4 text-blue-600" />
                  )}
                  Download Word File
                </Button>
                <Button onClick={handlePrintSummaryPDF} disabled={isPrintingSummary} className="font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md">
                  {isPrintingSummary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                  Print PDF
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        
        <div className="lg:col-span-3 bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col text-slate-800 dark:text-slate-200">
          <div className="flex justify-between items-start mb-1">
            <div className="flex flex-col">
              <h3 className="text-sm font-bold text-foreground">Route Distribution</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Active vs. Unrenewed operators per TODA line.</p>
            </div>
            
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleOpenSummaryPreview} 
              className="h-8 text-[10px] font-bold shadow-sm"
            >
              <FileText className="mr-1.5 h-3 w-3" />
              TODA Renewal Summary
            </Button>
          </div>
          <div className="flex-1 min-h-[140px] w-full mt-2">                          
            <ResponsiveContainer width="100%" height="100%">                              
              <BarChart data={stats.route_breakdown.map(r => ({...r, remaining: r.total - r.active}))}>                                  
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />                                  
                <XAxis dataKey="route" angle={-90} textAnchor="end" height={50} fontSize={10} tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontWeight: 'bold' }} />                                  
                <YAxis fontSize={11} tickLine={false} axisLine={false} tick={{ fill: 'currentColor', fontWeight: 'bold' }} />                                  
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-slate-100 p-3 rounded-lg shadow-xl border border-slate-800 text-xs font-bold z-50">
                          <p className="text-[14px] text-blue-400 mb-2 border-b border-slate-700 pb-1">{label}</p>
                          <p className="mb-1 text-slate-300">Total: <span className="font-mono text-[13px] text-white ml-1">{data.total}</span></p>
                          <p className="text-emerald-400 mb-1">Active: <span className="font-mono text-[13px] ml-1">{data.active}</span></p>
                          <p className="text-red-400">Unrenewed/Vacant: <span className="font-mono text-[13px] ml-1">{data.remaining}</span></p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />                               
                <Bar dataKey="active" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />                                
                <Bar dataKey="remaining" stackId="a" fill="#64748b" radius={[3, 3, 0, 0]} />                              
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
              Current Active Operators                          
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

      {/* CUSTOM TOAST CONTAINER */}       
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">         
        {toasts.map(toast => (           
          <div key={toast.id} className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-bold animate-in slide-in-from-right-8 fade-in duration-300 ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>             
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}             
            <span className="flex-1">{toast.message}</span>             
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="ml-4 opacity-50 hover:opacity-100 transition-opacity shrink-0"><X className="h-4 w-4" /></button>           
          </div>         
        ))}       
      </div>     
    </div>      
  ); 
}