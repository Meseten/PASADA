"use client";

import { useState, useRef, useCallback } from "react";
import { UploadCloud, Loader2, FileText, AlertTriangle, Database, CheckCircle2, XCircle, X } from "lucide-react";
import { API_URL, fetchWithAuth } from "@/lib/api";

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning';
}

export default function MassImport() {
  const [selectedRoute, setSelectedRoute] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  
  const [toasts, setToasts] = useState<Toast[]>([]);

  const isDatabaseFile = files.length === 1 && files[0].name.endsWith(".db");

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const startFluidProgress = (estimatedSeconds: number) => {
    setProgress(0);
    const intervalMs = 50; 
    const totalSteps = (estimatedSeconds * 1000) / intervalMs;
    let currentStep = 0;
    progressInterval.current = setInterval(() => {
      currentStep++;
      const percentage = 95 * (1 - Math.pow(1 - currentStep / totalSteps, 3));
      setProgress((prev) => {
        const next = Math.min(percentage, 95);
        return next > prev ? next : prev;
      });
    }, intervalMs);
  };

  const stopFluidProgress = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    setProgress(100);
  };

  const executeUpload = async () => {
    setUploading(true);
    setServerErrors([]);
    try {
      if (isDatabaseFile) {
        startFluidProgress(1.5);
        const formData = new FormData();
        formData.append("file", files[0]);
        const res = await fetchWithAuth(`${API_URL}/upload/database`, {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        stopFluidProgress();
        showToast(`Database imported! Added ${data.imported} new records.`, "success");
      } else {
        if (!selectedRoute.trim()) {
          showToast("Please enter a valid route name.", "error");
          setUploading(false);
          return;
        }
        let importedTotal = 0;
        let chunkErrors: string[] = [];
        const CHUNK_SIZE = 500;
        const totalChunks = Math.ceil(files.length / CHUNK_SIZE);
        const formattedRoute = selectedRoute.trim().toUpperCase();
        
        const estimatedSeconds = Math.max(files.length * 0.1, 2);
        startFluidProgress(estimatedSeconds);
        
        for (let i = 0; i < totalChunks; i++) {
          const chunk = files.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const formData = new FormData();
          chunk.forEach(f => formData.append("files", f));
          try {
            const res = await fetchWithAuth(`${API_URL}/upload/bulk/${formattedRoute}`, {
              method: "POST",
              body: formData
            });
            const data = await res.json();
            importedTotal += data.imported || 0;
            if (data.errors && data.errors.length > 0) {
              chunkErrors = [...chunkErrors, ...data.errors];
            }
          } catch (chunkErr) {
            chunkErrors.push(`Failed to upload chunk ${i + 1}`);
          }
        }
        stopFluidProgress();
        setServerErrors(chunkErrors);
        showToast(`Successfully imported ${importedTotal} records for ${formattedRoute}.`, "success");
        window.dispatchEvent(new Event('toda_imported'));
      }
      setTimeout(() => {
        setFiles([]);
        setSelectedRoute("");
        setUploading(false);
        setProgress(0);
      }, 3000);
    } catch (err: any) {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
      setProgress(0);
      setUploading(false);
      showToast(err.message || "Upload failed. Ensure the server is connected.", "error");
    }
  };

  return (
    <div className="p-6 md:p-8 animate-in fade-in duration-500 w-full max-w-[1600px] min-h-screen bg-muted/5">
      <div className="flex items-center gap-3 mb-8">
        <UploadCloud className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">Import Records</h1>
          <p className="text-muted-foreground mt-1 font-medium">Upload Excel spreadsheets, Word files, or backup databases.</p>
        </div>
      </div>
      
      <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
        {serverErrors.length > 0 && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-700 rounded-lg shadow-sm text-sm font-bold animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} /> <span>{serverErrors.length} Warning(s) during import:</span>
            </div>
            <ul className="list-disc pl-6 space-y-1 font-medium text-xs">
              {serverErrors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
              {serverErrors.length > 5 && <li>...and {serverErrors.length - 5} more.</li>}
            </ul>
          </div>
        )}
        
        <div className="space-y-6">
          {!isDatabaseFile && (
            <div className="space-y-2 animate-in fade-in">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Route (e.g., BATODA)</label>
              <input
                type="text"
                value={selectedRoute}
                onChange={(e) => setSelectedRoute(e.target.value.toUpperCase())}
                disabled={uploading}
                placeholder="E.g. BATODA (Required for Excel/Word files)"
                className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase transition-all disabled:opacity-60"
              />
            </div>
          )}
          
          {isDatabaseFile && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl flex items-center gap-3 animate-in fade-in">
              <Database className="text-blue-600" size={24} />
              <div>
                <p className="text-sm font-bold text-blue-600">Database Backup File Detected</p>
                <p className="text-xs text-blue-600/80 font-semibold">The system will import all records from this backup file.</p>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select Files (.docx, .xlsx, .csv, .db)</label>
            <div className={`border-2 border-dashed border-border rounded-xl p-8 text-center bg-muted/20 transition-colors relative ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/50'}`}>
              <input
                type="file"
                multiple
                accept=".docx,.xlsx,.csv,.db"
                onChange={handleFileChange}
                disabled={uploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Click or drag files here</p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">{files.length.toLocaleString()} files ready to upload</p>
            </div>
          </div>
          
          {uploading ? (
            <div className="bg-muted/30 border border-border rounded-xl p-6 text-center space-y-4 animate-in fade-in zoom-in-95">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <div>
                <p className="text-sm font-bold">{isDatabaseFile ? "Importing Database..." : "Processing & Merging Files..."}</p>
                <p className="text-xs text-muted-foreground font-medium mt-1">Please do not close this window.</p>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 overflow-hidden shadow-inner relative">
                <div
                  className="bg-blue-600 h-3 rounded-full absolute left-0 top-0 bottom-0"
                  style={{
                    width: `${Math.max(progress, 2)}%`,
                    transition: progress === 100 ? 'width 0.2s ease-out' : 'width 0.1s linear'
                  }}
                >
                  <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_1s_infinite]"></div>
                </div>
              </div>
              <p className="text-xs font-bold text-blue-600">{Math.round(progress)}% Complete</p>
            </div>
          ) : (
            <button
              onClick={executeUpload}
              disabled={files.length === 0 || (!isDatabaseFile && !selectedRoute.trim())}
              className="w-full bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md"
            >
              <UploadCloud size={18} /> Import Files
            </button>
          )}
        </div>
      </div>

      {/* CUSTOM TOAST CONTAINER */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-bold animate-in slide-in-from-right-8 fade-in duration-300 ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : toast.type === 'warning' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" /> : toast.type === 'warning' ? <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="ml-4 opacity-50 hover:opacity-100 transition-opacity shrink-0"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}