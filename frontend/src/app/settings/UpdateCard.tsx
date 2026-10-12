"use client"

import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RefreshCw, Download, CheckCircle2, XCircle, Loader2, Clock, GraduationCap, PlayCircle, ShieldCheck, Info, ArrowUpCircle, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { startTour } from "@/lib/tutorial"

type UpdatePhase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "restarting" | "error"
type CheckSchedule = "off" | "daily" | "weekly"
// What happens after PASADA finds a new version: ask every time, or install
// by itself (after a few quiet minutes, or right away).
// CheckSchedule explains what the Check button does; InstallPreference
// explains what happens after an update IS found. Two different questions:
// checking never downloads anything (it only asks the releases page if a
// newer version exists), and installing is what downloads and applies it.
type InstallPreference = "ask" | "ready" | "idle"

// How long the office computer must sit untouched before an "Install when
// idle" update applies itself. Nothing installs while anyone is working:
// every mouse move, key press, or click resets the wait.
const IDLE_INSTALL_MS = 5 * 60 * 1000

// Map raw updater failures to plain sentences a clerk can act on. The
// updater's own messages name network internals that mean nothing in an
// office, so each known cause gets one friendly line instead.
function explainError(raw: string): string {
  const r = raw.toLowerCase()
  // NON-WINDOWS BUILD, NO PUBLISHED PACKAGE: the releases manifest
  // (latest.json) currently only carries a windows-x86_64 entry. On Linux the
  // updater loads the manifest fine but finds no package for this OS and
  // fails with a "platform ... not found" style error. Say that plainly
  // instead of blaming the connection, which sent people in circles.
  if (r.includes("platform") || r.includes("not supported on this operating")) {
    return "No update package has been published for this operating system yet, so PASADA cannot update itself here. Download the newest installer from the official GitHub releases page instead."
  }
  if (r.includes("network") || r.includes("fetch") || r.includes("connection") || r.includes("timed out") || r.includes("timeout")) {
    return "PASADA could not reach the update page. Press Check again when the internet is connected. If the connection is fine, there may be no published update to compare with yet."
  }
  if (r.includes("404") || r.includes("not found") || r.includes("no release") || r.includes("valid release json")) {
    return "No update was found to compare with. Your app may already be the newest version, or the update has not been published yet."
  }
  if (r.includes("signature") || r.includes("pubkey") || r.includes("key")) {
    return "The update could not be proven official, so it was NOT installed. Nothing was changed. Ask the IT contact to check the release."
  }
  if (r.includes("updater") && r.includes("disabled")) {
    return "Updates are turned off in this copy of the app. Download the installer from the official GitHub page instead."
  }
  return "The update check did not go through. Check the internet connection and try again."
}

// Auto-check preference, stored on this device. Off by default: the office
// decides when PASADA looks for updates. Daily and Weekly quietly check in
// the background and never install anything on their own.
const SCHEDULE_MS: Record<Exclude<CheckSchedule, "off">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

function useCheckSchedule() {
  const [mode, setMode] = useState<CheckSchedule>("off")
  const [lastChecked, setLastChecked] = useState<number | null>(null)
  useEffect(() => {
    const stored = localStorage.getItem("pasada_update_check")
    setMode(stored === "daily" || stored === "weekly" ? stored : "off")
    const raw = Number(localStorage.getItem("pasada_update_last_check") || 0)
    setLastChecked(raw > 0 ? raw : null)
  }, [])
  const set = (next: CheckSchedule) => {
    setMode(next)
    if (next === "off") {
      localStorage.removeItem("pasada_update_check")
    } else {
      localStorage.setItem("pasada_update_check", next)
    }
  }
  const markChecked = () => {
    const now = Date.now()
    localStorage.setItem("pasada_update_last_check", String(now))
    setLastChecked(now)
  }
  return { mode, set, lastChecked, markChecked }
}

