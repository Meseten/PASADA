"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ClipboardList, CheckCircle2, XCircle, Clock } from "lucide-react";

type Ticket = {
  id: string;
  created_at: string | null;
  created_by: string;
  ticket_type: string;
  payload: Record<string, unknown>;
  reason: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  result_note: string | null;
};

const TICKET_LABELS: Record<string, string> = {
  route_delete: "Delete a TODA line",
  route_rename: "Rename a TODA line",
  record_restore: "Restore deleted records",
  user_deactivate: "Deactivate an account",
  database_restore: "Restore the database",
};

function describe(t: Ticket): string {
  if (t.ticket_type === "route_delete") return `Delete ${String(t.payload.route ?? "")} and all its records.`;
  if (t.ticket_type === "route_rename") return `Rename ${String(t.payload.route ?? "")} to ${String(t.payload.new_route_name ?? "")}.`;
  if (t.ticket_type === "record_restore") {
    const ids = Array.isArray(t.payload.record_ids) ? (t.payload.record_ids as unknown[]).length : 0;
    return `Bring back ${ids} deleted record(s).`;
  }
  if (t.ticket_type === "user_deactivate") {
    return t.payload.is_active === true
      ? `Reactivate the account of ${String(t.payload.username ?? "")}.`
      : `Deactivate the account of ${String(t.payload.username ?? "")}.`;
  }
  return t.ticket_type;
}

export default function MyRequestsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/tickets?status_filter=all&mine=true`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Could not load your requests.");
        return;
      }
      setTickets(await res.json());
    } catch {
      setError("Network error. The PASADA service did not answer.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = tickets.filter(t => t.status === "pending").length;

  return (
    <div className="space-y-4 p-4 md:p-6 bg-background min-h-screen">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-blue-600" /> My requests
          </h1>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            The actions you asked the Admin to approve, and what happened to each one.
            {pending > 0 && <> <span className="font-bold text-amber-600">{pending} still waiting.</span></>}
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="font-bold">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your requests…
        </div>
      ) : error ? (
        <div className="p-6 border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 rounded-xl text-sm font-bold text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : tickets.length === 0 ? (
        <div className="p-8 border border-border rounded-xl bg-card text-sm font-medium text-muted-foreground">
          You have not filed any requests yet. Restore asks are filed from a record's History dialog
          or from a delete row on the Activity Logs page.
        </div>
      ) : (
        <ul className="space-y-3">
          {tickets.map(t => (
            <li key={t.id} className="bg-card border border-border rounded-xl p-5 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-sm font-black flex items-center gap-2">
                  {TICKET_LABELS[t.ticket_type] || t.ticket_type}
                  <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded border ${
                    t.status === "pending"
                      ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900"
                      : t.status === "approved"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"
                        : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900"
                  }`}>
                    {t.status === "pending" ? <Clock className="inline h-3 w-3 mr-1" /> : null}
                    {t.status === "approved" ? <CheckCircle2 className="inline h-3 w-3 mr-1" /> : null}
                    {t.status === "rejected" ? <XCircle className="inline h-3 w-3 mr-1" /> : null}
                    {t.status}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground font-medium">
                  Filed {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
                </p>
              </div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{describe(t)}</p>
              {t.reason && (
                <p className="text-xs text-muted-foreground">Your note: {t.reason}</p>
              )}
              {t.status !== "pending" && (
                <p className="text-xs font-medium">
                  <span className="font-bold">{t.status === "approved" ? "Approved" : "Rejected"}</span>
                  {t.decided_by ? ` by ${t.decided_by}` : ""}
                  {t.decided_at ? ` · ${new Date(t.decided_at).toLocaleString()}` : ""}
                  {t.result_note ? ` — ${t.result_note}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
