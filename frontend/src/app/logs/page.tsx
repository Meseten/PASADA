"use client"

import { useState, useEffect, useCallback } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { History, ArchiveX, CheckCircle2, XCircle, X, Loader2 } from "lucide-react"
import { API_URL, fetchWithAuth } from "@/lib/api";

interface LogEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  target_record: string;
  details: string;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetchWithAuth(`${API_URL}/logs`);
        if (response.ok) {
          const data = await response.json();
          setLogs(data);
        } else {
          showToast("Failed to fetch system logs.", "error");
        }
      } catch (error) {
        console.error(error);
        showToast("Network error. Please check your connection.", "error");
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, [showToast]);

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500 min-h-screen bg-muted/5">
      <div className="flex items-center gap-3 mb-6">
        <History className="w-8 h-8 text-blue-600" />
        <div>
          <h2 className="text-3xl font-black tracking-tight">Activity History</h2>
          <p className="text-muted-foreground mt-1 font-medium">System-wide audit log of all clerical actions.</p>
        </div>
      </div>
      
      <Card className="shadow-sm border-border/60 rounded-2xl overflow-hidden bg-card">
        <CardHeader className="bg-muted/10 pb-5 border-b border-border/50">
          <CardTitle className="text-xl font-bold">System Action Log</CardTitle>
          <CardDescription className="font-medium mt-1">Recent operations performed across the LGU database.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto min-h-[400px]">
            <Table>
              <TableHeader className="bg-muted/20 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-bold text-muted-foreground w-[200px] h-12 pl-6">Timestamp</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-[180px]">User</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-[180px]">Action</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-[250px]">Target Record</TableHead>
                  <TableHead className="font-bold text-muted-foreground pr-6">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="animate-pulse hover:bg-transparent">
                      <TableCell className="pl-6"><div className="h-4 w-32 bg-muted/60 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-24 bg-muted/60 rounded" /></TableCell>
                      <TableCell><div className="h-6 w-28 bg-muted/60 rounded-full" /></TableCell>
                      <TableCell><div className="h-4 w-32 bg-muted/60 rounded" /></TableCell>
                      <TableCell className="pr-6"><div className="h-4 w-full bg-muted/60 rounded" /></TableCell>
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-64 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <ArchiveX className="h-10 w-10 mb-3 opacity-20" />
                        No activity logs found.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-muted/30 transition-colors border-b border-border/40">
                      <TableCell className="pl-6 text-sm font-bold text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString(undefined, { 
                          year: 'numeric', month: 'short', day: 'numeric', 
                          hour: '2-digit', minute: '2-digit' 
                        })}
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
                  ))
                )}
              </TableBody>
            </Table>
          </div>
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