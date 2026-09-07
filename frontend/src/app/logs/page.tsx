"use client"

import { useState, useEffect, useCallback } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { History, ArchiveX, CheckCircle2, XCircle, X, Loader2, Filter, Search, ArrowUpDown, Download } from "lucide-react"
import { API_URL, fetchWithAuth } from "@/lib/api"

interface LogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  target_record: string;
  details: string;
  route?: string;
  sbn_no?: string;
  operator_name?: string;
  field_changed?: string;
  secondary_value?: string;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  
  const [search, setSearch] = useState("");
  const [deferredSearch, setDeferredSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState<"ALL" | "CHANGE_MOTOR">("ALL");
  
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => { setToasts(prev => prev.filter(t => t.id !== id)); }, 4000);
  }, []);

  // Fetch dynamic filters
  useEffect(() => {
    fetchWithAuth(`${API_URL}/logs/actions`)
        .then(res => res.json())
        .then(data => {
            if (data.routes) setAvailableRoutes(data.routes);
            if (data.actions) setAvailableActions(data.actions);
        }).catch(console.error);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDeferredSearch(search);
      setCurrentPage(1); 
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [routeFilter, actionFilter, viewMode]);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const endpoint = viewMode === "CHANGE_MOTOR" ? "/logs/change-motor" : "/logs";
      let url = `${API_URL}${endpoint}?page=${currentPage}&page_size=${rowsPerPage}`;
      
      if (routeFilter !== "ALL") url += `&route=${encodeURIComponent(routeFilter)}`;
      if (actionFilter !== "ALL" && viewMode === "ALL") url += `&action=${encodeURIComponent(actionFilter)}`;
      if (deferredSearch) url += `&search=${encodeURIComponent(deferredSearch)}`;
      
      const response = await fetchWithAuth(url);
      if (response.ok) {
        const data = await response.json();
        setLogs(data.items || []);
        setTotalLogs(data.total || 0);
      } else {
        showToast("Failed to fetch system logs.", "error");
      }
    } catch (error) {
      console.error(error);
      showToast("Network error. Please check your connection.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, rowsPerPage, routeFilter, actionFilter, deferredSearch, viewMode, showToast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleExportLogs = async () => {
    setIsExporting(true);
    try {
        const endpoint = viewMode === "CHANGE_MOTOR" ? "/export/logs/change-motor" : "/export/logs";
        let url = `${API_URL}${endpoint}?`;
        const params = new URLSearchParams();
        
        if (routeFilter !== "ALL") params.append("route", routeFilter);
        if (actionFilter !== "ALL" && viewMode === "ALL") params.append("action", actionFilter);
        if (deferredSearch) params.append("search", deferredSearch);
        
        const response = await fetchWithAuth(`${url}${params.toString()}`);
        if (response.ok) {
            const blob = await response.blob();
            const objUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = objUrl;
            a.download = viewMode === "CHANGE_MOTOR" 
                ? `CHANGE MOTOR HISTORY ${new Date().getFullYear()}.xlsx`
                : `ACTIVITY LOGS ${new Date().getFullYear()}.xlsx`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(objUrl);
            }, 1000);
            showToast("Logs exported successfully.", "success");
        } else {
            showToast("Failed to export logs.", "error");
        }
    } catch (error) {
        showToast("Network error while exporting.", "error");
    } finally {
        setIsExporting(false);
    }
  };

  const totalPages = Math.ceil(totalLogs / rowsPerPage);

  const renderPagination = (position: 'top' | 'bottom') => (
    <div className={`flex flex-col sm:flex-row items-center justify-between px-6 py-4 bg-muted/10 border-border/60 ${position === 'top' ? 'border-b' : 'border-t'}`}>
      <div className="text-sm text-muted-foreground font-bold mb-4 sm:mb-0">
        Showing {totalLogs === 0 ? 0 : ((currentPage - 1) * rowsPerPage) + 1} to {Math.min(currentPage * rowsPerPage, totalLogs)} of {totalLogs} records
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-muted-foreground">Rows per page:</span>
          <select
              value={rowsPerPage}
              onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
            className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center] bg-[length:16px_16px] h-8 w-20 rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer pr-8"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || isLoading}>Previous</Button>
          <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0 || isLoading}>Next</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500 min-h-screen bg-muted/5">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-8">
          <div className="flex items-center gap-3 shrink-0">
              <History className="w-8 h-8 text-blue-600" />
              <div>
                  <h2 className="text-3xl font-black tracking-tight">Activity History</h2>
                  <p className="text-muted-foreground mt-1 font-medium">System-wide audit log of all clerical actions.</p>
              </div>
          </div>
          
          <div className="flex flex-wrap items-center xl:justify-end gap-3 w-full xl:w-auto md:ml-auto">
              <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-lg px-3 h-11 shadow-sm">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <select
                      value={routeFilter}
                      onChange={(e) => setRouteFilter(e.target.value)}
                      className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer pr-2 text-foreground"
                  >
                      <option value="ALL">All TODA Routes</option>
                      {availableRoutes.length > 0 ? availableRoutes.map(r => (
                          <option key={r} value={r}>{r}</option>
                      )) : (
                          // Fallback list
                          ['BATODA', 'BBSTODA', 'CNTODA', 'CO1TODA', 'CO2TODA', 'DOMMSATODA', 'HCTODA', 'HMTODA', 'HVRTODA', 'MALATODA', 'MMGTODA', 'MMTODA', 'NCTODA', 'NPTODA', 'PAL1TODA', 'PAL2TODA', 'SABANGTODA', 'SMSTODA', 'TCTODA', 'VASTODA', 'VISTODA'].map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))
                      )}
                  </select>
              </div>

              {viewMode === "ALL" && (
                <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-lg px-3 h-11 shadow-sm">
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                    <select
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer pr-2 text-foreground"
                    >
                        <option value="ALL">All Actions</option>
                        {availableActions.map(a => (
                            <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                        ))}
                    </select>
                </div>
              )}

              <Button variant="outline" onClick={handleExportLogs} disabled={isExporting} className="shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-emerald-600">
                  {isExporting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
                  Export Excel
              </Button>

              <div className="relative w-full md:w-72 group">
                  <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground group-focus-within:text-blue-600 transition-colors" />
                  <Input 
                      placeholder="Search Logs..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-10 h-11 bg-card border-border/50 focus:bg-background transition-all rounded-lg shadow-sm font-medium"
                  />
              </div>
          </div>
      </div>
             
      <Card className="shadow-sm border-border/60 rounded-2xl overflow-hidden bg-card">
        <div className="flex border-b border-border/60 bg-muted/10 px-4 pt-4 shadow-sm">
            <button 
                onClick={() => { setViewMode("ALL"); setActionFilter("ALL"); setCurrentPage(1); }} 
                className={`px-4 py-3 font-bold text-sm border-b-2 transition-colors ${viewMode === "ALL" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >All Activity Logs</button>
            <button 
                onClick={() => { setViewMode("CHANGE_MOTOR"); setActionFilter("CHANGE_MOTOR"); setCurrentPage(1); }} 
                className={`px-4 py-3 font-bold text-sm border-b-2 transition-colors ${viewMode === "CHANGE_MOTOR" ? "border-blue-600 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >Change Motor History</button>
        </div>

        <CardContent className="p-0">
          {renderPagination('top')}
          <div className="overflow-x-auto min-h-[400px]">
            <Table>
              <TableHeader className="bg-muted/20 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-bold text-muted-foreground w-[200px] h-12 pl-6">Timestamp</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-[180px]">User</TableHead>
                  {viewMode === "ALL" && <TableHead className="font-bold text-muted-foreground w-[180px]">Action</TableHead>}
                  <TableHead className="font-bold text-muted-foreground w-[250px]">SBN / Operator</TableHead>
                  {viewMode === "CHANGE_MOTOR" ? (
                    <>
                      <TableHead className="font-bold text-muted-foreground">Field(s) Changed</TableHead>
                      <TableHead className="font-bold text-muted-foreground w-[350px]">Detailed Changes</TableHead>
                      <TableHead className="font-bold text-muted-foreground pr-6">New Date Issued</TableHead>
                    </>
                  ) : (
                    <TableHead className="font-bold text-muted-foreground pr-6">Details</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="animate-pulse hover:bg-transparent">
                      <TableCell className="pl-6"><div className="h-4 w-32 bg-muted/60 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-24 bg-muted/60 rounded" /></TableCell>
                      {viewMode === "ALL" && <TableCell><div className="h-6 w-28 bg-muted/60 rounded-full" /></TableCell>}
                      <TableCell><div className="h-4 w-32 bg-muted/60 rounded" /></TableCell>
                      {viewMode === "CHANGE_MOTOR" ? (
                        <>
                          <TableCell><div className="h-4 w-24 bg-muted/60 rounded" /></TableCell>
                          <TableCell><div className="h-4 w-full bg-muted/60 rounded" /></TableCell>
                          <TableCell className="pr-6"><div className="h-4 w-24 bg-muted/60 rounded" /></TableCell>
                        </>
                      ) : (
                        <TableCell className="pr-6"><div className="h-4 w-full bg-muted/60 rounded" /></TableCell>
                      )}
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={viewMode === "CHANGE_MOTOR" ? 7 : 5} className="h-64 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <ArchiveX className="h-10 w-10 mb-3 opacity-20" />
                        {deferredSearch ? "No activity logs matched your search." : "No activity logs found."}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    if (viewMode === "CHANGE_MOTOR") {
                        return (
                            <TableRow key={log.id} className="hover:bg-muted/30 transition-colors border-b border-border/40">
                                <TableCell className="pl-6 text-sm font-bold text-muted-foreground">
                                    {log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "-"}
                                </TableCell>
                                <TableCell className="font-bold text-slate-800 dark:text-slate-200">{log.user || "SYSTEM ADMIN"}</TableCell>
                                <TableCell className="font-mono text-sm font-bold opacity-90">
                                    {log.sbn_no || "Unknown"} <br/><span className="text-xs text-muted-foreground opacity-80">{log.operator_name || "VACANT"}</span>
                                </TableCell>
                                <TableCell className="text-sm font-medium text-foreground/80">{log.field_changed || "-"}</TableCell>
                                <TableCell className="text-sm font-medium text-foreground/80 leading-relaxed">{log.details || "-"}</TableCell>
                                <TableCell className="text-sm font-bold text-emerald-600 pr-6">{log.secondary_value || "-"}</TableCell>
                            </TableRow>
                        )
                    }

                    return (
                        <TableRow key={log.id} className="hover:bg-muted/30 transition-colors border-b border-border/40">
                        <TableCell className="pl-6 text-sm font-bold text-muted-foreground">
                            {log.timestamp ? new Date(log.timestamp).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "-"}
                        </TableCell>
                        <TableCell className="font-bold text-slate-800 dark:text-slate-200">
                            {log.user || "SYSTEM ADMIN"}
                        </TableCell>
                        <TableCell>
                            <span className="bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300 text-[10px] uppercase font-black px-2 py-1 rounded shadow-sm tracking-wide">
                            {log.action}
                            </span>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-bold opacity-90">{log.target_record}</TableCell>
                        <TableCell className="text-sm font-medium text-foreground/80 pr-6 leading-relaxed">
                            {log.details}
                        </TableCell>
                        </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {renderPagination('bottom')}
        </CardContent>
      </Card>

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