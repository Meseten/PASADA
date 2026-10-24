"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  ShieldQuestion,
  User, 
  FileText, 
  Sparkles,
  ShieldCheck,
  Trash2,
  ArrowUpCircle
} from "lucide-react";
// OfficeAccounts lives in the Admin Console now — having it in Settings too
// was a duplicate surface for the same data.
import { API_URL, fetchWithAuth, resolveAutoChangeMotorDate } from "@/lib/api";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import UpdateCard from "./UpdateCard";
import PairingPanel from "@/components/sync/PairingPanel";

// Office-friendly security questions offered as suggestions. Each one stays
// true for years and is easy for the person who set it to remember. The
// questions can also be written from scratch with the "Write my own" choice.
const RECOVERY_QUESTION_OPTIONS = [
  "What is the name of your first pet?",
  "What city or municipality were you born in?",
  "What was the name of your first school?",
  "What is your mother's maiden name?",
  "What was your favorite food as a child?",
  "Who is your closest childhood friend?",
  "What is the name of the street you grew up on?",
];
const CUSTOM_QUESTION = "__write_my_own__";

interface RecoveryConfig {
  configured: boolean;
  q1: string;
  q2: string;
  q3: string;
}

// Must match the version in src-tauri/tauri.conf.json; the updater compares
// against it to decide whether a new release exists.
const APP_VERSION = "0.82.7";  // stamped by .github/workflows/release.yml on every push

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
  const [autoChangeMotorDate, setAutoChangeMotorDate] = useState(false);
  
  const [hasPin, setHasPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  
  const [targetToda, setTargetToda] = useState("ALL");
  const [targetYear, setTargetYear] = useState("ALL");
  const [exportStatus, setExportStatus] = useState("ALL");
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [recovery, setRecovery] = useState<RecoveryConfig>({ configured: false, q1: "", q2: "", q3: "" });
  const [recoveryForm, setRecoveryForm] = useState({ q1: RECOVERY_QUESTION_OPTIONS[0], q2: RECOVERY_QUESTION_OPTIONS[1], q3: RECOVERY_QUESTION_OPTIONS[2], a1: "", a2: "", a3: "" });
  // Per-question flag: true when the user chose to write their own question
  // instead of picking a suggested one. Existing questions that are not in
  // the suggestion list also show as custom on load.
  const [customSlots, setCustomSlots] = useState({ 1: false, 2: false, 3: false });
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [networkInfo, setNetworkInfo] = useState<{ local_ip: string; connected_peers: string[]; peer_names?: Record<string, string>; computer_name?: string; last_sync_check?: string | null; peer_status?: Record<string, { name?: string; last_seen?: string | null; misses?: number; registered?: boolean }> } | null>(null);
  // LIVE CONNECTION CHECK (Connections card): one real pull per visible peer,
  // with the exact failure reason per machine — timeout, refused, wrong
  // cluster secret — so the office diagnoses a stuck laptop in one click.
  type DiagPeerResult = { peer: string; name?: string | null; last_seen?: string | null; ok: boolean; reason?: string | null; detail?: string; counts?: { records: number; users: number } | null };
  const [diagResults, setDiagResults] = useState<DiagPeerResult[] | null>(null);
  const [diagCheckedAt, setDiagCheckedAt] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  // WHY-NOTHING-IS-SYNCING snapshot (/api/sync/diagnostics): the read-only
  // engine state that names the reason a silent card is silent — pairing
  // crypto missing, auto-pair switched off, zero peers, key fingerprint,
  // and the recent auto-pair events — instead of a green "ON" over nothing.
  type SyncDiag = {
    crypto_ok: boolean;
    pairing_enabled: boolean;
    secret_fingerprint: string;
    peers: string[];
    auto_pair_events: string[];
    sync_port: number;
    api_port: number;
    local_ip: string;
    all_local_ips: string[];
  };
  const [syncDiag, setSyncDiag] = useState<SyncDiag | null>(null);
  // CLUSTER KEY TOOLS: fingerprint of the key this computer holds, plus the
  // rotate/import flow (rotate shows the key text ONCE for hand-delivery;
  // import adopts the exact text delivered from the owning computer).
  const [clusterFingerprint, setClusterFingerprint] = useState<string | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyImportDraft, setKeyImportDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState<"rotate" | "import" | null>(null);

  // The Manual key recovery dialog still lives here (its network state is
  // wired into this page); the trigger button is in the ADMIN CONSOLE and
  // navigates here with ?tab=network&keyrecovery=1, which opens the dialog.
  // (An earlier design fired a window event instead — but no listener is
  // mounted while the Admin page is open, so the click did nothing.)
  useEffect(() => {
    const open = () => { setRotatedKey(null); setKeyDialogOpen(true); };
    window.addEventListener("pasada:open-key-recovery", open);
    return () => window.removeEventListener("pasada:open-key-recovery", open);
  }, []);

  // ?tab=network&keyrecovery=1: the Admin Console's Manual key recovery
  // button lands here. Non-admins must not open it (the endpoints are
  // admin-only anyway; the flag is cleaned from the URL right after).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("keyrecovery")) return;
    try { history.replaceState(null, "", window.location.pathname); } catch { /* private mode */ }
    if ((localStorage.getItem("pasada_role") || "Clerk") !== "Admin") return;
    if (params.get("tab")) setActiveTab(params.get("tab") as string);
    setRotatedKey(null);
    setKeyDialogOpen(true);
  }, []);

  useEffect(() => {
    // role/isAdmin are declared further down; read the same source directly
    // to keep this effect above their declaration line.
    if (activeTab !== "network") return;
    if ((localStorage.getItem("pasada_role") || "Clerk") !== "Admin") return;
    fetchWithAuth(`${API_URL}/system/cluster-key`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.fingerprint) setClusterFingerprint(data.fingerprint); })
      .catch(() => {});
  }, [activeTab]);

  const handleRotateKey = async () => {
    setKeyBusy("rotate");
    try {
      const res = await fetchWithAuth(`${API_URL}/system/cluster-key/rotate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.key) {
        setRotatedKey(data.key);
        setClusterFingerprint(data.fingerprint);
        setKeyImportDraft("");
        showToast("New key minted. Copy it to every other computer now.");
      } else {
        showToast(data?.detail || "Key rotation failed.", "error");
      }
    } catch {
      showToast("Key rotation failed.", "error");
    } finally {
      setKeyBusy(null);
    }
  };

  const handleImportKey = async () => {
    if (!keyImportDraft.trim()) {
      showToast("Paste the new key text first.", "error");
      return;
    }
    setKeyBusy("import");
    try {
      const res = await fetchWithAuth(`${API_URL}/system/cluster-key/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyImportDraft }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setClusterFingerprint(data.fingerprint ?? null);
        setKeyImportDraft("");
        setKeyDialogOpen(false);
        showToast("Key adopted. Broadcasting with the new key now.");
      } else {
        showToast(data?.detail || "Key import failed.", "error");
      }
    } catch {
      showToast("Key import failed.", "error");
    } finally {
      setKeyBusy(null);
    }
  };

  const runSyncDiagnostics = async () => {
    setDiagRunning(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/system/sync-diagnostics`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setDiagResults(data.results || []);
        setDiagCheckedAt(data.checked_at || new Date().toISOString());
        showToast(data.results?.length ? "Connection check finished." : "No other computers are visible to check.", data.results?.length ? "success" : "error");
      } else {
        showToast(data?.detail || "Connection check failed to run.", "error");
      }
    } catch (e: any) {
      showToast("Connection check failed to run.", "error");
    } finally {
      setDiagRunning(false);
    }
  };
  // FRIENDLY COMPUTER NAME: what this machine broadcasts on the network so
  // other computers can show a real label next to its IP.
  const [computerName, setComputerName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [isCleaningDb, setIsCleaningDb] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // ADMIN USER MANAGEMENT (Security tab): only rendered for Admin accounts.
  const role = typeof window !== "undefined" ? localStorage.getItem("pasada_role") || "Clerk" : "Clerk";
  const isAdmin = role === "Admin";

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
    setAutoChangeMotorDate(resolveAutoChangeMotorDate(prefAutoMotor));

    if (localStorage.getItem("pasada_pin")) {
      setHasPin(true);
    }

    fetchWithAuth(`${API_URL}/recovery/status`)
      .then(res => res.json())
      .then((data: RecoveryConfig) => {
        setRecovery({ configured: !!data.configured, q1: data.q1 || "", q2: data.q2 || "", q3: data.q3 || "" });
        // A saved question that is not one of the suggestions shows as a
        // custom question so it can be edited or kept as-is.
        setCustomSlots({
          1: !!data.q1 && !RECOVERY_QUESTION_OPTIONS.includes(data.q1),
          2: !!data.q2 && !RECOVERY_QUESTION_OPTIONS.includes(data.q2),
          3: !!data.q3 && !RECOVERY_QUESTION_OPTIONS.includes(data.q3),
        });
        setRecoveryForm(prev => ({
          ...prev,
          q1: data.q1 || prev.q1,
          q2: data.q2 || prev.q2,
          q3: data.q3 || prev.q3,
        }));
      }).catch(e => console.error(e));

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

  // The network loader lives at component scope so other widgets (the PIN
  // pairing panel) can ask for a refresh right after they change something.
  const computerNameFilledOnce = useRef(false);
  const loadNetworkInfo = useCallback(() => {
    fetchWithAuth(`${API_URL}/system/network`)
      .then(res => res.json())
      .then(data => {
        setNetworkInfo(data);
        if (!computerNameFilledOnce.current) {
          setComputerName(data.computer_name || "");
          setNameDraft(data.computer_name || "");
          computerNameFilledOnce.current = true;
        }
      })
      .catch(e => console.error(e));
    fetchWithAuth(`${API_URL}/api/sync/diagnostics`)
      .then(res => res.json())
      .then(data => setSyncDiag(data))
      .catch(e => console.error(e));
  }, []);

  useEffect(() => {
    if (activeTab !== "network") return;
    // Refresh every 10 seconds while the tab is open so the last sync check
    // stamp moves and the office can SEE sharing is alive. The computer name
    // fields only fill on first load so typing is never clobbered.
    loadNetworkInfo();
    const interval = setInterval(loadNetworkInfo, 10000);
    return () => clearInterval(interval);
  }, [activeTab, loadNetworkInfo]);

  const handleSaveComputerName = async () => {
    const name = nameDraft.trim();
    if (!name) {
      showToast("Give this computer a name first.", "error");
      return;
    }
    setIsSavingName(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/system/computer-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        setComputerName(data.name || name);
        setNameDraft(data.name || name);
        showToast(`This computer is now announced as "${data.name || name}".`, "success");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Could not save the computer name.", "error");
      }
    } catch {
      showToast("Network error while saving the computer name.", "error");
    } finally {
      setIsSavingName(false);
    }
  };

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
      // uppercase dito na lang sa save, yung input field may text-transform na sa CSS.
      // siyempre isama na rin natin yung enable_esignature kasi required yun sa backend
      // (dati nag-422 na lang bigla kapag walang nakasama, at walang user feedback).
      const res = await fetchWithAuth(`${API_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ committee_chair: chairName.trim().toUpperCase(), enable_esignature: false })
      });
      if (!res.ok) {
        // may tumanggi sa backend: huwag padalos-dalos sa "success" toast
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Failed to save settings. Please check the value and try again.", "error");
        setLoading(false);
        return;
      }
      showToast("Signatory settings saved successfully.", "success");
    } catch (e) {
      showToast("Failed to save settings. Network Error.", "error");
    }
    setLoading(false);
  };

  // SAFETY NET: kapag hindi 2xx ang sagot, hindi dapat tahimik lang ang button.
  // Sinisiguro natin na may error toast kahit anong mangyari sa backend.

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
    const confirmClean = await confirmDialog({
      mode: "confirm",
      title: "Check and clean the records",
      message: "All records are checked and the usual mistakes get fixed: wrong dates, misspelled route names, and duplicate entries. Nothing is deleted.",
      confirmLabel: "Start",
    });
    if (!confirmClean) return;

    setIsCleaningDb(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/refresh-db`, {
        method: "POST"
      });
      if (res.ok) {
        const result = await res.json();
        showToast(result.message || "Record check finished.", "success");
      } else {
        const err = await res.json();
        showToast(err.detail || "Could not finish the record check.", "error");
      }
    } catch (err) {
      showToast("Network error while trying to clean database.", "error");
    } finally {
      setIsCleaningDb(false);
    }
  };

  const handleRecoverySave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryForm.q1.trim() || !recoveryForm.q2.trim() || !recoveryForm.q3.trim() ||
        !recoveryForm.a1.trim() || !recoveryForm.a2.trim() || !recoveryForm.a3.trim()) {
      showToast("Fill in all three questions and answers.", "error");
      return;
    }
    setRecoveryLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/recovery/setup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q1: recoveryForm.q1,
          q2: recoveryForm.q2,
          q3: recoveryForm.q3,
          a1: recoveryForm.a1,
          a2: recoveryForm.a2,
          a3: recoveryForm.a3,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecovery({ configured: true, q1: recoveryForm.q1, q2: recoveryForm.q2, q3: recoveryForm.q3 });
        setRecoveryForm(prev => ({ ...prev, a1: "", a2: "", a3: "" }));
        showToast(data.message || "Recovery questions saved.", "success");
      } else {
        showToast(data.detail || "Failed to save recovery questions.", "error");
      }
    } catch (err) {
      showToast("Network error. Could not save recovery questions.", "error");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/users/username`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_username: newUsername.trim().toUpperCase() })
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
  };  const handlePasswordUpdate = async (e: React.FormEvent) => {
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
          <h1 className="text-3xl font-black tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-0.5 text-sm font-medium">The chairman name printed on documents, backups, sign-in details, app updates, and connections between computers.</p>
        </div>
      </div>
      
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex w-full overflow-x-auto border-b border-border bg-muted/10">
          {[
            { id: "general", label: "General", icon: <SettingsIcon size={16} /> },
            { id: "backup", label: "Backups", icon: <Download size={16} /> },
            { id: "security", label: "Security", icon: <Shield size={16} /> },
            { id: "network", label: "Connections", icon: <Server size={16} /> }
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
                <h2 className="text-xl font-black tracking-tight">General</h2>
                <p className="text-sm text-muted-foreground font-medium mt-1">The name printed on official documents, and how saving records works.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Card 1: Committee Chairman Signatory */}
                <div className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2.5 text-blue-600">
                      <FileText size={20} />
                      <h3 className="text-base font-bold text-foreground">MTOP Signatory</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      This name is printed on MTOP certificates, Word documents, and TODA summary PDFs.
                    </p>
                    
                    <div className="space-y-1.5 pt-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Committee Chairman Name</label>
                      <input
                        type="text"
                        value={chairName}
                        onChange={(e) => setChairName(e.target.value)}
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
                      <h3 className="text-base font-bold text-foreground">Saving Records</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      What happens right after you save or renew a record.
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

                {/* Card 3: App Updates. Spans the full row so its two inner
                    columns fill both sides: no empty half next to it. */}
                <div
                  className="bg-muted/15 border border-border p-6 rounded-2xl flex flex-col space-y-6 lg:col-span-2"
                  data-tour="tour-guide-card"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 text-blue-600">
                      <ArrowUpCircle size={20} />
                      <h3 className="text-base font-bold text-foreground">App Updates and Guide</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      Keep PASADA current, and replay the step by step guide anytime.
                    </p>
                  </div>
                  <UpdateCard appVersion={APP_VERSION} />
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
                    <Download className="text-blue-600" size={20} /> Export Backup Files
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 font-medium">Download a ZIP with Excel masterlists and Word certificates for the filters you picked.</p>
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
                      <h3 className="text-base font-bold">Full Database Backup (.db)</h3>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                      Download an exact copy of the whole database. Save one before big cleanups or tests. You can restore it anytime from the Import page.
                    </p>
                  </div>

                  <button 
                    onClick={handleDbBackup} 
                    disabled={exportLoading} 
                    className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-3.5 px-6 rounded-lg flex items-center justify-center gap-2 hover:bg-slate-800 dark:hover:bg-slate-200 transition-all shadow-md"
                  >
                    {exportLoading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
                    Download Database (.db)
                  </button>
                </div>

                {/* Right: Database Self-Healing & Cleanup */}
                <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-2xl flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-amber-900 dark:text-amber-400">
                      <RefreshCw className="text-amber-600 shrink-0" size={20} />
                      <h3 className="text-base font-bold">Fix Common Record Problems</h3>
                    </div>
                    <p className="text-xs text-amber-800/80 dark:text-amber-300 font-medium leading-relaxed">
                      Checks all records and fixes the usual mistakes: wrong dates, misspelled route names, and duplicate entries. Nothing is deleted.
                    </p>
                  </div>

                  <button
                    onClick={handleRefreshDb}
                    disabled={isCleaningDb}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3.5 px-6 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md text-sm"
                  >
                    {isCleaningDb ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    {isCleaningDb ? "Fixing Records..." : "Fix Records Now"}
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
                <p className="text-xs text-muted-foreground mt-1 font-medium">Change the name you use to sign in, and your password.</p>
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
                        onChange={(e) => setNewUsername(e.target.value)}
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

              {/* Account management lives only in the Admin Console now —
                  having it here too was a duplicate surface for the same data. */}

              {/* Bottom: Dedicated Quick PIN Panel */}
              <div className="bg-muted/15 border border-border p-6 md:p-8 rounded-2xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h3 className="text-base font-bold flex items-center gap-2">
                      <Lock className="text-blue-600" size={18} /> Quick PIN Unlock
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium mt-0.5">
                      Set a short PIN to unlock PASADA quickly when you reopen it.
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
                      <p className="text-xs font-bold text-foreground">How it works:</p>
                      <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                        After you close PASADA, reopening it asks for this PIN instead of your full name and password. Your sign-in stays valid while the app is open.
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
                        No PIN set yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

            {/* ACCOUNT RECOVERY (SECURITY QUESTIONS) */}
            <div className="bg-muted/15 border border-border p-6 md:p-8 rounded-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <ShieldQuestion className="text-blue-600" size={18} /> Forgot Password Recovery
                  </h3>
                  <p className="text-xs text-muted-foreground font-medium mt-0.5">
                    Pick three questions only you can answer. On the login screen, answering them correctly lets you set a new password.
                  </p>
                </div>
                <div className="w-max">
                  {recovery.configured ? (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-full text-xs font-black">
                      <CheckCircle2 size={13} />
                      Recovery Ready
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded-full text-xs font-bold">
                      <XCircle size={13} />
                      Not Set Up
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <form onSubmit={handleRecoverySave} className="space-y-4">
                  {([1, 2, 3] as const).map((n) => {
                    const qKey = `q${n}` as "q1" | "q2" | "q3";
                    const aKey = `a${n}` as "a1" | "a2" | "a3";
                    const isCustom = customSlots[n as 1 | 2 | 3];
                    return (
                      <div key={n} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Question {n}</label>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomSlots(prev => ({ ...prev, [n]: !prev[n as 1 | 2 | 3] }));
                              if (!isCustom) {
                                // Switching to custom: clear the picked suggestion.
                                setRecoveryForm(prev => ({ ...prev, [qKey]: "" }));
                              }
                            }}
                            className="text-[11px] font-bold text-blue-600 hover:text-blue-700 underline underline-offset-2"
                          >
                            {isCustom ? "Choose a suggested question" : "Write my own"}
                          </button>
                        </div>
                        {isCustom ? (
                          <input
                            type="text"
                            value={recoveryForm[qKey]}
                            onChange={(e) => setRecoveryForm(prev => ({ ...prev, [qKey]: e.target.value }))}
                            placeholder="Write your question here"
                            aria-label={`Security question ${n} (custom)`}
                            data-tip="Your own question. Keep it one only you can answer, and one you will still remember years from now."
                            className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                          />
                        ) : (
                          <select
                            value={recoveryForm[qKey]}
                            onChange={(e) => setRecoveryForm(prev => ({ ...prev, [qKey]: e.target.value }))}
                            aria-label={`Security question ${n}`}
                            className="w-full bg-background border border-border shadow-sm rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                            required
                          >
                            {RECOVERY_QUESTION_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                          </select>
                        )}
                        <input
                          type="text"
                          value={recoveryForm[aKey]}
                          onChange={(e) => setRecoveryForm(prev => ({ ...prev, [aKey]: e.target.value }))}
                          placeholder={`Answer ${n}`}
                          aria-label={`Security answer ${n}`}
                          data-tip="Only you will see this question. Capitalization and extra spaces do not matter when answering."
                          autoComplete="off"
                          className="w-full bg-background border border-border shadow-sm rounded-lg px-4 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required
                        />
                      </div>
                    );
                  })}
                  <button
                    type="submit"
                    disabled={recoveryLoading}
                    data-tip="Saves the questions and locks in the answers. The answers themselves are never stored as typed: only unreadable versions of them are saved, and they never sync to other computers."
                    className="w-full bg-blue-600 text-white font-bold h-11 rounded-lg shadow-md hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                  >
                    {recoveryLoading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    {recovery.configured ? "Update Recovery Questions" : "Enable Account Recovery"}
                  </button>
                </form>

                <div className="bg-background border border-border rounded-xl p-5 space-y-2 shadow-sm self-start">
                  <p className="text-xs font-bold text-foreground">How it works</p>
                  <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                    On the login screen, Forgot Password asks for your full name, then these three questions, then a new password. Five wrong answers locks recovery for 15 minutes, and every attempt is written to Activity History.
                  </p>
                  <p className="text-xs text-muted-foreground font-medium leading-relaxed">
                    Your answers are never stored as typed: only unreadable versions of them are kept on this computer. They are never shown again, never synced, and never appear in logs.
                  </p>
                  <p className="text-[11px] text-muted-foreground font-semibold italic pt-1">
                    {recovery.configured ? "Recovery is ready for this account." : "Not set up yet: without it, a forgotten password needs an administrator."}
                  </p>
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
                  <Server className="text-blue-600" size={20} /> Connections
                </h2>
                <p className="text-sm text-muted-foreground mt-1 font-medium">Computers that share records with each other on your network.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner col-span-1">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Computer IP Address</p>
                  <p className="text-3xl font-black text-slate-800 dark:text-slate-200 font-mono tracking-wider">
                    {networkInfo?.local_ip || "CHECKING..."}
                  </p>
                  <div
                    className="flex items-center gap-2 mt-4 text-xs font-bold text-emerald-600 bg-emerald-500/10 w-max px-3 py-1.5 rounded-full border border-emerald-500/20"
                    data-tip="The sync service on this computer listens on port 43888 so other PASADA computers can reach it."
                  >
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    Active on Port 43888
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Name other computers see (follows the signed-in account)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        maxLength={40}
                        placeholder="Sign in to set automatically"
                        aria-label="This computer's network name"
                        className="h-9 uppercase font-bold"
                        data-tip="Usually the account name of whoever is signed in; other PASADA computers show it next to this computer's IP. It is a label only: joining and sharing still require the secret key, so a wrong name cannot do anything."
                      />
                      <Button onClick={handleSaveComputerName} disabled={isSavingName || nameDraft.trim() === computerName} size="sm" className="h-9 font-bold shrink-0">
                        {isSavingName ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                      </Button>
                    </div>
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
                        <div key={peer} className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-border px-3 py-2 rounded-md font-mono shadow-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span>{peer}</span>
                            {networkInfo?.peer_names?.[peer] && (
                              <span className="text-[11px] font-black text-blue-600 dark:text-blue-400 text-right" title={`Announced by ${peer}`}>{networkInfo.peer_names[peer]}</span>
                            )}
                          </div>
                          {(() => {
                            const st = networkInfo?.peer_status?.[peer];
                            if (!st) return null;
                            return (
                              <div className="mt-1 space-y-0.5 text-[10px] font-medium text-muted-foreground font-sans">
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full ${st.registered ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                  <span>
                                    {st.registered
                                      ? (st.misses ?? 0) > 0
                                      ? `working, but ${st.misses} recent pull(s) failed`
                                        : "working normally"
                                      : "not responding — waiting for it to come back"}
                                  </span>
                                </div>
                                <div>Last heard: {st.last_seen ? new Date(st.last_seen).toLocaleString() : "never"}</div>
                              </div>
                            );
                          })()}
                        </div>
                      ))
                    )}
                  </div>
                  {/* LIVE CONNECTION CHECK: one real signed pull per visible peer. */}
                  <div className="mt-4 border-t border-border pt-3 space-y-2">
                    <Button onClick={runSyncDiagnostics} disabled={diagRunning} size="sm" className="w-full h-8 font-bold text-xs" variant="outline">
                      {diagRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test computers now"}
                    </Button>
                    {diagResults !== null && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Last check: {diagCheckedAt ? new Date(diagCheckedAt).toLocaleTimeString() : "—"}
                        </p>
                        {diagResults.map(r => (
                          <div key={r.peer} className={`text-[11px] px-2.5 py-1.5 rounded-md border font-medium ${r.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"}`}>
                            <p className="font-bold">{r.name || r.peer}: {r.ok ? "connected and trusted" : `FAILED — ${r.reason}`}</p>
                            {r.detail && <p className="opacity-80 mt-0.5 normal-case">{r.detail}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="mt-4 border-t border-border pt-3 space-y-1">
                      {/* AUTO-PAIRING STATUS ONLY: computers join the sync
                          cluster by themselves (each copy makes its own
                          secure "introduction" handshake on first run). The
                          manual rotate/import tools moved to the Admin
                          Console as the recovery escape hatch. */}
                      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Computers join the sharing group <span className="font-bold">automatically</span> — no keys to manage. If the check above ever reports a problem that mentions shared keys, the fix (manual key rotation) is in the Admin Console.
                      </p>
                    </div>
                  )}
                  {isAdmin && (
                    <PairingPanel isAdmin={true} onAfterChange={loadNetworkInfo} />
                  )}
                </div>

      {/* SHARED KEY DIALOG — RECOVERY ESCAPE HATCH. Reachable only from the
          Admin Console. Normal days never open this: computers pair
          themselves automatically (PASADA_OFFER / PASADA_JOINBLOB /
          PASADA_REPLYBLOB handshake, hybrid AES-GCM + RSA-OAEP). This dialog
          exists for the rare occasion the Admin must forcibly re-key a
          compromised machine. */}
      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Manual key recovery</DialogTitle>
            <DialogDescription className="space-y-2 text-sm font-normal">
              <span className="block">
                The shared key is the private code two office computers use to trust each other for syncing. Computers normally agree on it <span className="font-bold">automatically</span> the moment PASADA is opened on a new machine — you never need to touch this dialog in daily use.
              </span>
              <span className="block">
                Use this only when the connection check reports a key problem on a specific machine (for example after reinstalling Windows on it). Press "New key on this computer", carry the text to the other computer (flash drive or printout), open this same dialog there and paste it. It works right away here; other computers pause syncing until you paste the same text on them too.
              </span>
            </DialogDescription>
          </DialogHeader>
          {rotatedKey ? (
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Show this once — copy it now</Label>
                <textarea
                  readOnly
                  value={rotatedKey}
                  rows={3}
                  className="mt-1 w-full text-xs font-mono bg-muted/40 border border-border rounded-md p-2 focus:outline-none"
                  aria-label="New shared key text (copy this now)"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Give this exact text to the other office computer (print it, use a flash drive, or send a private message). On that computer, open this same dialog and paste the text. This dialog will not show the text again after you close it.
              </p>
              <DialogFooter>
                <Button onClick={() => { setRotatedKey(null); setKeyDialogOpen(false); }} size="sm" className="font-bold">Done — I copied it</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Button onClick={handleRotateKey} disabled={keyBusy !== null} size="sm" className="font-bold">
                  {keyBusy === "rotate" ? <Loader2 className="h-4 w-4 animate-spin" /> : "New key on this computer"}
                </Button>
                <p className="text-[11px] text-muted-foreground mt-1">Works right away here. Other computers stop syncing until you paste this new text there too.</p>
              </div>
              <div className="border-t border-border pt-3">
                <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">I received a key</Label>
                <Input
                  value={keyImportDraft}
                  onChange={(e) => setKeyImportDraft(e.target.value)}
                  placeholder="Paste the key text you were given"
                  aria-label="Delivered cluster key text"
                  className="mt-1 h-9 font-mono text-xs"
                />
                <Button onClick={handleImportKey} disabled={keyBusy !== null} size="sm" className="mt-2 font-bold">
                  {keyBusy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save the key"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

                <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner col-span-1 flex flex-col justify-center">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 text-center">Sharing</p>
                  <div
                    className={`w-full ${syncDiag && (!syncDiag.crypto_ok || !syncDiag.pairing_enabled) ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400"} font-bold py-4 rounded-lg shadow-sm flex flex-col items-center justify-center gap-1 text-center border`}
                    data-tip="Sharing is always ON: PASADA announces itself on the network every 10 seconds and pulls new records from computers it trusts. If the checker below shows a problem, the card stays amber until it is fixed."
                  >
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>Automatic: ON</span>
                    </div>
                    <p className="text-[10px] font-medium opacity-80 mt-1">Records are shared on their own. No need to press anything.</p>
                    <p className="text-[10px] font-medium opacity-80">
                      {networkInfo?.last_sync_check
                        ? `Last sync check: ${new Date(networkInfo.last_sync_check).toLocaleTimeString()}`
                        : "Last sync check: not yet"}
                    </p>
                  </div>
                </div>
              </div>
              {/* WHY IS NOTHING SYNCING — engine snapshot. The green card
                  above used to stay green no matter what; this panel names
                  the actual blocker: pairing security missing, auto-pair
                  switched off, no computers found, or different keys. */}
              <div className="bg-muted/30 border border-border p-6 rounded-xl shadow-inner">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Sync health</p>
                {!syncDiag ? (
                  <p className="text-xs font-medium text-muted-foreground">Checking the sync engine...</p>
                ) : (
                  <div className="space-y-2">
                    {!syncDiag.crypto_ok && (
                      <p className="text-[11px] font-medium bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 px-2.5 py-1.5 rounded-md">
                        <span className="font-bold">This computer cannot join or share: its security library failed to load.</span> Reinstall PASADA on this computer (run the installer again) — without it, no computer can ever pair or sync.
                      </p>
                    )}
                    {!syncDiag.pairing_enabled && (
                      <p className="text-[11px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 px-2.5 py-1.5 rounded-md">
                        <span className="font-bold">Automatic pairing was switched off</span> on this computer, so new computers cannot join on their own and key recovery must go through the Admin Console.
                      </p>
                    )}
                    {(syncDiag.peers?.length ?? 0) === 0 && (
                      <p className="text-[11px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 px-2.5 py-1.5 rounded-md">
                        <span className="font-bold">No other computers are visible on the network.</span> PASADA announces itself every 10 seconds, so silence usually means the network itself: Windows Firewall, the network set to "Public", a cable, or computer clocks more than 5 minutes apart.
                      </p>
                    )}
                    {(syncDiag.peers?.length ?? 0) > 0 && syncDiag.crypto_ok && syncDiag.pairing_enabled && (
                      <p className="text-[11px] font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 px-2.5 py-1.5 rounded-md">
                        {syncDiag.peers.length} computer(s) found and the engine is healthy. If a specific computer keeps failing, use "Test computers now" above for its exact reason.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10px] font-medium text-muted-foreground">
                      <span className="font-mono">Cluster key fingerprint: <span className="font-bold">{syncDiag.secret_fingerprint}</span> — must be identical on every office computer</span>
                      <span>Discovery port {syncDiag.sync_port} · Sharing port {syncDiag.api_port}</span>
                      {syncDiag.all_local_ips?.length > 1 && <span>Multiple network cards: {syncDiag.all_local_ips.join(", ")}</span>}
                    </div>
                    {syncDiag.auto_pair_events?.length > 0 && (
                      <div className="pt-1 border-t border-border">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-2 mb-1">Recent introductions</p>
                        {syncDiag.auto_pair_events.map((ev, i) => (
                          <p key={i} className="text-[10px] font-medium text-muted-foreground">{ev}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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