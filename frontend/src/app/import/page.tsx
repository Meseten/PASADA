"use client"; 

import { useState, useRef, useCallback, useEffect } from "react"; 
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
  
  // Settings State
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [dbImportMode, setDbImportMode] = useState<'merge' | 'restore'>('merge');
  
  const isDatabaseFile = files.length === 1 && files[0].name.endsWith(".db");   

  useEffect(() => {
    // Load Client-side UI preferences
    const pref = localStorage.getItem("pasada_force_overwrite");
    if (pref !== null) setForceOverwrite(pref === "true");
  }, []);

  const handleToggleForceOverwrite = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setForceOverwrite(val);
    localStorage.setItem("pasada_force_overwrite", String(val));
  };
  
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
        if (dbImportMode === 'restore') {
            const confirmed = window.confirm("WARNING: Full Restore will OVERWRITE all existing records that match the backup by ID. Are you sure you want to proceed?");
            if (!confirmed) {
                setUploading(false);
                return;
            }
        }

        startFluidProgress(1.5);         
        const formData = new FormData();         
        formData.append("file", files[0]);         
        
        const endpoint = dbImportMode === 'restore' ? `${API_URL}/restore/database` : `${API_URL}/upload/database`;

        const res = await fetchWithAuth(endpoint, {           
          method: "POST",           
          body: formData         
        });         
        
        if (!res.ok) {
          let errDetail = res.statusText;
          try { 
            const errData = await res.json(); 
            errDetail = errData.detail || errDetail; 
          } catch (e) {}
          stopFluidProgress();
          showToast(`Database import failed: ${errDetail}`, "error");
          setUploading(false);
          return;
        }

        const data = await res.json();         
        stopFluidProgress();         
        
        if (dbImportMode === 'restore') {
            showToast(`Database restored! Inserted: ${data.restored_inserted}, Updated: ${data.restored_updated}.`, "success");
        } else {
            if (typeof data.imported === 'number') {
              showToast(`Database imported! Added ${data.imported} new records.`, "success");       
            } else {
              showToast("Database import failed: Invalid server response.", "error");
            }
        }
      } else {         
        if (!selectedRoute.trim()) {           
          showToast("Please enter a valid route name.", "error");           
          setUploading(false);           
          return;         
        }         
        
        let importedTotal = 0;         
        let chunkErrors: string[] = [];         
        let chunksSucceeded = 0;
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
            const res = await fetchWithAuth(`${API_URL}/upload/bulk/${formattedRoute}?force_overwrite=${forceOverwrite}`, {               
              method: "POST",               
              body: formData             
            });             
            
            if (!res.ok) {
              let errDetail = res.statusText;
              try { 
                const errData = await res.json(); 
                errDetail = errData.detail || errDetail; 
              } catch (e) {}
              chunkErrors.push(`Chunk ${i + 1} failed (${res.status}): ${errDetail}`);
              continue;
            }
            
            const data = await res.json();             
            importedTotal += data.imported || 0;             
            
            if (data.errors && data.errors.length > 0) {               
              chunkErrors = [...chunkErrors, ...data.errors];             
            }           
            chunksSucceeded++;
          } catch (chunkErr: any) {             
            chunkErrors.push(`Failed to upload chunk ${i + 1}: ${chunkErr.message || "Network Error"}`);           
          }         
        }         
        
        stopFluidProgress();         
        setServerErrors(chunkErrors);         
        
        if (chunksSucceeded > 0) {
          showToast(`Successfully imported ${importedTotal} records for ${formattedRoute}.`, "success");         
          window.dispatchEvent(new Event('toda_imported'));       
        } else {
          showToast(`Import failed. All ${totalChunks} chunk(s) were rejected.`, "error");
        }
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
            <>
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
              <div className="space-y-3 pt-2 pb-2 border-b border-border animate-in fade-in">
                  <label className="flex items-center gap-3 cursor-pointer w-max">
                      <input
                          type="checkbox"
                          checked={forceOverwrite}
                          onChange={handleToggleForceOverwrite}
                          className="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className="text-sm font-bold text-red-600 dark:text-red-400">Force overwrite existing records</span>
                  </label>
                  <p className="text-xs text-muted-foreground font-medium pl-8">
                      Fully replaces matched records on re-upload, ignoring dates. Use only when intentionally correcting data.
                  </p>
              </div>
            </>
          )}                      
          
          {isDatabaseFile && (             
            <div className="bg-blue-500/10 border border-blue-500/30 p-5 rounded-xl space-y-4 animate-in fade-in">               
              <div className="flex items-center gap-3">
                <Database className="text-blue-600 shrink-0" size={24} />               
                <div>                 
                  <p className="text-sm font-bold text-blue-600">Database Backup File Detected</p>                 
                  <p className="text-xs text-blue-600/80 font-semibold">Choose how to import records from this backup file.</p>               
                </div>             
              </div>

              <div className="space-y-3 pt-2">
                 <label className="flex items-start gap-3 cursor-pointer">
                   <input type="radio" name="db_mode" checked={dbImportMode === 'merge'} onChange={() => setDbImportMode('merge')} className="mt-0.5" />
                   <div>
                     <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Merge new records only</p>
                     <p className="text-xs text-muted-foreground font-medium">Adds new records. Existing records are skipped.</p>
                   </div>
                 </label>
                 <label className="flex items-start gap-3 cursor-pointer">
                   <input type="radio" name="db_mode" checked={dbImportMode === 'restore'} onChange={() => setDbImportMode('restore')} className="mt-0.5" />
                   <div>
                     <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Full Restore (overwrite existing by ID)</p>
                     <p className="text-xs text-muted-foreground font-medium">Replaces current records with the contents of this backup.</p>
                   </div>
                 </label>
              </div>

              <div className="bg-background/50 border border-blue-500/20 p-3 rounded-lg mt-2">
                 <p className="text-xs text-muted-foreground font-medium italic">
                   Note: Normal re-upload does not reset the system. To reset for testing, download a .db backup first, then use Full Restore to return to that snapshot.
                 </p>
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
                <p className="text-sm font-bold">{isDatabaseFile ? (dbImportMode === 'restore' ? "Restoring Database..." : "Importing Database...") : "Processing & Merging Files..."}</p>                 
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