"use client"; 

import { useEffect, useState, useCallback } from "react"; 
import { Settings as SettingsIcon, Save, Server, Shield, Download, CheckCircle, Loader2, AlertTriangle, RefreshCw, X, CheckCircle2, XCircle } from "lucide-react"; 
import { API_URL, fetchWithAuth } from "@/lib/api"; 

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function Settings() {   
  const [activeTab, setActiveTab] = useState("general");   
  const [chairName, setChairName] = useState("");   
  const [targetToda, setTargetToda] = useState("ALL");   
  const [targetYear, setTargetYear] = useState("ALL");   
  const [exportStatus, setExportStatus] = useState("ALL");   
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);   
  const [availableYears, setAvailableYears] = useState<number[]>([]);   
  const [newPassword, setNewPassword] = useState("");   
  const [newUsername, setNewUsername] = useState("");   
  const [networkInfo, setNetworkInfo] = useState<{ local_ip: string; connected_peers: string[] } | null>(null);   
  const [loading, setLoading] = useState(false);   
  const [exportLoading, setExportLoading] = useState(false);   
  const [isCleaningDb, setIsCleaningDb] = useState(false);   
  
  const [toasts, setToasts] = useState<Toast[]>([]);
  const currentYear = new Date().getFullYear();   
  
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {     
    const years = [];     
    for (let i = currentYear; i >= 2020; i--) years.push(i);     
    setAvailableYears(years);          
    
    fetchWithAuth(`${API_URL}/settings`)       
      .then(res => res.json())       
      .then(data => {         
        setChairName(data.committee_chair || "");       
      }).catch(e => console.error(e));     
      
    fetchWithAuth(`${API_URL}/stats/global`)       
      .then(res => res.json())       
      .then(data => {         
        if (data.route_breakdown) {           
          setAvailableRoutes(data.route_breakdown.map((r: any) => r.route));         
        }       
      }).catch(e => console.error(e));   
  }, [currentYear]);   

  useEffect(() => {     
    if (activeTab === "network") {       
      fetchWithAuth(`${API_URL}/system/network`)         
        .then(res => res.json())         
        .then(data => setNetworkInfo(data))         
        .catch(e => console.error(e));     
    }   
  }, [activeTab]);   

  const saveSettings = async () => {     
    setLoading(true);     
    try {         
      await fetchWithAuth(`${API_URL}/settings`, {           
        method: "PUT",           
        headers: { "Content-Type": "application/json" },           
        body: JSON.stringify({ committee_chair: chairName })         
      });         
      showToast("Settings saved successfully.", "success");     
    } catch (e) {         
      showToast("Failed to save settings. Network Error.", "error");     
    }     
    setLoading(false);   
  };   

  const handleMassExport = async () => {     
    setExportLoading(true);     
    try {       
      const res = await fetchWithAuth(`${API_URL}/export/mass?route=${targetToda}&year=${targetYear}&export_status=${exportStatus}`);       
      if (!res.ok) throw new Error("Export failed");       
      const blob = await res.blob();       
      const url = window.URL.createObjectURL(blob);       
      const a = document.createElement("a");       
      a.href = url;       
      a.download = `PASADA_Export_${targetToda}_${targetYear}_${exportStatus}.zip`;       
      a.click();     
    } catch (err) {       
      showToast("No records found for the selected filter.", "error");     
    } finally {       
      setExportLoading(false);     
    }   
  };   

  const handleRefreshDb = async () => {     
    const confirmClean = window.confirm("Are you sure you want to clean up the database? This removes extra year suffixes from SBNs, removes duplicate operator entries, and resets vacant slots automatically.");     
    if (!confirmClean) return;     
    setIsCleaningDb(true);     
    try {       
      const res = await fetchWithAuth(`${API_URL}/admin/refresh-db`, {         
        method: "POST"       
      });       
      if (res.ok) {         
        const result = await res.json();         
        showToast(result.message || "Database cleaned and updated successfully.", "success");       
      } else {         
        const err = await res.json();         
        showToast(err.detail || "Failed to clean database.", "error");       
      }     
    } catch (err) {       
      showToast("Network error while trying to clean database.", "error");     
    } finally {       
      setIsCleaningDb(false);     
    }   
  };   

  const handleUsernameUpdate = async (e: React.FormEvent) => {     
    e.preventDefault();     
    setLoading(true);     
    try {       
      const res = await fetchWithAuth(`${API_URL}/users/username`, {         
        method: "PUT",         
        headers: { "Content-Type": "application/json" },         
        body: JSON.stringify({ new_username: newUsername })       
      });       
      if (res.ok) {         
        showToast("Username changed successfully. Please log in again.", "success");         
        setTimeout(() => {           
          localStorage.clear();           
          window.location.href = "/";         
        }, 2000);       
      } else {         
        const err = await res.json();         
        showToast(err.detail || "Failed to change username.", "error");         
        setLoading(false);       
      }     
    } catch (err) {       
      showToast("Network error. Could not change username.", "error");       
      setLoading(false);     
    }   
  };   

  const handlePasswordUpdate = async (e: React.FormEvent) => {     
    e.preventDefault();     
    if (newPassword.length < 8) {       
      showToast("Password must be at least 8 characters long.", "error");       
      return;     
    }     
    setLoading(true);     
    try {         
      const res = await fetchWithAuth(`${API_URL}/users/password`, {           
        method: "PUT",           
        headers: { "Content-Type": "application/json" },           
        body: JSON.stringify({ new_password: newPassword })         
      });         
      if (res.ok) {           
        showToast("Password changed successfully.", "success");           
        setNewPassword("");         
      } else {           
        const err = await res.json();           
        showToast(err.detail || "Failed to change password.", "error");         
      }     
    } catch(err) {         
      showToast("Network error. Could not change password.", "error");     
    }     
    setLoading(false);   
  };   

  return (     
    <div className="p-6 md:p-8 animate-in fade-in duration-500 w-full max-w-[1600px] min-h-screen">       
      <div className="flex items-center gap-3 mb-8">         
        <SettingsIcon className="w-8 h-8 text-primary" />         
        <div>           
          <h1 className="text-3xl font-black tracking-tight">System Settings</h1>           
          <p className="text-muted-foreground mt-0.5">Manage committee chairman name, backup files, and account security.</p>         
        </div>       
      </div>       
      
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">         
        <div className="flex w-full overflow-x-auto border-b border-border bg-muted/10">           
          {[             
            { id: "general", label: "General Settings", icon: <SettingsIcon size={16} /> },             
            { id: "backup", label: "Backup & Database Cleanup", icon: <Download size={16} /> },             
            { id: "security", label: "Account Security", icon: <Shield size={16} /> },             
            { id: "network", label: "Network Connection", icon: <Server size={16} /> }           
          ].map(tab => (             
            <button               
              key={tab.id}               
              onClick={() => setActiveTab(tab.id)}               
              className={`flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-4 font-bold text-sm transition-all border-b-2 ${                 
                activeTab === tab.id                   
                  ? "bg-card text-blue-600 border-blue-600"                   
                  : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground"               
              }`}             
            >               
              {tab.icon}               
              {tab.label}             
            </button>           
          ))}         
        </div>         
        <div className="p-6 md:p-8">           
          {activeTab === "general" && (             
            <div className="space-y-8 max-w-2xl">               
              <h2 className="text-xl font-black border-b border-border pb-4">General Settings</h2>               
              <div className="space-y-3">                 
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Committee Chairman Name</label>                 
                <input                   
                  type="text"                   
                  value={chairName}                   
                  onChange={(e) => setChairName(e.target.value.toUpperCase())}                   
                  className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold uppercase focus:ring-2 focus:ring-blue-500"                   
                  placeholder="e.g. RODRIGO A. CASTILLO"                 
                />                 
                <p className="text-xs text-muted-foreground font-medium">                   
                  This name will replace the chairman placeholder in printed MTOP documents.                 
                </p>               
              </div>               
              <button onClick={saveSettings} disabled={loading} className="bg-blue-600 text-white font-bold px-8 py-3 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-all shadow-md w-max">                 
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}                 
                Save Settings               
              </button>             
            </div>           
          )}           
          {activeTab === "backup" && (             
            <div className="space-y-8">               
              <div>                 
                <h2 className="text-lg font-bold flex items-center gap-2"><Download className="text-blue-600" size={20} /> Export Backup Files</h2>                 
                <p className="text-sm text-muted-foreground mt-1 font-medium">Download a ZIP file containing Excel lists and Word document templates.</p>                                  
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">                   
                  <div className="space-y-2">                     
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select Route</label>                     
                    <select value={targetToda} onChange={(e) => setTargetToda(e.target.value)} className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">                       
                      <option value="ALL">ALL ROUTES</option>                       
                      {availableRoutes.map(toda => (                         
                        <option key={toda} value={toda}>{toda}</option>                       
                      ))}                     
                    </select>                   
                  </div>                   
                  <div className="space-y-2">                     
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select Status</label>                     
                    <select value={exportStatus} onChange={(e) => setExportStatus(e.target.value)} className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">                       
                      <option value="ALL">ALL RECORDS</option>                       
                      <option value="ACTIVE">ACTIVE ONLY</option>                       
                      <option value="FLAGGED">1-YEAR NON-RENEWAL</option>                       
                      <option value="REVOKED">2+ YEARS NON-RENEWAL</option>                       
                      <option value="VACANT">VACANT SLOTS</option>                     
                    </select>                   
                  </div>                   
                  <div className="space-y-2">                     
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select Year</label>                     
                    <select value={targetYear} onChange={(e) => setTargetYear(e.target.value)} className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">                       
                      <option value="ALL">ALL YEARS</option>                       
                      {availableYears.map(year => (                         
                        <option key={year} value={year}>{year}</option>                       
                      ))}                     
                    </select>                   
                  </div>                 
                </div>                 
                <button onClick={handleMassExport} disabled={exportLoading} className="w-full mt-6 bg-blue-600 text-white font-bold py-3.5 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md">                   
                  {exportLoading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}                   
                  {exportLoading ? "Creating Backup File..." : "Download Backup File"}                 
                </button>               
              </div>               
              <hr className="border-border" />               
              <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-xl space-y-4">                 
                <div className="flex items-start gap-3">                   
                  <RefreshCw className="text-amber-600 mt-1 shrink-0" size={24} />                   
                  <div>                     
                    <h3 className="text-md font-bold text-amber-900 dark:text-amber-400">Clean Up Database</h3>                     
                    <p className="text-xs text-amber-800/80 dark:text-amber-300 font-medium mt-1 leading-relaxed">                       
                      This tool cleans up the database. It removes year numbers from SBNs, removes duplicate operators, and clears empty slots automatically.                     
                    </p>                   
                  </div>                 
                </div>                 
                <button                   
                  onClick={handleRefreshDb}                   
                  disabled={isCleaningDb}                   
                  className="w-full md:w-auto bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 px-6 rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm text-sm"                 
                >                   
                  {isCleaningDb ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}                   
                  {isCleaningDb ? "Cleaning Database..." : "Clean Up Database Now"}                 
                </button>               
              </div>             
            </div>           
          )}           
          {activeTab === "security" && (             
            <div className="space-y-6">               
              <div>                 
                <h2 className="text-lg font-bold flex items-center gap-2"><Shield className="text-blue-600" size={20} /> Account Security</h2>                 
                <p className="text-sm text-muted-foreground mt-1 font-medium">Change your login username and password.</p>               
              </div>                              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">                 
                <form onSubmit={handleUsernameUpdate} className="space-y-4">                   
                  <div className="space-y-1.5">                     
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">New Username</label>                     
                    <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value.toUpperCase())} placeholder="ENTER NEW USERNAME" className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" required />                   
                  </div>                   
                  <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold px-6 py-3 rounded-lg shadow-md hover:bg-slate-800 transition-all flex items-center justify-center gap-2">                     
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}                     
                    Save Username                   
                  </button>                 
                </form>                 
                <form onSubmit={handlePasswordUpdate} className="space-y-4">                   
                  <div className="space-y-1.5">                     
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">New Password</label>                     
                    <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="ENTER NEW PASSWORD" className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" required />                   
                  </div>                   
                  <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white font-bold px-6 py-3 rounded-lg shadow-md hover:bg-slate-800 transition-all flex items-center justify-center gap-2">                     
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}                     
                    Save Password                   
                  </button>                 
                </form>               
              </div>             
            </div>           
          )}           
          {activeTab === "network" && (             
            <div className="space-y-6">               
              <div>                 
                <h2 className="text-lg font-bold flex items-center gap-2"><Server className="text-blue-600" size={20} /> Network Connection</h2>                 
                <p className="text-sm text-muted-foreground mt-1 font-medium">Network details for sharing data with other office computers.</p>               
              </div>                              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">                 
                <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner col-span-1">                   
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Computer IP Address</p>                   
                  <p className="text-3xl font-black text-slate-800 dark:text-slate-200 font-mono tracking-wider">                     
                    {networkInfo?.local_ip || "CHECKING..."}                   
                  </p>                   
                  <div className="flex items-center gap-2 mt-4 text-xs font-bold text-emerald-600 bg-emerald-500/10 w-max px-3 py-1.5 rounded-full border border-emerald-500/20">                     
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>                     
                    Active on Port 43888                   
                  </div>                 
                </div>                                  
                <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner col-span-1">                   
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Connected Computers</p>                   
                  <p className="text-3xl font-black text-blue-600 font-mono tracking-wider">                     
                    {networkInfo?.connected_peers.length || 0}                   
                  </p>                   
                  <div className="mt-4 space-y-2">                     
                    {networkInfo?.connected_peers.length === 0 ? (                       
                      <p className="text-xs font-bold text-muted-foreground">No other computers connected.</p>                     
                    ) : (                       
                      networkInfo?.connected_peers.map(peer => (                         
                        <div key={peer} className="text-xs font-bold text-slate-700 bg-white border border-border px-3 py-2 rounded-md font-mono shadow-sm">                           
                          {peer}                         
                        </div>                       
                      ))                     
                    )}                   
                  </div>                 
                </div>                 
                <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner col-span-1 flex flex-col justify-center">                   
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 text-center">LAN Sync Status</p>                   
                  <div className="w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold py-4 rounded-lg shadow-sm flex flex-col items-center justify-center gap-1 text-center">                     
                    <div className="flex items-center gap-2">                         
                      <RefreshCw className="h-5 w-5 animate-spin" />                         
                      <span>Sync is Automatic</span>                     
                    </div>                     
                    <p className="text-[10px] font-medium opacity-80 mt-1">Background synchronization active</p>                   
                  </div>                 
                </div>               
              </div>             
            </div>           
          )}         
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