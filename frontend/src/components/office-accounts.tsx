"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, Save, ShieldQuestion, UserCheck, UserX } from "lucide-react";
import { API_URL, fetchWithAuth } from "@/lib/api";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";

export interface ManagedUser {
  username: string;
  full_name: string;
  role: string;
  has_password: boolean;
  is_deactivated: boolean;
  last_login: string | null;
}

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "never";

interface OfficeAccountsProps {
  /** Reuse the host page's toast system so success/error match the rest of the app. */
  notify: (message: string, type?: "success" | "error") => void;
  title?: string;
  blurb?: string;
}

/**
 * Office accounts: create a clerk/admin, reset a forgotten password, and
 * deactivate/reactivate accounts. The backend rejects non-Admin callers with
 * 403, so this panel is only rendered for Admin accounts (or on the one-time
 * bootstrap path). Deactivation follows the two-key rule: with a second active
 * Admin it files a ticket; a one-admin office executes directly but must type a
 * reason. This component owns its own state so the Admin Console and Settings
 * share one implementation instead of two copies.
 */
export default function OfficeAccounts({ notify, title = "Office accounts", blurb = "Create accounts for new clerks and reset forgotten passwords. Accounts made here sign in on every connected computer." }: OfficeAccountsProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  // Starts true: the panel loads its account list on mount.
  const [usersLoading, setUsersLoading] = useState(true);
  const [newUser, setNewUser] = useState({ first_name: "", last_name: "", password: "", role: "Clerk" });
  const [newUserConfirm, setNewUserConfirm] = useState("");
  const [resetTarget, setResetTarget] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  // The username is built from the full name, so the signed-in admin can
  // recognize its own row. The backend refuses self-deactivation anyway.
  const [myUsername] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem("pasada_full_name") || "").trim().toUpperCase() : ""
  );

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/users`);
      if (res.ok) setUsers(await res.json());
      else {
        const err = await res.json().catch(() => ({}));
        notify(err.detail || "Could not load accounts.", "error");
      }
    } catch {
      notify("Network error. Could not load accounts.", "error");
    } finally {
      setUsersLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newUser.password.length < 8) {
      notify("Password must be at least 8 characters long.", "error");
      return;
    }
    if (newUser.password !== newUserConfirm) {
      notify("Passwords do not match.", "error");
      return;
    }
    setUsersLoading(true);
    try {
      const username = `${newUser.first_name.trim()} ${newUser.last_name.trim()}`.toUpperCase();
      const res = await fetchWithAuth(`${API_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: newUser.first_name.trim().toUpperCase(),
          last_name: newUser.last_name.trim().toUpperCase(),
          username,
          password: newUser.password,
          password_confirm: newUserConfirm,
          role: newUser.role,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(data.message || "Account created. It syncs to the other computers.", "success");
        setNewUser({ first_name: "", last_name: "", password: "", role: "Clerk" });
        setNewUserConfirm("");
        loadUsers();
      } else {
        notify(data.detail || "Could not create the account.", "error");
      }
    } catch {
      notify("Network error. Could not create the account.", "error");
    }
    setUsersLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPassword.length < 8) {
      notify("Password must be at least 8 characters long.", "error");
      return;
    }
    if (resetPassword !== resetConfirm) {
      notify("Passwords do not match.", "error");
      return;
    }
    setUsersLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/users/reset-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: resetTarget, new_password: resetPassword, password_confirm: resetConfirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(data.message || "Password reset. The account can sign in on every computer.", "success");
        setResetTarget("");
        setResetPassword("");
        setResetConfirm("");
        loadUsers();
      } else {
        notify(data.detail || "Could not reset the password.", "error");
      }
    } catch {
      notify("Network error. Could not reset the password.", "error");
    }
    setUsersLoading(false);
  };

  // The big actions follow the single-key rule (2026-10-14): the Admin
  // executes directly and must type a written reason, which the backend
  // demands and the audit log records. A Clerk still files a ticket for the
  // Admin.
  const askOverrideReason = async (action: string): Promise<string | null> => {
    const typed = await confirmDialog({
      mode: "prompt",
      title: "Reason required",
      message: `This ${action} runs right away, and the reason is written into the audit log.`,
      fieldNote: "Shown in Activity History next to the change.",
      confirmLabel: "Continue",
    });
    if (typeof typed !== "string") return null;
    return typed.trim() || null;
  };

  const handleSetActive = async (target: ManagedUser) => {
    const nextActive = target.is_deactivated;
    const verb = nextActive ? "reactivate" : "deactivate";
    const isClerk = (localStorage.getItem("pasada_role") || "") !== "Admin";
    if (!nextActive) {
      const ok = await confirmDialog({
        mode: "confirm",
        title: `Deactivate ${target.full_name}`,
        message: isClerk
          ? "The request goes to the Admin for approval. Records and history are kept."
          : "Records and history are kept; sign-in is refused until an Admin reactivates the account.",
        destructive: true,
        confirmLabel: isClerk ? "File the request" : "Deactivate",
      });
      if (!ok) return;
    }
    let overrideReason = "";
    if (!isClerk) {
      const typed = await askOverrideReason(verb);
      if (typed === null) return;
      overrideReason = typed;
    }
    setUsersLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/users/set-active`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: target.username, is_active: nextActive, override_reason: overrideReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(data.message || "Account updated.", "success");
        loadUsers();
      } else {
        notify(data.detail || "Could not update the account.", "error");
      }
    } catch {
      notify("Network error while updating the account.", "error");
    } finally {
      setUsersLoading(false);
    }
  };

  const handleSetRole = async (target: ManagedUser, newRole: string) => {
    if (newRole === target.role) return;
    const verb = newRole === "Admin" ? "promote to Admin" : "demote to Clerk";
    const ok = await confirmDialog({
      mode: "confirm",
      title: `${verb}: ${target.full_name}`,
      message: newRole === "Admin"
        ? "An Admin manages accounts, restores deleted records, and approves tickets. Make sure you trust this account first."
        : "A Clerk fills out registration forms and cannot manage accounts or approve restorations.",
      confirmLabel: verb === "promote to Admin" ? "Make Admin" : "Make Clerk",
    });
    if (!ok) {
      loadUsers(); // revert the select back to the account's real role
      return;
    }
    setUsersLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/users/set-role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: target.username, role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(data.message || "Role updated. It syncs to the other computers.", "success");
      } else {
        notify(data.detail || "Could not change the role.", "error");
      }
    } catch {
      notify("Network error while changing the role.", "error");
    } finally {
      setUsersLoading(false);
      loadUsers();
    }
  };

  return (
    <div className="bg-muted/15 border border-border p-6 md:p-8 rounded-2xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <ShieldQuestion className="text-blue-600" size={18} /> {title}
          </h3>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">{blurb}</p>
        </div>
        <button
          type="button"
          onClick={() => { setUsersLoading(true); loadUsers(); }}
          className="w-max flex items-center gap-1.5 h-11 px-3 bg-background border border-border rounded-lg text-xs font-bold hover:bg-muted/50 transition-colors"
        >
          <RefreshCw size={13} className={usersLoading ? "animate-spin" : ""} /> Refresh list
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Create account */}
        <form onSubmit={handleCreateUser} className="bg-background border border-border rounded-xl p-5 space-y-4">
          <p className="text-sm font-bold">Create a new account</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">First Name</span>
              <input
                type="text"
                value={newUser.first_name}
                required
                onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Last Name</span>
              <input
                type="text"
                value={newUser.last_name}
                required
                onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Password (8+ chars)</span>
              <input
                type="password"
                value={newUser.password}
                required
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Confirm Password</span>
              <input
                type="password"
                value={newUserConfirm}
                required
                onChange={(e) => setNewUserConfirm(e.target.value)}
                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Role</span>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Clerk">Clerk</option>
                <option value="Admin">Admin</option>
                <option value="Viewer">Viewer (read-only)</option>
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground font-medium">Username is built from the full name, same as self-registration. Viewer accounts can look at records but cannot add, edit, or delete anything.</p>
          <Button
            type="submit"
            disabled={usersLoading}
            className="w-full h-11 font-bold bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200"
          >
            {usersLoading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Create Account
          </Button>
        </form>

        {/* Reset password */}
        <form onSubmit={handleResetPassword} className="bg-background border border-border rounded-xl p-5 space-y-4">
          <p className="text-sm font-bold">Reset a forgotten password</p>
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Account</span>
            <select
              value={resetTarget}
              required
              onChange={(e) => setResetTarget(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="" disabled>Choose an account…</option>
              {users.filter((u) => !u.is_deactivated).map((u) => (
                <option key={u.username} value={u.username}>
                  {u.full_name} ({u.role}){u.has_password ? "" : " (no password yet)"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">New Password (8+ chars)</span>
            <input
              type="password"
              value={resetPassword}
              required
              onChange={(e) => setResetPassword(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="space-y-1.5 block">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Confirm New Password</span>
            <input
              type="password"
              value={resetConfirm}
              required
              onChange={(e) => setResetConfirm(e.target.value)}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <p className="text-[11px] text-muted-foreground font-medium">Resetting also clears any login lockout on that account.</p>
          <Button
            type="submit"
            disabled={usersLoading || !resetTarget}
            className="w-full h-11 font-bold bg-blue-600 hover:bg-blue-700 text-white"
          >
            {usersLoading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Reset Password
          </Button>
        </form>
      </div>

      {/* Account list */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Account</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Role</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Last sign-in</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Password</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className={`border-t border-border ${u.is_deactivated ? "opacity-60" : ""}`}>
                <td className="px-4 py-2.5 font-bold">{u.full_name}</td>
                <td className="px-4 py-2.5">
                  {u.username === myUsername ? (
                    <span title="You created the office with this account; it keeps you from locking yourself out.">{u.role} (you)</span>
                  ) : (
                    <select
                      value={u.role}
                      disabled={usersLoading || u.is_deactivated}
                      aria-label={`Change role of ${u.full_name}`}
                      onChange={(e) => handleSetRole(u, e.target.value)}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 font-bold text-xs cursor-pointer disabled:opacity-40"
                    >
                      <option value="Admin">Admin</option>
                      <option value="Clerk">Clerk</option>
                    </select>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground font-medium text-xs">{fmtWhen(u.last_login)}</td>
                <td className="px-4 py-2.5">
                  {u.has_password ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Set</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 font-bold">Not set (reset it above)</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {u.is_deactivated ? (
                    <span className="text-red-600 dark:text-red-400 font-bold">Deactivated</span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">Active</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    disabled={usersLoading || u.username === myUsername}
                    title={u.username === myUsername ? "You cannot deactivate the account you are signed in with." : undefined}
                    onClick={() => handleSetActive(u)}
                    className="h-11 px-3 rounded-lg border border-border bg-background text-xs font-bold hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <>{u.is_deactivated ? <UserCheck size={13} className="inline mr-1.5 -mt-0.5" /> : <UserX size={13} className="inline mr-1.5 -mt-0.5" />}{u.is_deactivated ? "Reactivate" : "Deactivate"}</>
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-4 text-center text-muted-foreground">{usersLoading ? "Loading accounts…" : "No accounts yet. Create the first one above."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