// Install preference, also stored on this device.
function useInstallPreference() {
  const [pref, setPref] = useState<InstallPreference>("ask")
  useEffect(() => {
    const stored = localStorage.getItem("pasada_update_install")
    setPref(stored === "ready" || stored === "idle" ? stored : "ask")
  }, [])
  const set = (next: InstallPreference) => {
    setPref(next)
    localStorage.setItem("pasada_update_install", next)
  }
  return { pref, set }
}

function formatWhen(ts: number | null): string {
  if (!ts) return "Never"
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (sameDay) return `Today at ${time}`
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`
}

export default function UpdateCard({ appVersion }: { appVersion: string }) {
  const [phase, setPhase] = useState<UpdatePhase>("idle")
  const [newVersion, setNewVersion] = useState("")
  const [progressPct, setProgressPct] = useState(0)
  const [error, setError] = useState("")
  // BACKGROUND PREPARE: with "Install when idle" or "Install immediately",
  // the signed installer is downloaded (and verified) before any click, so
  // Install later finishes in seconds on slow office internet.
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const [prepareNote, setPrepareNote] = useState("")
  const { mode: autoCheck, set: setAutoCheck, lastChecked, markChecked } = useCheckSchedule()
  const { pref: installPref, set: setInstallPref } = useInstallPreference()

  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

  const runCheck = async (quiet: boolean): Promise<boolean> => {
    if (!isTauri) {
      if (!quiet) {
        setPhase("error")
        setError("Updates only work inside the PASADA desktop app.")
      }
      return false
    }
    if (!quiet) setPhase("checking")
    setError("")
    try {
      const version = await invoke<string | null>("check_for_app_update")
      markChecked()
      if (version) {
        setNewVersion(version)
        setPhase("available")
      } else if (!quiet) {
        setPhase("upToDate")
      }
      return true
    } catch (e) {
      if (!quiet) {
        setPhase("error")
        setError(explainError(String(e)))
      }
      return false
    }
  }

  const handleCheck = () => runCheck(false)

  // Download-and-verify in the background once an update is known and the
  // office chose "Install when idle" or "Install immediately". Quiet on
  // failure: the Install button still works the old way (download on click).
  useEffect(() => {
    if (!isTauri) return
    if (installPref === "ask" || phase !== "available" || !newVersion) return
    if (preparing || prepared) return
    let cancelled = false
    setPreparing(true)
    setPrepareNote("")
    invoke<number>("prepare_app_update")
      .then(() => { if (!cancelled) { setPrepared(true) } })
      .catch(() => { if (!cancelled) { setPrepareNote("Could not get it ready in the background. Installing will download it when you click.") } })
      .finally(() => { if (!cancelled) { setPreparing(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installPref, phase, newVersion])

  // Quiet background probe when the chosen interval has passed. With the
  // "prepare the download" preference it fetches the update in the
  // background but still waits for a click before restarting.
  useEffect(() => {
    if (autoCheck === "off" || !isTauri) return
    const interval = SCHEDULE_MS[autoCheck]
    if (lastChecked && Date.now() - lastChecked < interval) return
    runCheck(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck])

  const handleInstall = async () => {
    if (!isTauri) return
    setProgressPct(0)
    setPhase("downloading")
    // Coarse progress: the Rust side logs exact bytes; this shows the final
    // percent so the button stays honest without an event channel for a
    // one-shot download.
    const tick = setInterval(() => setProgressPct((p) => Math.min(95, p + 5)), 500)
    try {
      await invoke("install_app_update")
      clearInterval(tick)
      setProgressPct(100)
      // install_app_update restarts PASADA when it finishes; if we are still
      // here, show the handoff state instead of pretending nothing happened.
      setPhase("restarting")
    } catch (e) {
      clearInterval(tick)
      setPhase("error")
      setError(explainError(String(e)))
    }
  }

  const handleReplayTour = () => {
    localStorage.setItem("pasada_tour_done", "1")
    startTour()
  }

  const busy = phase === "checking" || phase === "downloading" || phase === "restarting"

  // INSTALL IMMEDIATELY: once the update is found and its download finished,
  // apply it on its own. The download still happens quietly first (see the
  // prepare effect), so the restart is the only visible step.
  useEffect(() => {
    if (!isTauri) return
    if (installPref !== "ready" || phase !== "available" || !newVersion || busy) return
    if (!prepared) return
    handleInstall()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installPref, phase, newVersion, prepared, busy])

  // INSTALL WHEN IDLE: with that preference and an update already found, wait
  // for a quiet stretch (no mouse, keys, or clicks) and only then install.
  // Any activity resets the wait, so it never interrupts someone working.
  useEffect(() => {
    if (!isTauri) return
    if (installPref !== "idle" || phase !== "available" || !newVersion || busy) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { handleInstall() }, IDLE_INSTALL_MS)
    }
    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "wheel", "touchstart"]
    events.forEach(ev => window.addEventListener(ev, arm, { passive: true }))
    arm()
    return () => {
      if (timer) clearTimeout(timer)
      events.forEach(ev => window.removeEventListener(ev, arm))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installPref, phase, newVersion, busy])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full items-start">
      {/* LEFT: version, check button, and the update flow */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground font-medium">
            Current version: <span className="font-mono font-bold text-foreground">{appVersion}</span>
          </p>
          {phase === "upToDate" && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-xs font-black">
              <CheckCircle2 size={13} /> Up to date
            </span>
          )}
          {phase === "available" && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-full text-xs font-black">
              <ArrowUpCircle size={13} /> New version found: <span className="font-mono">{newVersion}</span>
            </span>
          )}
        </div>

        {phase === "downloading" && (
          <div className="space-y-2">
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground font-semibold" data-tip="The official installer is downloading. It opens by itself, finishes on its own, and PASADA restarts into the new version.">
              Downloading update... the installer will open and PASADA restarts by itself.
            </p>
          </div>
        )}

        {phase === "restarting" && (
          <p className="text-sm text-blue-600 dark:text-blue-400 font-bold flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Finishing installation. PASADA is restarting.
          </p>
        )}

        {phase === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400 font-bold flex items-start gap-2">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {phase === "available" && (
          <div className="space-y-2">
            {prepared && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 size={13} /> New version downloaded and checked. Installing is quick now.
              </p>
            )}
            {preparing && (
              <p className="text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting the new version ready in the background...
              </p>
            )}
            {!prepared && !preparing && prepareNote && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold">{prepareNote}</p>
            )}
            {installPref === "idle" && (
              <p className="text-xs text-muted-foreground font-semibold">
                Installs by itself after a few quiet minutes. Press Install to do it right now.
              </p>
            )}
            <Button
              onClick={handleInstall}
              disabled={busy}
              className="w-full h-11 font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md"
              data-tip={prepared ? "The official installer is already downloaded and checked. This applies it and restarts PASADA. Your records are not touched." : "Downloads the official installer first, checks it, then applies it and restarts PASADA. Your records are not touched."}
            >
              <Download className="mr-2 h-5 w-5" />
              {prepared ? `Install version ${newVersion} now` : `Download and install version ${newVersion}`}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => { setPhase("idle"); setNewVersion(""); setPrepared(false); setPrepareNote("") }}
              className="w-full h-9 font-bold"
              data-tip="Keep working for now. PASADA will ask again the next time it checks."
            >
              Not right now
            </Button>
          </div>
        )}
        {phase !== "available" && (
          <div className="space-y-1.5">
            <Button
              onClick={handleCheck}
              disabled={busy}
              variant="outline"
              className="w-full h-11 font-bold shadow-sm"
              data-tip="Only ASKS the official PASADA releases page if a newer version exists. It does not download anything: downloading happens when you press Install, or by itself with Install immediately or Install when idle."
            >
              {phase === "checking" ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
              {phase === "checking" ? "Checking..." : "Check for Updates"}
            </Button>
            <p className="text-[11px] text-muted-foreground font-semibold flex items-center gap-1.5 px-1">
              <Clock className="h-3 w-3" /> Last checked: {formatWhen(lastChecked)}
            </p>
          </div>
        )}

        <Label className="text-xs text-muted-foreground font-normal flex items-start gap-1.5">
          <WifiOff className="h-3 w-3 mt-0.5 shrink-0" />
          Office computers without internet: press Check for Updates only while connected, or install the new version with the downloaded installer from the official GitHub page.
        </Label>

        {/* INSTALL PREFERENCE: what PASADA does after it finds a new version */}
        <div className="flex items-center gap-3 p-3.5 bg-background border border-border rounded-xl shadow-sm">
          <Download className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <label htmlFor="install-pref" className="text-xs font-bold text-foreground block">
              When an update is found, install?
            </label>
            <p className="text-[11px] text-muted-foreground font-medium mt-0.5 leading-relaxed">
              {installPref === "ask"
                ? "PASADA tells you here and waits for your click. Nothing downloads until you press Install."
                : installPref === "ready"
                  ? "PASADA downloads and checks it in the background right away, then installs it and restarts without waiting."
                  : "PASADA downloads it first, then installs by itself after a few quiet minutes. Nothing installs while someone is working."}
            </p>
          </div>
          <select
            id="install-pref"
            value={installPref}
            onChange={(e) => setInstallPref(e.target.value as InstallPreference)}
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs font-bold text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shrink-0"
            data-tip="Ask first: nothing downloads until you press Install. Install immediately: downloads in the background and applies it on its own. Install when idle: waits for a few quiet minutes, then applies it."
          >
            <option value="ask">Ask first</option>
            <option value="ready">Install immediately</option>
            <option value="idle">Install when idle</option>
          </select>
        </div>
      </div>

      {/* RIGHT: check schedule, safety note, guide replay, offline note */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3.5 bg-background border border-border rounded-xl shadow-sm">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <label htmlFor="check-schedule" className="text-xs font-bold text-foreground block">
              Check for updates
            </label>
            <p className="text-[11px] text-muted-foreground font-medium mt-0.5 leading-relaxed">
              {autoCheck === "off"
                ? "Only when you press the button. Checking never downloads anything; it only asks if a newer version exists."
                : `Once a ${autoCheck === "daily" ? "day" : "week"} while you work. It never downloads or installs anything on its own.`}
            </p>
          </div>
          <select
            id="check-schedule"
            value={autoCheck}
            onChange={(e) => setAutoCheck(e.target.value as CheckSchedule)}
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs font-bold text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shrink-0"
            data-tip="Off: you press the button. Daily or Weekly: PASADA quietly checks on its own but never downloads or installs without your click."
          >
            <option value="off">Only when I press Check</option>
            <option value="daily">Once a day</option>
            <option value="weekly">Once a week</option>
          </select>
        </div>

        <div className="flex items-start gap-3 p-3.5 bg-muted/20 border border-border rounded-xl shadow-sm" data-tip="Every update is checked against a digital signature from the PASADA developer. An update that fails the check is refused and nothing is installed.">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground font-medium leading-relaxed">
            <span className="font-bold text-foreground">Every update is checked first:</span> PASADA downloads only from its
            official GitHub page, refuses anything that is not officially released, and your records live outside the app
            folder, so an update never touches them.
          </p>
        </div>

        <div className="flex items-center gap-3 p-3.5 bg-background border border-border rounded-xl shadow-sm">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-blue-600" /> Step by step guide
            </p>
            <p className="text-xs text-muted-foreground font-medium mt-1 leading-relaxed">
              A short walkthrough of the main pages. It shows once after sign-in, and you can play it again here.
            </p>
          </div>
          <Button
            onClick={handleReplayTour}
            variant="outline"
            size="sm"
            className="h-9 font-bold shrink-0"
            data-tip="Replay the guided walkthrough of every page right now"
          >
            <PlayCircle className="mr-1.5 h-4 w-4" />
            Show
          </Button>
        </div>

      </div>
    </div>
  )
}
