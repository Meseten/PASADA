"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, AlertTriangle, CheckCircle2, ClipboardCheck, Database, FileUp, History,
  KeyRound, Loader2, MonitorCog, RefreshCw, RotateCcw, Server, ShieldCheck, Users, X, XCircle,
} from "lucide-react";
import { API_URL, fetchWithAuth } from "@/lib/api";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import OfficeAccounts from "@/components/office-accounts";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface Toast { id: number; message: string; type: "success" | "error"; }
interface ManagedUser { username: string; full_name: string; role: string; has_password: boolean; is_deactivated: boolean; last_login: string | null; }
interface TemplateInfo { key: string; filename: string; installed: boolean; size: number; modified: string | null; }
interface Diagnostics {
  runtime: { python: string; platform: string; machine: string; pid: number; started: string };
  database: { integrity: string; records: number; users: number; admins: string[] };
  sync: { local_ip: string; api_port: number; peers: string[]; peer_names: Record<string, string>; computer_name: string; last_sync_check?: string | null };
  backup: { file: string; modified: string; size: number } | null;
  crash_log_tail: string[];
}
interface AuditOverview {
  total_logs: number;
  logs_last_7_days: number;
  last_activity: string | null;
  actions_last_7_days: { action: string; count: number }[];
  users_last_7_days: { user: string; count: number }[];
  daily_last_7_days: { day: string; count: number }[];
}

const TABS = [
  { id: "operational", label: "Operational", icon: Activity },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck },
  { id: "technical", label: "Technical", icon: MonitorCog },
  { id: "administrative", label: "Administrative", icon: ShieldCheck },
] as const;

interface Ticket {
  id: string; created_at: string | null; created_by: string;
  ticket_type: string; payload: Record<string, unknown>; reason: string | null;
  status: string; decided_by: string | null; decided_at: string | null; result_note: string | null;
}

const TICKET_LABELS: Record<string, string> = {
  route_delete: "Delete route",
  route_rename: "Rename route",
  record_restore: "Restore records",
  user_deactivate: "Deactivate account",
};

