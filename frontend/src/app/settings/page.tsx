"use client";

import { useEffect, useState, useCallback } from "react";
import { 
  Settings as SettingsIcon, 
  Save, 
  Server, 
  Shield, 
  Download, 
  CheckCircle, 
  Loader2, 
  AlertTriangle, 
  RefreshCw, 
  X, 
  CheckCircle2, 
  XCircle, 
  Database, 
  Lock, 
  KeyRound, 
  User, 
  FileText, 
  Sparkles,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { API_URL, fetchWithAuth } from "@/lib/api";

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState("general");
  const [chairName, setChairName] = useState("");
  
  // Client-side UI Preferences
  const [showSavePreview, setShowSavePreview] = useState(true);
  const [autoChangeMotorDate, setAutoChangeMotorDate] = useState(true);
  
  const [hasPin, setHasPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  
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
    
    // Load Client-side UI preferences
    const prefPreview = localStorage.getItem("pasada_show_save_preview");
    if (prefPreview !== null) setShowSavePreview(prefPreview === "true");

    const prefAutoMotor = localStorage.getItem("pasada_auto_change_motor_date");
    if (prefAutoMotor !== null) setAutoChangeMotorDate(prefAutoMotor === "true");

    if (localStorage.getItem("pasada_pin")) {
      setHasPin(true);
    }
    
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

  const handleToggleSavePreview = (val: boolean) => {
    setShowSavePreview(val);
    localStorage.setItem("pasada_show_save_preview", String(val));
    showToast(`Save preview ${val ? "enabled" : "disabled"}.`, "success");
  };

  const handleToggleAutoMotorDate = (val: boolean) => {
    setAutoChangeMotorDate(val);
    localStorage.setItem("pasada_auto_change_motor_date", String(val));
    showToast(`Auto-date for Change Motor ${val ? "enabled" : "disabled"}.`, "success");
  };

  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 4) {
      showToast("PIN must be at least 4 characters.", "error");
      return;
    }
    try {
      const msgBuffer = new TextEncoder().encode(newPin);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem("pasada_pin", hashHex);
      setHasPin(true);
      setNewPin("");
      showToast("PIN saved successfully. App will lock upon relaunch.", "success");
    } catch (err) {
      showToast("Failed to secure PIN on this device.", "error");
    }
  };

  const handleRemovePin = () => {
    localStorage.removeItem("pasada_pin");
    sessionStorage.removeItem("pasada_pin_unlocked");
    setHasPin(false);
    showToast("Quick PIN unlock removed.", "success");
  };

  const saveSettings = async () => {
    setLoading(true);
    try {
      await fetchWithAuth(`${API_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ committee_chair: chairName })
      });
      showToast("Signatory settings saved successfully.", "success");
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
      a.style.display = 'none';
      a.href = url;
      a.download = `PASADA_Export_${targetToda}_${targetYear}_${exportStatus}.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 1000);
    } catch (err) {
      showToast("No records found for the selected filter.", "error");
    } finally {
      setExportLoading(false);
    }
  };

  const handleDbBackup = async () => {
    setExportLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/backup/database`);
      if (!res.ok) throw new Error("DB Backup failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = 'none';
      a.href = url;
      
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      a.download = `PASADA_BACKUP_${dateStr}.db`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 1000);
      showToast("Raw database backup downloaded successfully.", "success");
    } catch (err) {
      showToast("Failed to download database backup.", "error");
    } finally {
      setExportLoading(false);
    }
  };

  const handleRefreshDb = async () => {
    const confirmClean = window.confirm("Are you sure you want to clean up the database? This standardizes SBN formats, removes duplicate operators, and clears empty slots automatically.");
    if (!confirmClean) return;

    setIsCleaningDb(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/refresh-db`, {
        method: "POST"
      });
      if (res.ok) {
        const result = await res.json();
        showToast(result.message || "Database cleaned and refreshed successfully.", "success");
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
          sessionStorage.clear();
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
    } catch (err) {
      showToast("Network error. Could not change password.", "error");
    }
    setLoading(false);
  };

  return (
    <div className="p-6 md:p-8 animate-in fade-in duration-500 w-full max-w-[1600px] min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-blue-600/10 text-blue-600 rounded-xl border border-blue-600/20">
          <SettingsIcon className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-3xl font-black tracking-tight">System Settings</h1>
          <p className="text-muted-foreground mt-0.5 text-sm font-medium">Manage committee chairman name, database backups, security, and LAN connectivity.</p>
        </div>
      </div>
      
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        {/* Navigation Tabs */}
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
              className={`flex-1 min-w-[220px] flex items-center justify-center gap-2 px-6 py-4 font-bold text-sm transition-all border-b-2 ${
                activeTab === tab.id
                  ? "bg-card text-blue-600 border-blue-600 shadow-sm"
                  : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 md:p-8">
          {/* ========================================================================= */}
          {/* TAB 1: GENERAL SETTINGS (2-Column Symmetrical Layout)                      */}
          {/* ========================================================================= */}
          {activeTab === "general" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-black tracking-tight">General System Configuration</h2>
                <p className="text-sm text-muted-foreground font-medium mt-1">Configure global print signatory details and record creation behavior.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Card 1: Committee Chairman Signatory */}
                <div className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2.5 text-blue-600">
                      <FileText size={20} />
                      <h3 className="text-base font-bold text-foreground">MTOP Official Signatory</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      This name replaces the committee chairman placeholder across all printed MTOP certificates, official Word documents, and TODA summary PDFs.
                    </p>
                    
                    <div className="space-y-1.5 pt-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Committee Chairman Name</label>
                      <input
                        type="text"
                        value={chairName}
                        onChange={(e) => setChairName(e.target.value.toUpperCase())}
                        className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold uppercase focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g. HON. RODRIGO A. CASTILLO"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={saveSettings} 
                    disabled={loading} 
                    className="w-full bg-blue-600 text-white font-bold h-12 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md"
                  >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Signatory Name
                  </button>
                </div>

                {/* Card 2: Record Save & Workflow Preference */}
                <div className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2.5 text-blue-600">
                      <Sparkles size={20} />
                      <h3 className="text-base font-bold text-foreground">Operator Entry Workflow</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      Control how the system behaves immediately following the creation or renewal of an operator record.
                    </p>

                    <div className="pt-2 space-y-3">
                      <div 
                        onClick={() => handleToggleSavePreview(!showSavePreview)}
                        className="flex items-start gap-3 p-4 bg-background border border-border rounded-xl cursor-pointer hover:border-blue-500/50 transition-all shadow-sm"
                      >
                        <input
                          type="checkbox"
                          checked={showSavePreview}
                          onChange={(e) => handleToggleSavePreview(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5 cursor-pointer"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-foreground">Show certificate preview automatically after saving</p>
                          <p className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">
                            When checked, saving an operator immediately displays the full preview modal. When unchecked, a silent toast appears so clerks can register hundreds of records uninterrupted.
                          </p>
                        </div>
                      </div>

                      <div 
                        onClick={() => handleToggleAutoMotorDate(!autoChangeMotorDate)}
                        className="flex items-start gap-3 p-4 bg-background border border-border rounded-xl cursor-pointer hover:border-blue-500/50 transition-all shadow-sm"
                      >
                        <input
                          type="checkbox"
                          checked={autoChangeMotorDate}
                          onChange={(e) => handleToggleAutoMotorDate(e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5 cursor-pointer"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-foreground">Auto-set Date Issued on Change Motor</p>
                          <p className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">
                            When ON, changing motor/chassis/make sets the Date Issued to today automatically. When OFF, the date is kept and you set it manually with the Set Today button. Renewals always auto-set the date.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: BACKUP & DATABASE CLEANUP (Clean Top + Split Bottom Grid)          */}
          {/* ========================================================================= */}
          {activeTab === "backup" && (
            <div className="space-y-8">
              {/* Top: Mass Export ZIP */}
              <div className="bg-muted/15 border border-border p-6 rounded-2xl space-y-6">
                <div>
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Download className="text-blue-600" size={20} /> Export Filtered Backup Files
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 font-medium">Download a consolidated ZIP archive containing Excel masterlists and generated Word document certificates.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Select Route</label>
                    <select value={targetToda} onChange={(e) => setTargetToda(e.target.value)} className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
                      <option value="ALL">ALL ROUTES</option>
                      {availableRoutes.map(toda => (
                        <option key={toda} value={toda}>{toda}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Select Status</label>
                    <select value={exportStatus} onChange={(e) => setExportStatus(e.target.value)} className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
                      <option value="ALL">ALL RECORDS</option>
                      <option value="ACTIVE">ACTIVE ONLY</option>
                      <option value="FLAGGED">1-YEAR NON-RENEWAL</option>
                      <option value="REVOKED">2+ YEARS NON-RENEWAL</option>
                      <option value="VACANT">VACANT SLOTS</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Select Year</label>
                    <select value={targetYear} onChange={(e) => setTargetYear(e.target.value)} className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
                      <option value="ALL">ALL YEARS</option>
                      {availableYears.map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button onClick={handleMassExport} disabled={exportLoading} className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md">
                  {exportLoading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {exportLoading ? "Creating Backup File..." : "Download Backup ZIP Package"}
                </button>
              </div>

              {/* Bottom: Raw DB Snapshot & Cleanup Split into 2 Balanced Columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                {/* Left: Raw SQLite DB */}
                <div className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                      <Database className="text-blue-600 shrink-0" size={20} />
                      <h3 className="text-base font-bold">Raw Database Backup (.db)</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      Download a direct byte-for-byte snapshot of the live SQLite registry. Keep this safe before executing migrations, batch deletes, or testing. You can restore this file anytime from the Import page.
                    </p>
                  </div>

                  <button 
                    onClick={handleDbBackup} 
                    disabled={exportLoading} 
                    className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 hover:bg-slate-800 dark:hover:bg-slate-200 transition-all shadow-md"
                  >
                    {exportLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
                    Download Raw Database (.db)
                  </button>
                </div>

                {/* Right: Database Self-Healing & Cleanup */}
                <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-900 dark:text-amber-400">
                      <RefreshCw className="text-amber-600 shrink-0" size={20} />
                      <h3 className="text-base font-bold">Clean Up Database</h3>
                    </div>
                    <p className="text-xs text-amber-800/80 dark:text-amber-300 font-medium leading-relaxed">
                      Scans the registry to strip unnecessary year numbers from SBN identifiers, eliminates redundant operator duplicates, standardizes route strings, and normalizes vacant franchise slots.
                    </p>
                  </div>

                  <button
                    onClick={handleRefreshDb}
                    disabled={isCleaningDb}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3.5 px-6 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md text-sm"
                  >
                    {isCleaningDb ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    {isCleaningDb ? "Cleaning Database..." : "Clean Up Database Now"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: ACCOUNT SECURITY & REDESIGNED PIN UI                               */}
          {/* ========================================================================= */}
          {activeTab === "security" && (
            <div className="space-y-8">
              {/* Top: Credentials Section (2 Balanced Cards) */}
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Shield className="text-blue-600" size={20} /> Account Credentials
                </h2>
                <p className="text-xs text-muted-foreground mt-1 font-medium">Update your login username and account access password.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                {/* Username Card */}
                <div className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <form onSubmit={handleUsernameUpdate} className="space-y-4">
                    <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                      <User size={16} className="text-blue-600" /> Change Username
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">New Username</label>
                      <input 
                        type="text" 
                        value={newUsername} 
                        onChange={(e) => setNewUsername(e.target.value.toUpperCase())} 
                        placeholder="ENTER NEW USERNAME" 
                        className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500" 
                        required 
                      />
                    </div>
                    <button 
                      type="submit" 
                      disabled={loading} 
                      className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3.5 rounded-lg shadow-md hover:bg-slate-800 dark:hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      Update Username
                    </button>
                  </form>
                </div>

                {/* Password Card */}
                <div className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <form onSubmit={handlePasswordUpdate} className="space-y-4">
                    <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                      <KeyRound size={16} className="text-blue-600" /> Change Password
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">New Password (8+ Chars)</label>
                      <input 
                        type="password" 
                        value={newPassword} 
                        onChange={(e) => setNewPassword(e.target.value)} 
                        placeholder="ENTER NEW PASSWORD" 
                        className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500" 
                        required 
                      />
                    </div>
                    <button 
                      type="submit" 
                      disabled={loading} 
                      className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3.5 rounded-lg shadow-md hover:bg-slate-800 dark:hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      Update Password
                    </button>
                  </form>
                </div>
              </div>

              {/* Bottom: Dedicated Quick PIN Panel */}
              <div className="bg-muted/15 border border-border p-6 md:p-8 rounded-2xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h3 className="text-base font-bold flex items-center gap-2">
                      <Lock className="text-blue-600" size={18} /> Quick PIN Unlock
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium mt-0.5">
                      Set a short numeric PIN to quickly unlock PASADA whenever the application is reopened.
                    </p>
                  </div>

                  {/* Status Indicator Badge */}
                  <div className="w-max">
                    {hasPin ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-full text-xs font-black">
                        <CheckCircle2 size={13} />
                        PIN Protection Active
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-muted/60 text-muted-foreground border border-border rounded-full text-xs font-bold">
                        <XCircle size={13} />
                        No PIN Configured
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  {/* Left Column: Set or Update Form */}
                  <form onSubmit={handleSetPin} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        {hasPin ? "Enter New PIN (Overwrites current)" : "Create Security PIN (4+ Digits)"}
                      </label>
                      <input 
                        type="password" 
                        value={newPin} 
                        onChange={(e) => setNewPin(e.target.value)} 
                        placeholder="• • • •" 
                        className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-3 text-center text-lg font-mono font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500" 
                        required 
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="w-full bg-blue-600 text-white font-bold h-11 rounded-lg shadow-md hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                    >
                      <ShieldCheck size={16} />
                      {hasPin ? "Update PIN" : "Enable PIN Protection"}
                    </button>
                  </form>

                  {/* Right Column: Information & Removal */}
                  <div className="h-full bg-background border border-border rounded-xl p-5 flex flex-col justify-between space-y-4 shadow-sm">
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-foreground">How PIN Unlock works:</p>
                      <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                        Your session stays authenticated via your primary token. Closing and reopening PASADA locks the interface behind your PIN instead of prompting you for full credentials every time.
                      </p>
                    </div>

                    {hasPin ? (
                      <button 
                        onClick={handleRemovePin} 
                        type="button"
                        className="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-950/30 dark:border-red-900/50 dark:hover:bg-red-900/40 font-bold h-11 rounded-lg transition-all flex items-center justify-center gap-2 text-xs"
                      >
                        <Trash2 size={15} />
                        Remove Configured PIN
                      </button>
                    ) : (
                      <div className="text-[11px] text-muted-foreground font-semibold italic">
                        No PIN is currently assigned to this installation.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: NETWORK CONNECTION (Clean Grid)                                    */}
          {/* ========================================================================= */}
          {activeTab === "network" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Server className="text-blue-600" size={20} /> Network Connection
                </h2>
                <p className="text-sm text-muted-foreground mt-1 font-medium">Local Area Network (LAN) peer details for multi-workstation synchronizations.</p>
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
                    {networkInfo?.connected_peers?.length ?? 0}
                  </p>
                  <div className="mt-4 space-y-2">
                    {(networkInfo?.connected_peers?.length ?? 0) === 0 ? (
                      <p className="text-xs font-bold text-muted-foreground">No other computers connected.</p>
                    ) : (
                      (networkInfo?.connected_peers ?? []).map(peer => (
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

      {/* Toast Notification Container */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div 
            key={toast.id} 
            className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-bold animate-in slide-in-from-right-8 fade-in duration-300 ${
              toast.type === 'success' 
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800' 
                : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="ml-4 opacity-50 hover:opacity-100 transition-opacity shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}