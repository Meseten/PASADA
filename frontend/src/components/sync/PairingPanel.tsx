"use client";

// PIN PAIRING PANEL (Connections card, Settings > Computer Settings).
// The manual complement to automatic pairing: when the automatic handshake
// cannot run — the other computer's security library failed to load, the
// network is AP-isolated, a firewall eats the broadcasts — the Admin arms a
// six-digit PIN on the HOST computer, walks to the joining computer, and
// types the same PIN there. The cluster key crosses the LAN only inside an
// envelope the JOINER itself rolled (AES-GCM under SHA256(pin+salt)), so a
// sniffer sees ciphertext only. Admin-only: same model as key rotate/import.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, KeyRound } from "lucide-react";
import { API_URL, fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PairingStatus {
  armed: boolean;
  expires_in_seconds: number;
  fingerprint?: string;
  computer_name?: string;
}

interface PairingPanelProps {
  isAdmin: boolean;
  // Fired after a successful join so the parent card can refresh peers.
  onAfterChange?: () => void;
}

export default function PairingPanel({ isAdmin, onAfterChange }: PairingPanelProps) {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [shownPin, setShownPin] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [myPin, setMyPin] = useState("");
  const [joinPin, setJoinPin] = useState("");
  const [hostIp, setHostIp] = useState("");
  const [busy, setBusy] = useState<null | "arm" | "clear" | "join">(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [lastRequest, setLastRequest] = useState("pin-pairing-get-status");
  const alive = useRef(true);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/system/pairing-pin/status`);
      if (res.ok) setStatus(await res.json());
    } catch { /* status is best-effort */ }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (isAdmin) loadStatus();
    return () => { alive.current = false; };
  }, [isAdmin, loadStatus, lastRequest]);

  // Countdown for an armed PIN, driven off expires_in_seconds.
  useEffect(() => {
    if (!status?.armed) { setRemaining(0); return; }
    const deadline = Date.now() + status.expires_in_seconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setShownPin(null);
        setStatus((prev) => (prev ? { ...prev, armed: false } : prev));
      }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [status?.armed, status?.expires_in_seconds]);

  if (!isAdmin) return null;

  const arm = async (pin: string) => {
    setBusy("arm");
    try {
      const res = await fetchWithAuth(`${API_URL}/system/pairing-pin/arm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pin ? { pin } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash({ tone: "err", text: data.detail || "PASADA refused to arm the PIN." });
        return;
      }
      setShownPin(typeof data.pin === "string" ? data.pin : null);
      setMyPin("");
      setLastRequest(`pin-pairing-arm-${Date.now()}`);
    } catch {
      setFlash({ tone: "err", text: "Network error while arming the PIN." });
    } finally {
      setBusy(null);
    }
  };

  const clearPin = async () => {
    setBusy("clear");
    try {
      await fetchWithAuth(`${API_URL}/system/pairing-pin/clear`, { method: "POST" });
      setShownPin(null);
      setLastRequest(`pin-pairing-clear-${Date.now()}`);
    } catch {
      setFlash({ tone: "err", text: "Network error while clearing the PIN." });
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    setBusy("join");
    try {
      const res = await fetchWithAuth(`${API_URL}/system/pairing-pin/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: joinPin, host_ip: hostIp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash({ tone: "err", text: data.detail || "PASADA refused the join attempt." });
        return;
      }
      setFlash(data.joined
        ? { tone: "ok", text: `${data.message} This computer's key fingerprint is now ${data.fingerprint} — it must match on the other computer.` }
        : { tone: "warn", text: data.message });
      setJoinPin("");
      if (data.joined) setLastRequest(`pin-pairing-joined-${Date.now()}`);
      onAfterChange?.();
    } catch {
      setFlash({ tone: "err", text: "Network error while trying to join." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3 space-y-3" data-testid="pairing-panel">
      <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
        <KeyRound className="h-3.5 w-3.5 text-blue-600" />
        Pair a computer with a PIN
      </p>

      {flash && (
        <p
          data-testid="pairing-flash"
          className={`text-[11px] font-bold px-2.5 py-1.5 rounded-md border ${
            flash.tone === "ok"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
              : flash.tone === "warn"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
          }`}
        >
          {flash.text}
        </p>
      )}

      {status?.armed || shownPin ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {shownPin
              ? "Give these six digits to the joining computer:"
              : "A PIN is armed on this computer (digits hidden until you re-arm)."}
          </p>
          {shownPin && (
            <p className="text-2xl font-black tracking-[0.35em] text-blue-600 dark:text-blue-400 font-mono" data-testid="armed-pin">
              {shownPin}
            </p>
          )}
          <p className="text-[10px] font-medium text-muted-foreground">
            Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} minutes.
          </p>
          <Button onClick={clearPin} disabled={busy !== null} size="sm" variant="outline" className="h-8 font-bold text-xs w-full">
            {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Clear the PIN"}
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Button onClick={() => arm("")} disabled={busy !== null} size="sm" className="h-8 font-bold text-xs w-full">
            {busy === "arm" && shownPin === null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate a PIN"}
          </Button>
          <div className="flex items-center gap-2">
            <Input
              value={myPin}
              onChange={(e) => setMyPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              aria-label="Type your own PIN six digits"
              placeholder="or use your own"
              className="h-8 font-mono"
              data-tip="Six digits. The joining computer must type the same one within 10 minutes."
            />
            <Button onClick={() => arm(myPin)} disabled={busy !== null || myPin.length !== 6} size="sm" variant="outline" className="h-8 font-bold text-xs shrink-0">
              {busy === "arm" && shownPin === null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Arm"}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-2.5">
        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
          Connect to another computer
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={joinPin}
            onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            aria-label="The shared PIN six digits"
            placeholder="shared PIN"
            className="h-8 font-mono"
          />
          <Input
            value={hostIp}
            onChange={(e) => setHostIp(e.target.value.trim().slice(0, 15))}
            aria-label="Other computer's IP optional"
            placeholder="other PC IP (optional)"
            className="h-8 font-mono"
            data-tip="Leave empty to look for PIN holders on the office network automatically."
          />
          <Button onClick={join} disabled={busy !== null || joinPin.length !== 6} size="sm" variant="outline" className="h-8 font-bold text-xs shrink-0">
            {busy === "join" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Join"}
          </Button>
        </div>
      </div>
    </div>
  );
}