export default function AdminConsole() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [adminNeeded, setAdminNeeded] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("operational");

  // Bootstrap: first account promotes itself when no admin exists yet.
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapConfirm, setBootstrapConfirm] = useState("");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [myUsername] = useState(() => typeof window !== "undefined" ? (localStorage.getItem("pasada_full_name") || "").trim().toUpperCase() : "");

  // Templates.
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const certInputRef = useRef<HTMLInputElement>(null);
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  // Data.
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [syncNowLoading, setSyncNowLoading] = useState(false);
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [ticketFilter, setTicketFilter] = useState("pending");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("pasada_role") || "";
    setRole(stored);
    setRoleLoaded(true);
    if (stored === "Admin") {
      fetchWithAuth(`${API_URL}/admin/diagnostics`).then(async res => {
        if (res.ok) setDiagnostics(await res.json());
      }).catch(() => {});
      fetchWithAuth(`${API_URL}/admin/audit-overview`).then(async res => {
        if (res.ok) setOverview(await res.json());
      }).catch(() => {});
      fetchWithAuth(`${API_URL}/admin/templates`).then(async res => {
        if (res.ok) setTemplates(await res.json());
      }).catch(() => {});
      fetchWithAuth(`${API_URL}/admin/tickets?status_filter=pending`).then(async res => {
        if (res.ok) setTickets(await res.json());
      }).catch(() => {});
    }
  }, []);

  // A clerk sees the bootstrap panel only when the office truly has no admin.
  useEffect(() => {
    if (roleLoaded && role !== "Admin") {
      fetchWithAuth(`${API_URL}/admin/needed`).then(async res => {
        if (res.ok) setAdminNeeded((await res.json()).needed);
      }).catch(() => {});
    }
  }, [roleLoaded, role]);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bootstrapPassword !== bootstrapConfirm) {
      showToast("Passwords do not match.", "error");
      return;
    }
    setBootstrapping(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: bootstrapPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        localStorage.setItem("pasada_role", "Admin");
        setRole("Admin");
        setAdminNeeded(false);
        showToast(data.message || "This account is now the office Admin.", "success");
      } else {
        showToast(data.detail || "Bootstrap failed.", "error");
      }
    } catch {
      showToast("Network error. Is the PASADA service running?", "error");
    } finally {
      setBootstrapping(false);
      setBootstrapPassword("");
      setBootstrapConfirm("");
    }
  };

  const handleSyncNow = async () => {
    setSyncNowLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/system/sync-now`, { method: "POST" });
      if (res.ok) {
        showToast("Sync cycle requested. Records refresh in a moment.", "success");
      } else {
        showToast("Could not request a sync cycle. Try again.", "error");
      }
    } catch {
      showToast("Could not request a sync cycle. Try again.", "error");
    } finally {
      setSyncNowLoading(false);
      setDiagnosticsLoading(true);
      fetchWithAuth(`${API_URL}/admin/diagnostics`)
        .then(async r => { if (r.ok) setDiagnostics(await r.json()); })
        .catch(() => {})
        .finally(() => setDiagnosticsLoading(false));
    }
  };

  const refreshTickets = async (filter: string = ticketFilter) => {
    setTicketsLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/tickets?status_filter=${filter}`);
      if (res.ok) setTickets(await res.json());
    } catch { showToast("Could not load the approval queue.", "error"); }
    finally { setTicketsLoading(false); }
  };

  const decideTicket = async (id: string, approve: boolean) => {
    setDecidingId(id);
    try {
      let note = "";
      if (!approve) {
        // A rejection now requires a reason: it is shown to the requester and
        // written to the audit log, so an empty rejection is worse than none.
        const typed = await confirmDialog({
          mode: "prompt",
          title: "Reject this request",
          message: "The reason is shown to the person who filed the request, and saved with the decision.",
          fieldNote: "Shown to the requester.",
          confirmLabel: "Reject",
          destructive: true,
        });
        if (typeof typed !== "string") { setDecidingId(null); return; }
        note = typed;
      }
      const res = await fetchWithAuth(`${API_URL}/admin/tickets/${id}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(approve ? `Approved. ${data.result_note || "Done."}` : `Rejected: ${data.result_note || ""}`, "success");
        await refreshTickets();
      } else {
        showToast(data.detail || "The decision could not be saved.", "error");
      }
    } catch { showToast("Network error while saving the decision.", "error"); }
    finally { setDecidingId(null); }
  };

  // RESTORE NOW: the single-key rule (2026-10-14) lets the Admin execute a
  // record restore DIRECTLY with a mandatory written reason — including one
  // that is already sitting in the queue (even their own ticket, which the
  // second-key Approve refuses). It reuses the same /api/restore-records/ticket
  // endpoint the restore affordances elsewhere call: as Admin it runs the
  // restore immediately, then the ticket is marked approved so the queue
  // stays consistent with what actually happened.
  const restoreTicketNow = async (t: Ticket) => {
    const recordIds = Array.isArray(t.payload.record_ids) ? (t.payload.record_ids as string[]) : [];
    if (recordIds.length === 0) { showToast("This ticket has no records to restore.", "error"); return; }
    const typed = await confirmDialog({
      mode: "prompt",
      title: "Restore now",
      message: "The selected record(s) come back right away — no ticket cycle needed. \nA reason is required and is written into the audit log.",
      fieldNote: "Shown in Activity History next to the restore.",
      confirmLabel: "Restore now",
    });
    if (typeof typed !== "string" || !typed.trim()) return;
    setDecidingId(t.id);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/restore-records/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_ids: recordIds, override_reason: typed.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "The restore could not be done.");
      // The restore ran; also approve the ticket (note-only approve is refused
      // for own tickets, and the choice must not depend on who filed it).
      const ap = await fetchWithAuth(`${API_URL}/admin/tickets/${t.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Restored directly by the Admin." }),
      });
      if (!ap.ok) {
        const apd = await ap.json().catch(() => ({}));
        // Closing the ticket is cleanup, not the restore itself: if it was
        // already decided (or refuses), the queue simply keeps the old state.
        console.warn("Ticket not closed after direct restore:", apd.detail);
      }
      showToast(data.message || "Record(s) restored.", "success");
      await refreshTickets();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "The restore could not be done.", "error");
    } finally {
      setDecidingId(null);
    }
  };

  const handleTemplateUpload = async (key: string, file: File) => {
    setUploadingKey(key);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetchWithAuth(`${API_URL}/admin/templates/${key}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.warning ? `Uploaded, but: ${data.warning}` : `${data.template} uploaded.`, data.warning ? "error" : "success");
        const list = await fetchWithAuth(`${API_URL}/admin/templates`);
        if (list.ok) setTemplates(await list.json());
      } else {
        showToast(data.detail || "Upload failed.", "error");
      }
    } catch {
      showToast("Network error during upload.", "error");
    } finally {
      setUploadingKey(null);
    }
  };

  if (roleLoaded && role !== "Admin") {
    if (!adminNeeded) {
      return (
        <div className="p-8 min-h-screen bg-muted/5 flex items-center justify-center">
          <div className="bg-card border border-border rounded-2xl shadow-sm p-10 max-w-md text-center">
            <ShieldCheck className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-black mb-2">Admin Console</h2>
            <p className="text-sm text-muted-foreground font-medium">
              This area is for the office Admin only. Ask your administrator if you need something changed.
            </p>
          </div>
        </div>
      );
    }
    // FIRST-RUN BOOTSTRAP: no admin exists anywhere in the office. The signed-in
    // account can become the Admin by confirming its own password. Once an
    // admin exists this panel disappears for everyone.
    return (
      <div className="p-8 min-h-screen bg-muted/5 flex items-center justify-center">
        <form onSubmit={handleBootstrap} className="bg-card border border-border rounded-2xl shadow-sm p-8 max-w-md w-full space-y-4">
          <div className="flex items-center gap-3">
            <KeyRound className="w-8 h-8 text-blue-600" />
            <div>
              <h2 className="text-xl font-black">Set up the office Admin</h2>
              <p className="text-xs text-muted-foreground font-medium">No Admin account exists yet. Confirm your password to make this account the Admin.</p>
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Your password</span>
            <input
              type="password" value={bootstrapPassword} required autoFocus
              onChange={(e) => setBootstrapPassword(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Confirm your password</span>
            <input
              type="password" value={bootstrapConfirm} required
              onChange={(e) => setBootstrapConfirm(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <Button type="submit" disabled={bootstrapping} className="w-full h-11 font-bold bg-blue-600 hover:bg-blue-700 text-white">
            {bootstrapping ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Make this account the Admin
          </Button>
        </form>
      </div>
    );
  }

  const fmtBytes = (n: number) => n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500 min-h-screen bg-muted/5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <ShieldCheck className="w-8 h-8 text-blue-600" />
          <div>
            <h2 className="text-3xl font-black tracking-tight">Admin Console</h2>
            <p className="text-muted-foreground mt-1 font-medium text-sm">Everything only the office Admin should touch, in one place.</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1 shadow-sm w-max" role="tablist" aria-label="Admin sections"
          onKeyDown={(e) => {
            // ARIA tabs pattern: Left/Right arrows move between the four
            // sections, and only the active tab is in the Tab order.
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const idx = TABS.findIndex(t => t.id === activeTab);
            const next = e.key === "ArrowRight" ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length;
            setActiveTab(TABS[next].id);
            const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role=tab]");
            buttons[next]?.focus();
          }}>
          {TABS.map(tab => (
            <button
              key={tab.id} role="tab" id={`admin-tab-${tab.id}`} aria-controls={`admin-panel-${tab.id}`}
              aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 h-11 rounded-lg text-sm font-bold transition-colors ${activeTab === tab.id ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 dark:text-slate-300 hover:bg-muted/60"}`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* OPERATIONAL: what the office has been doing */}
      {activeTab === "operational" && (
        <div className="space-y-6" id="admin-panel-operational" role="tabpanel" aria-labelledby="admin-tab-operational">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Activity entries (all time)</p>
              <div className="text-3xl font-black mt-1">{overview ? overview.total_logs : <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Loading" />}</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Last 7 days</p>
              <div className="text-3xl font-black mt-1">{overview ? overview.logs_last_7_days : <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label="Loading" />}</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Most recent activity</p>
              <div className="text-base font-black mt-2 truncate">{overview ? fmtWhen(overview.last_activity) : <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading" />}</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-base font-bold flex items-center gap-2 mb-4"><Activity className="text-blue-600" size={18} /> Activity per day (last 7 days)</h3>
            {overview && overview.daily_last_7_days ? (
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview.daily_last_7_days}>
                    <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} tick={{ fill: "currentColor", fontWeight: "bold" }} />
                    <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} tick={{ fill: "currentColor", fontWeight: "bold" }} width={30} />
                    <Tooltip
                      cursor={{ fill: "rgba(59,130,246,0.08)" }}
                      contentStyle={{ fontSize: "11px", borderRadius: "6px", border: "1px solid var(--border)", backgroundColor: "var(--card)", color: "var(--card-foreground)" }}
                      formatter={(value: any) => [value, "actions"]}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground font-medium">Loading the week's activity…</p>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-base font-bold flex items-center gap-2 mb-4"><History className="text-blue-600" size={18} /> Top actions this week</h3>
              {overview && overview.actions_last_7_days.length > 0 ? (
                <ul className="space-y-2">
                  {overview.actions_last_7_days.slice(0, 8).map(a => (
                    <li key={a.action} className="flex items-center justify-between text-sm font-bold">
                      <span className="bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300 text-[10px] uppercase font-black px-2 py-1 rounded">{a.action.replace(/_/g, " ")}</span>
                      <span>{a.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground font-medium">No recorded activity in the last 7 days.</p>
              )}
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-base font-bold flex items-center gap-2 mb-4"><Users className="text-blue-600" size={18} /> Who worked this week</h3>
              {overview && overview.users_last_7_days.length > 0 ? (
                <ul className="space-y-2">
                  {overview.users_last_7_days.slice(0, 8).map(u => (
                    <li key={u.user} className="flex items-center justify-between text-sm font-bold">
                      <span>{u.user}</span><span>{u.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground font-medium">No recorded activity in the last 7 days.</p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground font-medium">Full, filterable activity history lives on the Activity History page; this overview is the one-glance version.</p>
        </div>
      )}

      {/* APPROVALS: the two-key queue */}
      {activeTab === "approvals" && (
        <div className="space-y-6" id="admin-panel-approvals" role="tabpanel" aria-labelledby="admin-tab-approvals">
          <div className="bg-muted/15 border border-border p-6 md:p-8 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2"><ClipboardCheck className="text-blue-600" size={18} /> Requests waiting for you</h3>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">
                  Clerks can ask for the big actions (delete or rename a line, restore records) but nothing happens until you approve here.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select value={ticketFilter} onChange={(e) => { setTicketFilter(e.target.value); refreshTickets(e.target.value); }}
                  className="h-11 bg-background border border-border rounded-lg px-3 text-xs font-bold">
                  <option value="pending">Waiting</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="all">All</option>
                </select>
                <button type="button" onClick={() => refreshTickets()} className="flex items-center gap-1.5 h-11 px-3 bg-background border border-border rounded-lg text-xs font-bold hover:bg-muted/50">
                  <RefreshCw size={13} className={ticketsLoading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
            </div>
            {tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground font-medium">
                {ticketFilter === "pending" ? "Nothing is waiting for approval right now." : "No tickets in this view."}
              </p>
            ) : (
              <ul className="space-y-3">
                {tickets.map(t => (
                  <li key={t.id} className="bg-background border border-border rounded-xl p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-sm font-black">
                          {TICKET_LABELS[t.ticket_type] || t.ticket_type}
                          <span className={`ml-2 text-[10px] uppercase font-black px-2 py-0.5 rounded border ${
                            t.status === "pending" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" :
                            t.status === "approved" ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" :
                            "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"}`}>
                            {t.status}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground font-medium">
                          Asked by <span className="font-bold">{t.created_by}</span> · {t.created_at ? new Date(t.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                      {t.status === "pending" && (
                        <div className="flex items-center gap-2 shrink-0">
                          {t.ticket_type === "record_restore" && (
                            <Button size="sm" variant="outline" className="font-bold border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300"
                              disabled={decidingId === t.id} onClick={() => restoreTicketNow(t)}>
                              <RotateCcw size={14} className="mr-1" /> Restore now
                            </Button>
                          )}
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                            disabled={decidingId === t.id} onClick={() => decideTicket(t.id, true)}>
                            {decidingId === t.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} className="mr-1" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="font-bold border-red-200 text-red-600 hover:bg-red-50"
                            disabled={decidingId === t.id} onClick={() => decideTicket(t.id, false)}>
                            <XCircle size={14} className="mr-1" /> Reject
                          </Button>
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {t.ticket_type === "route_delete" && <>Delete the whole <span className="text-red-600">{String(t.payload.route)}</span> line and all its records.</>}
                      {t.ticket_type === "route_rename" && <>Rename <span className="font-black">{String(t.payload.route)}</span> to <span className="text-blue-600">{String(t.payload.new_route_name)}</span>{t.payload.new_prefix ? <> with SBN prefix <span className="font-black">{String(t.payload.new_prefix)}</span></> : null}.</>}
                      {t.ticket_type === "record_restore" && <>Bring back {Array.isArray(t.payload.record_ids) ? (t.payload.record_ids as string[]).length : 0} deleted record(s).</>}
                      {t.ticket_type === "user_deactivate" && (t.payload.is_active === true
                        ? <>Reactivate the account of <span className="font-black">{String(t.payload.username)}</span>, so sign-in works again.</>
                        : <>Deactivate the account of <span className="text-red-600">{String(t.payload.username)}</span>. Sign-in is refused until an Admin reactivates it.</>)}
                    </p>
                    {t.reason && <p className="text-xs text-muted-foreground font-medium italic">Reason: {t.reason}</p>}
                    {t.status !== "pending" && (
                      <p className="text-xs text-muted-foreground font-medium">
                        {t.status === "approved" ? "Approved" : "Rejected"} by                        {t.decided_by || "(unknown)"}{t.decided_at ? ` · ${new Date(t.decided_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                        {t.result_note ? ` · ${t.result_note}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* TECHNICAL: health of the machine, database, sync and backups */}
      {activeTab === "technical" && (
        <div className="space-y-6" id="admin-panel-technical" role="tabpanel" aria-labelledby="admin-tab-technical">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold flex items-center gap-2"><Server className="text-blue-600" size={18} /> This computer &amp; service</h3>
            <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => {
              setDiagnosticsLoading(true);
              fetchWithAuth(`${API_URL}/admin/diagnostics`).then(async res => {
                if (res.ok) { setDiagnostics(await res.json()); showToast("Diagnostics refreshed.", "success"); }
              }).catch(() => showToast("Could not refresh diagnostics.", "error")).finally(() => setDiagnosticsLoading(false));
            }} disabled={diagnosticsLoading}>
              <RefreshCw size={14} className={diagnosticsLoading ? "animate-spin mr-1.5" : "mr-1.5"} /> Refresh
            </Button>
          </div>
          {diagnostics ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-2 text-sm">
                  <h4 className="font-black mb-2">This computer</h4>
                  <p><span className="text-muted-foreground font-bold">Computer:</span> {diagnostics.runtime.machine || "unknown"}</p>
                  <p><span className="text-muted-foreground font-bold">PASADA started:</span> {fmtWhen(diagnostics.runtime.started)}</p>
                  <p className="text-xs text-muted-foreground break-all">{diagnostics.runtime.platform}</p>
                </div>
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-2 text-sm">
                  <h4 className="font-black mb-2 flex items-center gap-2"><Database size={16} /> Records</h4>
                  <p className="flex items-center gap-2">
                    <span className="text-muted-foreground font-bold">Database check:</span>
                    {diagnostics.database.integrity === "ok"
                      ? <span className="inline-flex items-center gap-1 text-emerald-600 font-black"><CheckCircle2 size={14} /> all good</span>
                      : <span className="inline-flex items-center gap-1 text-amber-600 font-black"><AlertTriangle size={14} /> needs attention: {diagnostics.database.integrity}</span>}
                  </p>
                  <p><span className="text-muted-foreground font-bold">Records saved:</span> {diagnostics.database.records.toLocaleString()}</p>
                  <p><span className="text-muted-foreground font-bold">Accounts:</span> {diagnostics.database.users} (Admin: {diagnostics.database.admins.join(", ") || "none"})</p>
                </div>
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-2 text-sm">
                  <h4 className="font-black mb-2">Sharing between computers</h4>
                  <p><span className="text-muted-foreground font-bold">This computer:</span> {diagnostics.sync.computer_name || "unnamed"} ({diagnostics.sync.local_ip})</p>
                  <p><span className="text-muted-foreground font-bold">Connected computers:</span> {diagnostics.sync.peers.length === 0 ? "none yet" : diagnostics.sync.peers.map(p => diagnostics.sync.peer_names[p] ? `${diagnostics.sync.peer_names[p]} (${p})` : p).join(", ")}</p>
                  <p><span className="text-muted-foreground font-bold">Last sync check:</span> {diagnostics.sync.last_sync_check ? fmtWhen(diagnostics.sync.last_sync_check) : "not yet"}</p>
                  <div className="pt-2">
                    <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={handleSyncNow} disabled={syncNowLoading}>
                      <RefreshCw size={14} className={syncNowLoading ? "animate-spin mr-1.5" : "mr-1.5"} /> Sync now
                    </Button>
                    <p className="text-xs text-muted-foreground font-medium mt-2">Pulls new records from the other computers right away. New and changed accounts already arrive on their own within seconds.</p>
                    <p className="text-xs text-muted-foreground font-medium mt-1">Computers join the sharing group automatically when PASADA is opened on them. Manual key recovery below is only for the rare case the connection check reports a key problem.</p>
                    {/* The dialog itself lives on Settings (its network state is
                        wired into that page), so this button NAVIGATES there and the
                        ?keyrecovery=1 flag opens the dialog. Dispatching a window
                        event used to do nothing: no listener is mounted on this page. */}
                    <Button variant="outline" size="sm" className="mt-2 font-bold shadow-sm border-border/60" onClick={() => router.push("/settings?tab=network&keyrecovery=1")}>
                      <KeyRound size={14} className="mr-1.5" /> Manual key recovery
                    </Button>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-2 text-sm">
                  <h4 className="font-black mb-2">Latest backup</h4>
                  {diagnostics.backup ? (
                    <>
                      <p className="font-bold break-all">{diagnostics.backup.file}</p>
                      <p className="text-muted-foreground">{fmtWhen(diagnostics.backup.modified)} ({fmtBytes(diagnostics.backup.size)})</p>
                    </>
                  ) : <p className="text-muted-foreground">No nightly backup zip found yet.</p>}
                </div>
              </div>
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h4 className="font-black mb-3">Error notes (last 60 lines)</h4>
                {diagnostics.crash_log_tail.length > 0 ? (
                  <pre className="text-[11px] leading-relaxed bg-muted/40 rounded-lg p-4 overflow-x-auto max-h-72 custom-scrollbar whitespace-pre-wrap">{diagnostics.crash_log_tail.join("\n")}</pre>
                ) : <p className="text-sm text-muted-foreground font-medium">No error notes. That is good news.</p>}
              </div>
            </>
          ) : (
            <div className="bg-card border border-border rounded-2xl p-10 shadow-sm flex items-center justify-center text-muted-foreground font-bold">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading diagnostics…
            </div>
          )}
        </div>
      )}

      {/* ADMINISTRATIVE: accounts and templates */}
      {activeTab === "administrative" && (
        <div className="space-y-6" id="admin-panel-administrative" role="tabpanel" aria-labelledby="admin-tab-administrative">
          <OfficeAccounts notify={showToast} />

          <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-5">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2"><FileUp className="text-blue-600" size={18} /> Document templates</h3>
              <p className="text-xs text-muted-foreground font-medium mt-0.5">
                Upload an amended Word form when the LGU changes it. The file must be .docx and keep the placeholder tokens (like [SBN_NO] and [NAME]) so records still fill in.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { key: "certificate", title: "Certificate template", desc: "The MTOP certificate printed for every operator.", ref: certInputRef },
                { key: "toda_summary", title: "TODA Summary template", desc: "The yearly renewal summary document.", ref: summaryInputRef },
              ].map(t => {
                const info = templates.find(x => x.key === t.key);
                return (
                  <div key={t.key} className="bg-background border border-border rounded-xl p-5 space-y-3">
                    <p className="text-sm font-bold">{t.title}</p>
                    <p className="text-xs text-muted-foreground font-medium">{t.desc}</p>
                    <p className="text-xs font-bold text-muted-foreground">
                      {info && info.installed ? `Installed: ${info.filename} (${fmtBytes(info.size)}), ${fmtWhen(info.modified)}` : "Checking…"}
                    </p>
                    <input ref={t.ref} type="file" accept=".docx" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTemplateUpload(t.key, f); e.target.value = ""; }} />
                    <Button type="button" variant="outline" className="w-full font-bold" disabled={uploadingKey === t.key}
                      onClick={() => t.ref.current?.click()}>
                      {uploadingKey === t.key ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} className="mr-2" />}
                      {uploadingKey === t.key ? "Uploading…" : "Upload replacement .docx"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TOASTS */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-bold animate-in slide-in-from-right-8 fade-in duration-300 ${toast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-900" : "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900"}`}>
            {toast.type === "success" ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />}
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="ml-4 opacity-50 hover:opacity-100 transition-opacity shrink-0"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
