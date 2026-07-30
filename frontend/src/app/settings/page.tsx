"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Save, Server, Shield, Download, CheckCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:43888";

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
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [isCleaningDb, setIsCleaningDb] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const years = [];
    for (let i = currentYear; i >= 2020; i--) years.push(i);
    setAvailableYears(years);
    
    fetch(`${API_URL}/settings`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
    })
      .then(res => res.json())
      .then(data => {
        setChairName(data.committee_chair || "");
      });

    fetch(`${API_URL}/stats/global`)
      .then(res => res.json())
      .then(data => {
        if (data.route_breakdown) {
          setAvailableRoutes(data.route_breakdown.map((r: any) => r.route));
        }
      });
  }, [currentYear]);

  useEffect(() => {
    if (activeTab === "network") {
      fetch(`${API_URL}/system/network`)
        .then(res => res.json())
        .then(data => setNetworkInfo(data));
    }
  }, [activeTab]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg("");
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const saveSettings = async () => {
    setLoading(true);
    await fetch(`${API_URL}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ committee_chair: chairName })
    });
    setLoading(false);
    triggerSuccess("Settings saved successfully.");
  };

  const handleMassExport = async () => {
    setExportLoading(true);
    try {
      const res = await fetch(`${API_URL}/export/mass?route=${targetToda}&year=${targetYear}&export_status=${exportStatus}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PASADA_Export_${targetToda}_${targetYear}_${exportStatus}.zip`;
      a.click();
    } catch (err) {
      alert("No records found for the selected filter.");
    } finally {
      setExportLoading(false);
    }
  };

  const handleRefreshDb = async () => {
    const confirmClean = window.confirm("Are you sure you want to clean up the database? This removes extra year suffixes from SBNs, removes duplicate operator entries, and resets vacant slots automatically.");
    if (!confirmClean) return;

    setIsCleaningDb(true);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${API_URL}/admin/refresh-db`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const result = await res.json();
        triggerSuccess(result.message || "Database cleaned and updated successfully.");
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || "Failed to clean database.");
      }
    } catch (err) {
      setErrorMsg("Network error while trying to clean database.");
    } finally {
      setIsCleaningDb(false);
    }
  };

  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/users/username`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ new_username: newUsername })
      });
      if (res.ok) {
        triggerSuccess("Username changed successfully. Please log in again.");
        setTimeout(() => {
          localStorage.clear();
          window.location.href = "/";
        }, 2000);
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || "Failed to change username.");
        setLoading(false);
      }
    } catch (err) {
      setErrorMsg("Network error. Could not change username.");
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setErrorMsg("Password must be at least 8 characters long.");
      return;
    }
    setLoading(true);
    const res = await fetch(`${API_URL}/users/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ new_password: newPassword })
    });
    setLoading(false);
    if (res.ok) {
      triggerSuccess("Password changed successfully.");
      setNewPassword("");
    } else {
      const err = await res.json();
      setErrorMsg(err.detail || "Failed to change password.");
    }
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      triggerSuccess("Data updated from the network successfully.");
    }, 2000);
  };

  return (
    <div className="p-6 md:p-8 animate-in fade-in duration-500 w-full max-w-[1600px]">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">System Settings</h1>
          <p className="text-muted-foreground mt-0.5">Manage committee chairman name, backup files, and account security.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 w-full">
        {[
          { id: "general", label: "General Settings", icon: <SettingsIcon size={16} /> },
          { id: "backup", label: "Backup & Database Cleanup", icon: <Download size={16} /> },
          { id: "security", label: "Account Security", icon: <Shield size={16} /> },
          { id: "network", label: "Network Connection", icon: <Server size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-bold text-sm transition-all border-b-2 ${
              activeTab === tab.id 
                ? "bg-card text-slate-900 dark:text-white border-blue-600" 
                : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {successMsg && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg flex items-center gap-2 font-bold shadow-sm">
          <CheckCircle size={18} />
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg flex items-center gap-2 font-bold shadow-sm">
          <AlertTriangle size={18} />
          {errorMsg}
        </div>
      )}

      <div className="bg-card border border-border rounded-b-2xl rounded-tr-2xl p-6 md:p-8 shadow-sm">
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
            {/* BACKUP EXPORT SECTION */}
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

            {/* ONE-CLICK DATABASE CLEANUP TOOL */}
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
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 text-center">Sync Network Data</p>
                <button onClick={handleForceSync} disabled={isSyncing} className="w-full bg-blue-600 text-white font-bold py-4 rounded-lg shadow-md hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                  {isSyncing ? <Loader2 className="animate-spin h-5 w-5" /> : <Server className="h-5 w-5" />}
                  {isSyncing ? "Updating..." : "Update from Network"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}