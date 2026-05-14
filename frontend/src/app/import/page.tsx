"use client";

import { useState } from "react";
import { UploadCloud, CheckCircle, Loader2, FileText, AlertTriangle, Database } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:43888";

export default function MassImport() {
  const [selectedRoute, setSelectedRoute] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const isDatabaseFile = files.length === 1 && files[0].name.endsWith(".db");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      // Browsers can handle selecting 10,000 files, we store them instantly in React state
      setFiles(Array.from(e.target.files));
    }
  };

  const executeUpload = async () => {
    setUploading(true);
    setSuccessMsg("");
    setErrorMsg("");

    const token = localStorage.getItem("pasada_token") || localStorage.getItem("token");

    try {
      if (isDatabaseFile) {
        // Handle Direct Database Migration (.db)
        const formData = new FormData();
        formData.append("file", files[0]);

        const res = await fetch(`${API_URL}/upload/database`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          body: formData
        });

        if (!res.ok) throw new Error("Database migration failed");
        const data = await res.json();
        setSuccessMsg(`Database seamlessly merged! Added ${data.imported} new records.`);
      } else {
        // Handle Standard Legacy Chunks (.docx, .xlsx, .csv)
        if (!selectedRoute.trim()) {
          setErrorMsg("Please provide a valid Target Route.");
          setUploading(false);
          return;
        }

        let importedTotal = 0;
        
        //UPGRADED: 500 files per chunk. Handles 10,000 files in just 20 rapid-fire requests.
        const CHUNK_SIZE = 500; 
        const totalChunks = Math.ceil(files.length / CHUNK_SIZE);
        const formattedRoute = selectedRoute.trim().toUpperCase();

        for (let i = 0; i < totalChunks; i++) {
          const chunk = files.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const formData = new FormData();
          chunk.forEach(f => formData.append("files", f));

          const res = await fetch(`${API_URL}/upload/bulk/${formattedRoute}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
          });

          if (!res.ok) throw new Error("Chunk failed to upload");
          const data = await res.json();
          importedTotal += data.imported;
          
          setProgress(Math.round(((i + 1) / totalChunks) * 100));
        }
        
        // Broadcast custom event so the Sidebar instantly refreshes its TODA list
        window.dispatchEvent(new Event('toda_imported'));
        setSuccessMsg(`Successfully extracted and imported ${importedTotal} unique records for ${formattedRoute}.`);
      }
      
      setFiles([]);
      setSelectedRoute("");
    } catch (err) {
      setErrorMsg("Data ingestion interrupted. Server connection failed during upload.");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl animate-in fade-in duration-500">
      <div className="flex items-center gap-3 mb-8">
        <UploadCloud className="w-8 h-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">System Data Migration</h1>
          <p className="text-muted-foreground mt-1 font-medium">Extract legacy documents or merge external SQLite databases.</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg flex items-center gap-2 font-bold shadow-sm">
            <CheckCircle size={18} /> {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg flex items-center gap-2 font-bold shadow-sm">
            <AlertTriangle size={18} /> {errorMsg}
          </div>
        )}

        <div className="space-y-6">
          {!isDatabaseFile && (
            <div className="space-y-2 animate-in fade-in">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Route Assignment (E.g. BATODA)</label>
              <input 
                type="text"
                value={selectedRoute} 
                onChange={(e) => setSelectedRoute(e.target.value.toUpperCase())}
                placeholder="Required for .docx/.csv files"
                className="w-full bg-input/50 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
              />
            </div>
          )}

          {isDatabaseFile && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl flex items-center gap-3 animate-in fade-in">
              <Database className="text-blue-600" size={24} />
              <div>
                <p className="text-sm font-bold text-blue-600">Database Migration File Detected</p>
                <p className="text-xs text-blue-600/80 font-semibold">The system will automatically parse and merge all new records.</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Upload Files (.docx, .xlsx, .csv, .db)</label>
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center bg-muted/20 hover:bg-muted/50 transition-colors relative">
              <input 
                type="file" 
                multiple 
                accept=".docx,.xlsx,.csv,.db" 
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Click or Drag & Drop municipal files here</p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">{files.length.toLocaleString()} files currently queued for extraction</p>
            </div>
          </div>

          {uploading ? (
            <div className="bg-muted/30 border border-border rounded-xl p-6 text-center space-y-4">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <div>
                <p className="text-sm font-bold">{isDatabaseFile ? "Merging Database Integrity..." : "Extracting Data Payload"}</p>
                <p className="text-xs text-muted-foreground font-medium mt-1">Please do not close this window.</p>
              </div>
              {!isDatabaseFile && (
                <>
                  <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                    <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                  </div>
                  <p className="text-xs font-bold text-blue-600">{progress}% Complete</p>
                </>
              )}
            </div>
          ) : (
            <button 
              onClick={executeUpload}
              disabled={files.length === 0 || (!isDatabaseFile && !selectedRoute.trim())}
              className="w-full bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md"
            >
              <UploadCloud size={18} /> Execute Data Integration
            </button>
          )}
        </div>
      </div>
    </div>
  );
}