"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Save, Server, Shield, Download, CheckCircle, Loader2, AlertTriangle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:43888";

export default function Settings() {
  const [activeTab, setActiveTab] = useState("general");
  
  // General Tab
  const [chairName, setChairName] = useState("");
  const [enableEsign, setEnableEsign] = useState(false);
  
  // Backup Tab
  const [targetToda, setTargetToda] = useState("ALL");
  const [targetYear, setTargetYear] = useState("ALL");
  const [exportStatus, setExportStatus] = useState("ALL");
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  
  // Security Tab
  const [newPassword, setNewPassword] = useState("");
  
  // Network Tab
  const [networkInfo, setNetworkInfo] = useState<{ local_ip: string; connected_peers: string[] } | null>(null);

  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
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
        setEnableEsign(data.enable_esignature || false);
      });

    fetch(`${API_URL}/stats/global`)
      .then(res => res.json())
      .then(data => {
        if (data.route_breakdown) {
          setAvailableRoutes(data.route_breakdown.map((r: any) => r.route));
        }
      });
  }, []);

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
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  const saveSettings = async () => {
    setLoading(true);
    await fetch(`${API_URL}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ committee_chair: chairName, enable_esignature: enableEsign })
    });
    setLoading(false);
    triggerSuccess("Configuration saved successfully.");
  };

  const uploadSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const formData = new FormData();
    formData.append("file", e.target.files[0]);
    await fetch(`${API_URL}/settings/signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: formData
    });
    triggerSuccess("E-Signature uploaded successfully.");
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
      alert("No records found for the selected parameters.");
    } finally {
      setExportLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setErrorMsg("Passcode must be at least 8 characters.");
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
      triggerSuccess("Account passcode updated securely.");
      setNewPassword("");
    } else {
      const err = await res.json();
      setErrorMsg(err.detail || "Failed to update passcode.");
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl animate-in fade-in duration-500 mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-black tracking-tight">System Configuration</h1>
          <p className="text-muted-foreground mt-0.5">Manage global variables, security, and mass data exports.</p>
        </div>
      </div>

      {/* Tabs perfectly aligned to the left edge of the white card */}
      <div className="flex flex-wrap gap-2 mb-4 w-full">
        {[
          { id: "general", label: "General Config", icon: <SettingsIcon size={16} /> },
          { id: "backup", label: "Data Backup", icon: <Download size={16} /> },
          { id: "security", label: "Account Security", icon: <Shield size={16} /> },
          { id: "network", label: "Network Configuration", icon: <Server size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-bold text-sm transition-all border-b-2 ${activeTab === tab.id ? "bg-card text-slate-900 dark:text-white border-blue-600" : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground"}`}
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
          <div className="space-y-6">
            <h2 className="text-lg font-bold border-b border-border pb-2 mb-4">MTOP Document Settings</h2>
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Committee Chairman Name</label>
              <input type="text" value={chairName} onChange={(e) => setChairName(e.target.value.toUpperCase())} className="w-full bg-input/50 border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 font-bold uppercase" />
            </div>
            <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/30">
              <div>
                <h3 className="font-bold text-sm">Enable E-Signatures</h3>
                <p className="text-xs text-muted-foreground">Automatically inject the uploaded transparent signature into printed documents.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={enableEsign} onChange={(e) => setEnableEsign(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-muted border border-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Upload Transparent Signature (.png)</label>
              <input type="file" accept="image/png" onChange={uploadSignature} className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer" />
            </div>
            <button onClick={saveSettings} disabled={loading} className="mt-4 bg-blue-600 text-white font-bold px-6 py-2.5 rounded-lg flex items-center gap-2 hover:bg-blue-700 transition-all shadow-md">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save Configuration
            </button>
          </div>
        )}

        {activeTab === "backup" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2"><Download className="text-blue-600" size={20} /> Mass Document Export</h2>
              <p className="text-sm text-muted-foreground mt-1 font-medium">Generates a .ZIP containing CSV registries and exact .docx templates for external filing.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Route (TODA)</label>
                <select value={targetToda} onChange={(e) => setTargetToda(e.target.value)} className="w-full bg-input/50 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer">
                  <option value="ALL">ALL UPLOADED ROUTES</option>
                  {availableRoutes.map(toda => (
                    <option key={toda} value={toda}>{toda}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Status</label>
                <select value={exportStatus} onChange={(e) => setExportStatus(e.target.value)} className="w-full bg-input/50 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer">
                  <option value="ALL">ALL RECORDS</option>
                  <option value="ACTIVE">ACTIVE & COMPLIANT</option>
                  <option value="FLAGGED">FLAGGED (PENDING)</option>
                  <option value="REVOKED">REVOKED/VACANT</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Year</label>
                <select value={targetYear} onChange={(e) => setTargetYear(e.target.value)} className="w-full bg-input/50 border border-border rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer">
                  <option value="ALL">ALL RECORDED YEARS</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
            </div>
            <button onClick={handleMassExport} disabled={exportLoading} className="w-full mt-6 bg-blue-600 text-white font-bold py-3.5 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md">
              {exportLoading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {exportLoading ? "Compiling Mass Backup..." : "Execute Full System Export"}
            </button>
          </div>
        )}

        {activeTab === "security" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2"><Shield className="text-blue-600" size={20} /> Account Security</h2>
              <p className="text-sm text-muted-foreground mt-1 font-medium">Update your administrative passcode.</p>
            </div>
            <form onSubmit={handlePasswordUpdate} className="space-y-4 max-w-md mt-6">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">New Passcode</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full bg-input/50 border border-border rounded-lg px-4 py-3 text-sm font-bold" required />
              </div>
              <button type="submit" disabled={loading} className="w-full mt-2 bg-slate-900 text-white font-bold px-6 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
                Update Passcode
              </button>
            </form>
          </div>
        )}

        {activeTab === "network" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2"><Server className="text-blue-600" size={20} /> Network Connection Status</h2>
              <p className="text-sm text-muted-foreground mt-1 font-medium">System network details for local database synchronization.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">This Workstation IP</p>
                <p className="text-3xl font-black text-slate-800 dark:text-slate-200 font-mono tracking-wider">
                  {networkInfo?.local_ip || "SCANNING..."}
                </p>
                <div className="flex items-center gap-2 mt-4 text-xs font-bold text-emerald-600 bg-emerald-500/10 w-max px-3 py-1.5 rounded-full border border-emerald-500/20">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  Active on Port 8000
                </div>
              </div>

              <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Connected Workstations</p>
                <p className="text-3xl font-black text-blue-600 font-mono tracking-wider">
                  {networkInfo?.connected_peers.length || 0}
                </p>
                <div className="mt-4 space-y-2">
                  {networkInfo?.connected_peers.length === 0 ? (
                    <p className="text-xs font-bold text-muted-foreground">No other workstations detected on the network.</p>
                  ) : (
                    networkInfo?.connected_peers.map(peer => (
                      <div key={peer} className="text-xs font-bold text-slate-700 bg-white border border-border px-3 py-2 rounded-md font-mono shadow-sm">
                        {peer}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}