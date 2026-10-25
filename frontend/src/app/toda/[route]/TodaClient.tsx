"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { History, FileSignature, Edit, Printer, Search, PlusCircle, CheckCircle, XCircle, AlertCircle, AlertTriangle, ArchiveX, Loader2, Filter, Calendar, FileText, Download, Trash2, CheckSquare, Eye, Shield, RefreshCw, ArrowUpDown, X, CheckCircle2, Globe, Edit3, Save, Undo2 } from "lucide-react"
import { API_URL, fetchWithAuth, resolveAutoChangeMotorDate } from "@/lib/api"
import { confirmDialog } from "@/components/ui/confirm-dialog"

interface Member {
  id: string;
  sbn_no: string;
  operator_name: string;
  address: string;
  plate_no: string;
  motor_no: string;
  chassis_no: string;
  make: string;
  route: string;
  driving_route: string;
  issue_date: string;
  valid_until: string;
  is_active: boolean;
}

interface LogEntry {
  id: string;
  timestamp: string;
  clerk_name: string;
  action: string;
  details: string;
  // EDIT UNDO: entries that changed a record carry the full "before" values
  // (JSON text) so one button can put the record back. Empty on other kinds
  // of entries and on old logs saved before this existed.
  before_values?: string | null;
}

interface RouteInfo {
  route: string;
  display_name: string;
  dominant_route: string;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
  // UNDO-ON-SAVE: an optional one-click action inside the toast, e.g.
  // "Undo Changes" right after an edit is saved.
  action?: { label: string; onClick: () => void };
}

const KNOWN_ROUTES = [
  'BATODA', 'BBSTODA', 'CNTODA', 'CO1TODA', 'CO2TODA', 'DOMMSATODA', 
  'HCTODA', 'HMTODA', 'HVRTODA', 'MALATODA', 'MMGTODA', 'MMTODA', 
  'NCTODA', 'NPTODA', 'PAL1TODA', 'PAL2TODA', 'SABANGTODA', 'SMSTODA', 
  'TCTODA', 'VASTODA', 'VISTODA'
];

// Matching din ito sa ROUTE_DISPLAY_MAP ng backend. Dito nakalagay yung buong
// opisyal na pangalan ng TODA at yung kumpletong address ng mga barangay na
// sakop nito, para sa header ng bawat route page. Ayaw namin ng ganyan na
// "PAL.CENTRAL" o "Tim.balsahan" na shortcut sa harap mismo ng page.
const ROUTE_FULL_ADDRESSES: Record<string, string> = {
  BATODA: "BANCAAN/SAPA",
  BBSTODA: "BUCANA/BAGONG KALSADA/SAPA",
  CNTODA: "CIUDAD NUEVO",
  CO1TODA: "TIMALAN BALSAHAN/HILLSVIEW",
  CO2TODA: "TIMALAN BALSAHAN / HILLSVIEW",
  DOMMSATODA: "NAIC/MUZON/MARAGONDON",
  HCTODA: "HALANG/CALUBCOB",
  HMTODA: "HUMBAC/MAKINA",
  HVRTODA: "HILLSVIEW/TIMALAN BALSAHAN",
  MALATODA: "MABULO/LABAC",
  MMTODA: "MALAINEN LUMA/MOLINO",
  MMGTODA: "MUNTING MAPINO",
  NCTODA: "POBLACION",
  NPTODA: "POBLACION",
  PAL1TODA: "PALANGUE CENTRAL",
  PAL2TODA: "PALANGUE 2&3",
  SABANGTODA: "SABANG",
  SMSTODA: "SAN ROQUE/MALAINEN BAGO/SANTULAN",
  TCTODA: "TIMALAN CONCEPCION",
  VASTODA: "VILLA APOLONIA",
  VISTODA: "FREEDOMVILLE"
};

const HOURS = Array.from({length: 24}, (_, i) => ({
    val: i.toString(),
    label: i === 0 ? "12 AM" : i < 12 ? `${i} AM` : i === 12 ? "12 PM" : `${i - 12} PM`
}));

export default function TodaClient() {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const fallbackRoute = pathname?.split('/').pop()?.toUpperCase() || ""
  const safeRouteName = (params?.route as string)?.toUpperCase() || fallbackRoute
  // RENAMING A LINE IS ADMIN WORK: hide the button from clerks. The API also
  // enforces this with the same Admin-only rule, so hiding is courtesy, not
  // the security boundary.
  const isAdmin = typeof window !== "undefined" && (localStorage.getItem("pasada_role") || "") === "Admin"
  // VIEWER ROLE: read-only accounts don't get edit/delete buttons here. Hiding
  // is courtesy, not security — the API refuses every records write from a
  // Viewer with 403, so a crafted request gains nothing.
  const isViewer = typeof window !== "undefined" && (localStorage.getItem("pasada_role") || "") === "Viewer"

  const [members, setMembers] = useState<Member[]>([])
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sortBy, setSortBy] = useState("SBN_ASC")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [viewMember, setViewMember] = useState<Member | null>(null)
  
  // RENAME ROUTE MODAL STATE
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameData, setRenameData] = useState({ new_route_name: "", new_prefix: "", new_driving_route: "" })

  const [isGeneratingId, setIsGeneratingId] = useState<string | null>(null)
  const [isDownloadingId, setIsDownloadingId] = useState<string | null>(null)
  const [wordSuccessId, setWordSuccessId] = useState<string | null>(null)
  
  const [isExporting, setIsExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [lastDeletedIds, setLastDeletedIds] = useState<string[]>([]) // recent deletes, for the Undo banner
  // RESTORE VIA HISTORY: state for the "Request restore" affordance inside the
  // per-record History dialog. activeMember is the record the dialog shows;
  // restoreStatus carries what GET /tickets/for-record/{id} returned for it.
  const [restoreStatus, setRestoreStatus] = useState<{ is_deleted: boolean; restore_requested: boolean; current_role: string } | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchFilterType, setBatchFilterType] = useState("TODAY_ALL")
  const [batchScope, setBatchScope] = useState("THIS")
  const [customRoutes, setCustomRoutes] = useState<string[]>([safeRouteName])
  const [batchSpecificDate, setBatchSpecificDate] = useState("")
  const [batchStartDate, setBatchStartDate] = useState("")
  const [batchEndDate, setBatchEndDate] = useState("")
  
  const [batchSpecificHour, setBatchSpecificHour] = useState("8")
  const [batchStartHour, setBatchStartHour] = useState("8")
  const [batchEndHour, setBatchEndHour] = useState("17")

  // Background Batch Generation State
  const [isBackgroundGenerating, setIsBackgroundGenerating] = useState(false)
  const [bgProgress, setBgProgress] = useState({ current: 0, total: 0 })
  const [readyPrintData, setReadyPrintData] = useState<{ url: string, count: number } | null>(null)
  // 25010 Safety: ids queued for the in-flight batch print. If any of them is
  // deleted while generation runs, we warn and prune so the merged PDF never
  // includes a certificate for a record that no longer exists.
  const [pendingBatchIds, setPendingBatchIds] = useState<string[]>([])

  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>([])
  const [activeMember, setActiveMember] = useState<Member | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(50)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [downloadedFiles, setDownloadedFiles] = useState<Set<string>>(new Set())
  const [dupModalOpen, setDupModalOpen] = useState(false)
  const [pendingDownload, setPendingDownload] = useState<{name: string, action: () => void} | null>(null)

  // PREVIEW MODAL STATE
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [isDownloadingSummary, setIsDownloadingSummary] = useState(false);
  const [isPrintingSummary, setIsPrintingSummary] = useState(false);
  const [summaryWordSuccess, setSummaryWordSuccess] = useState(false);

  const [formData, setFormData] = useState({
    id: "",
    sbn_no: "",
    // SBN na nakita sa modal nung binuksan: pang-reference ng backend para malaman
    // kung talagang bago lang yung SBN (renewal) o display suffix lang ang diperensya.
    original_sbn_no: "",
    operator_name: "",
    address: "",
    motor_no: "",
    chassis_no: "",
    make: "",
    plate_no: "",
    route: safeRouteName,
    driving_route: "",
    issue_date: "",
    valid_until: ""
  })

  const searchInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success', action?: { label: string; onClick: () => void }) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type, action }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const executeDownloadWithGuard = (filename: string, action: () => void) => {
    if (downloadedFiles.has(filename)) {
      setPendingDownload({ name: filename, action });
      setDupModalOpen(true);
    } else {
      action();
      setDownloadedFiles(prev => new Set(prev).add(filename));
    }
  };

  const formatSafeDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "None";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const fetchMembersAndInfo = useCallback(async (): Promise<Member[]> => {
    if (!safeRouteName) return [];
    try {
      const [membersRes, infoRes] = await Promise.all([
        fetchWithAuth(`${API_URL}/franchise/route/${safeRouteName}`),
        fetchWithAuth(`${API_URL}/api/route-info/${safeRouteName}`)
      ]);
      
      let fetchedMembers: Member[] = [];
      
      if (membersRes.ok) {
        fetchedMembers = await membersRes.json();
        setMembers(prev => {
          if (prev.length !== fetchedMembers.length) return fetchedMembers;
          const isSame = prev.every((m, i) => {
            const n = fetchedMembers[i];
            return m.id === n.id &&
                   m.sbn_no === n.sbn_no &&
                   m.operator_name === n.operator_name &&
                   m.address === n.address &&
                   m.plate_no === n.plate_no &&
                   m.motor_no === n.motor_no &&
                   m.chassis_no === n.chassis_no &&
                   m.make === n.make &&
                   m.route === n.route &&
                   m.driving_route === n.driving_route &&
                   m.issue_date === n.issue_date &&
                   m.valid_until === n.valid_until &&
                   m.is_active === n.is_active;
          });
          return isSame ? prev : fetchedMembers;
        });
      } else {
        showToast("Failed to fetch route records.", "error");
      }

      if (infoRes.ok) {
        const newInfo = await infoRes.json();
        setRouteInfo(prev => JSON.stringify(prev) === JSON.stringify(newInfo) ? prev : newInfo);
      }
      
      return fetchedMembers;
    } catch (error) {
      console.error("Failed to fetch data", error)
      showToast("Connection problem. Is the PASADA program open on this computer?", "error")
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [safeRouteName, showToast])

  // UNDO AN EDIT — one shared action used by the success toast right after a
  // save AND by the per-entry button inside Record History. The server holds
  // the saved "before" values for that edit; this only points at its log id
  // and refreshes the list afterwards.
  const [revertingLogId, setRevertingLogId] = useState<string | null>(null)
  const handleRevertEdit = useCallback(async (recordId: string, logId: string) => {
    setRevertingLogId(logId);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/operators/${encodeURIComponent(recordId)}/revert/${encodeURIComponent(logId)}`, { method: "PUT" });
      // Read the body whatever the answer: refusals carry the plain-words
      // reason (e.g. "this SBN is now used by another record") and that is
      // exactly what the toast should say.
      let data: any = null;
      try { data = await res.json(); } catch { /* empty body is fine */ }
      if (res.ok) {
        showToast(data?.message || "Edit undone. The record is back to its values before that change.", "success");
        await fetchMembersAndInfo();
        // Keep the open History dialog honest: reload its entries so the
        // undone edit is followed by a visible "undid the edit" entry.
        try {
          const hres = await fetchWithAuth(`${API_URL}/logs/record/${encodeURIComponent(recordId)}`);
          if (hres.ok) setHistoryLogs(await hres.json());
        } catch { /* History refresh is best-effort */ }
      } else {
        showToast(data?.detail || "Could not undo that edit.", "error");
      }
    } catch {
      showToast("Network error while trying to undo the edit.", "error");
    } finally {
      setRevertingLogId(null);
    }
  }, [fetchMembersAndInfo, showToast])

  useEffect(() => {
    const initialLoadId = window.setTimeout(() => {
      void fetchMembersAndInfo();
    }, 0);
    const intervalId = setInterval(fetchMembersAndInfo, 15000); 

    return () => {
      window.clearTimeout(initialLoadId);
      clearInterval(intervalId);
    };
  }, [fetchMembersAndInfo])

  const handleOpenAdd = useCallback(() => {
    setFormData({
      id: "",
      sbn_no: "", // Left blank to allow backend auto-generation without conflict
      original_sbn_no: "", // wala pang existing SBN sa add
      operator_name: "",
      address: "",
      motor_no: "",
      chassis_no: "",
      make: "",
      plate_no: "",
      route: safeRouteName,
      driving_route: "",
      issue_date: "",
      valid_until: ""
    });
    setIsAddOpen(true);
  }, [safeRouteName]);

  const handleOpenRename = useCallback(() => {
    const currentPrefix = members.length > 0 && members[0].sbn_no ? members[0].sbn_no.split('-')[0] : "";
    setRenameData({
      new_route_name: safeRouteName,
      new_prefix: currentPrefix,
      new_driving_route: routeInfo?.dominant_route || ""
    });
    setIsRenameOpen(true);
  }, [members, safeRouteName, routeInfo]);

  useEffect(() => {
    const resetId = window.setTimeout(() => {
      setCurrentPage(1);
      setSelectedIds([]);
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [search, statusFilter, sortBy])

  // SPOTLIGHT: the record the office is currently working on (opened for
  // viewing/editing, or just saved) keeps a blue ring in the list, so after
  // closing a dialog it is obvious which row was touched even among
  // thousands. Clicking another row's action moves the ring there.
  const [spotlightId, setSpotlightId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isTyping = document.activeElement?.tagName === 'INPUT' || 
                       document.activeElement?.tagName === 'TEXTAREA' || 
                       document.activeElement?.tagName === 'SELECT' ||
                       (document.activeElement as HTMLElement)?.isContentEditable ||
                       document.activeElement?.getAttribute('role') === 'combobox' ||
                       document.activeElement?.getAttribute('role') === 'textbox';
                       
      const hasOpenModal = document.querySelector('[role="dialog"]') !== null;
      
      if (e.key === '/' && !isTyping && !hasOpenModal) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleOpenAdd();
      }
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setBatchModalOpen(true);
      }
      if (e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        handleExportMasterlist();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // handleExportMasterlist is recreated each render; re-binding the listener
    // on render is cheap and keeps its closure fresh.
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // NOTE: walang .toUpperCase() dito sa onChange. Dati kasi kapag nag-type ka ng
    // "dela" sa gitna ng pangalan, madi-dispatch yung toUpperCase() -> magbabago
    // yung value -> aksidente tatangalin ng React yung cursor position kaya dulo ng
    // text bagsak yung mga susunod na letra. Sa halip, ang uppercase ay inilalagay na
    // lang sa CSS (text-transform) para sa display at sa handleSubmitForm bago
    // mag-save, para hindi gumalaw yung cursor habang nagta-type.
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleOpenEdit = (member: Member) => {
    setActiveMember(member); 
    setSpotlightId(member.id);
    
    let safeAddress = member.address || "";
    if (safeAddress.toUpperCase().endsWith(", NAIC, CAVITE")) {
       safeAddress = safeAddress.substring(0, safeAddress.length - 14).trim();
    } else if (safeAddress.toUpperCase().endsWith("NAIC, CAVITE")) {
       safeAddress = safeAddress.substring(0, safeAddress.length - 12).trim();
    }
    if (safeAddress.endsWith(",")) safeAddress = safeAddress.slice(0, -1).trim();

    setFormData({
        ...member,
        address: safeAddress,
        route: safeRouteName,
      sbn_no: member.sbn_no,
      // Ipinapasa natin yung SBN na nakikita ng user sa modal para sa renewal
      // detection sa backend. Display suffix kasi (base + year) yung sa listahan,
      // hindi laging tugma sa naka-store na SBN lalo na sa mga backdated records.
      original_sbn_no: member.sbn_no,
      issue_date: member.issue_date ? member.issue_date.split('T')[0] : "",
      valid_until: member.valid_until ? member.valid_until.split('T')[0] : ""
    })
    setIsEditOpen(true)
  }

  const handleOpenView = (member: Member) => {
    setViewMember(member)
    setSpotlightId(member.id)
    setIsViewOpen(true)
  }

  const handleRefreshDatabase = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/refresh-db`, { method: "POST" });
      if (res.ok) {
        await fetchMembersAndInfo();
        showToast("Record check finished!", "success");
      } else {
        const err = await res.json();
        showToast(err.detail || "Could not finish the record check.", "error");
      }
    } catch {
      showToast("Connection problem. Is the PASADA program open on this computer?", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleOpenSummaryPreview = async () => {
    setIsSummaryOpen(true);
    setIsSummaryLoading(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/toda-summary`);
      if (res.ok) {
        setSummaryData(await res.json());
      } else {
        showToast("Failed to load summary data.", "error");
      }
    } catch (e) {
      showToast("Network error while loading summary.", "error");
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const handleDownloadSummaryWord = async () => {
    if (isDownloadingSummary || !summaryData) return;
    setIsDownloadingSummary(true);
    const filename = `TOTAL RENEWAL ${summaryData?.year || new Date().getFullYear()}.docx`;
    
    try {
      const response = await fetchWithAuth(`${API_URL}/toda-summary/download/word`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1000);
        
        setSummaryWordSuccess(true);
        showToast(`${filename} downloaded successfully.`, "success");
        setTimeout(() => setSummaryWordSuccess(false), 2000);
      } else {
        showToast("Failed to download Word document.", "error");
      }
    } catch (error) {
      showToast("Network error during download.", "error");
    } finally {
      setIsDownloadingSummary(false);
    }
  };

  const handlePrintSummaryPDF = async () => {
    if (isPrintingSummary || !summaryData) return;
    setIsPrintingSummary(true);
    
    try {
      const response = await fetchWithAuth(`${API_URL}/toda-summary/generate`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        if (blob.type === "application/pdf") {
          const existingIframe = document.getElementById('pasada-print-frame');
          if (existingIframe) document.body.removeChild(existingIframe);
          
          const iframe = document.createElement('iframe');
          iframe.id = 'pasada-print-frame';
          iframe.style.position = 'fixed';
          iframe.style.right = '-2000px';
          iframe.style.bottom = '-2000px';
          iframe.style.width = '500px';
          iframe.style.height = '500px';
          iframe.src = url;
          
          document.body.appendChild(iframe);
          
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (e) {
              console.error(e);
            }
            setIsPrintingSummary(false);
            showToast(`Print dialog opened for TODA Summary. REMINDER: Please ensure Scale is set to "Actual Size"!`, "success");
            setTimeout(() => window.URL.revokeObjectURL(url), 300000);
          }, 1500); 
        } else {
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `TOTAL RENEWAL ${summaryData?.year || new Date().getFullYear()}.docx`;
          document.body.appendChild(a);
          a.click();
          setIsPrintingSummary(false);
          showToast(`Downloaded fallback Word doc successfully.`, "success");
          setTimeout(() => document.body.removeChild(a), 100);
        }
      } else {
        setIsPrintingSummary(false);
        showToast("Print generation failed.", "error");
      }
    } catch (error) {
      setIsPrintingSummary(false);
      showToast("Network error during print generation.", "error");
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // uppercase sa submit na lang, hindi habang nagta-type (cursor jump fix)
    const renamePayload = {
      new_route_name: renameData.new_route_name.trim().toUpperCase(),
      new_prefix: renameData.new_prefix.trim().toUpperCase(),
      new_driving_route: renameData.new_driving_route.trim().toUpperCase()
    };
    const ok = await confirmDialog({
      mode: "confirm",
      title: `Rename ${safeRouteName} to ${renamePayload.new_route_name}`,
      message: "The whole registry is updated and all SBN prefixes are standardized. This is not easily undone.",
      confirmLabel: "Rename",
    });
    if (!ok) return;

    setIsRenaming(true);
    try {
      // Single-key rule (2026-10-14): the Admin's rename runs directly, but
      // the backend demands a written reason (400) first; we prompt once and
      // retry with it. A Clerk still files an approval ticket.
      let res = await fetchWithAuth(`${API_URL}/api/routes/${safeRouteName}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renamePayload)
      });
      if (res.status === 400) {
        const first = await res.json().catch(() => ({}));
        if (typeof first.detail === "string" && first.detail.includes("Type a short reason")) {
          const typed = await confirmDialog({
            mode: "prompt",
            title: "Reason required",
            message: "This rename runs right away, and the reason is written into the audit log.",
            fieldNote: "Shown in Activity History next to the rename.",
            confirmLabel: "Rename",
          });
          if (typeof typed !== "string" || !typed.trim()) {
            showToast("A reason is required: the rename was not done.", "error");
            return;
          }
          res = await fetchWithAuth(`${API_URL}/api/routes/${safeRouteName}/rename`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...renamePayload, override_reason: typed.trim() })
          });
        } else {
          showToast(first.detail || "Failed to rename route.", "error");
          return;
        }
      }
      
      if (res.ok) {
        const data = await res.json();
        if (data.status === "ticket_filed") {
          // Clerk path: the rename is only a request; the Admin decides.
          showToast(data.message || "Rename request sent for approval.", "success");
          setIsRenameOpen(false);
          return;
        }
        showToast(data.message, "success");
        setIsRenameOpen(false);
        window.dispatchEvent(new Event('toda_imported'));
        router.push(`/toda/${data.new_route}`);
      } else {
        const err = await res.json();
        showToast(err.detail || "Failed to rename route.", "error");
      }
    } catch (err) {
      showToast("Network error while renaming route.", "error");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeleteOne = async (member: Member) => {
    const ok = await confirmDialog({
      mode: "confirm",
      title: `Delete operator ${member.sbn_no}`,
      message: "The record moves to the Inactive list. The Undo button brings it back immediately.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    // 25010 Safety: if a batch-print selection is still processing, prune it
    // so the merged PDF never carries a certificate for a just-deleted record
    // (undo can restore the record, but the print bundle cannot be un-merged).
    setPendingBatchIds(prev => prev.filter(id => id !== member.id));
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/operators/${encodeURIComponent(member.id)}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedIds(prev => prev.filter(id => id !== member.id));
        setLastDeletedIds([member.id]);
        await fetchMembersAndInfo();
        showToast(`Operator ${member.sbn_no} deleted successfully.`, "success");
      } else {
        const err = await res.json();
        showToast(err.detail || "Failed to delete operator.", "error");
      }
    } catch {
      showToast("Network error while trying to delete operator.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const ok = await confirmDialog({
      mode: "confirm",
      title: `Delete ${selectedIds.length} selected operator${selectedIds.length === 1 ? "" : "s"}`,
      message: "The records move to the Inactive list. The Undo button brings them back immediately.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/operators/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sbn_list: selectedIds })
      });
      if (res.ok) {
        // 25010 Safety: prune deleted ids from a pending batch-print selection
        setPendingBatchIds(prev => prev.filter(id => !selectedIds.includes(id)));
        setLastDeletedIds(selectedIds);
        setSelectedIds([]);
        await fetchMembersAndInfo();
        showToast(`${selectedIds.length} operator(s) deleted successfully.`, "success");
      } else {
        const err = await res.json();
        showToast(err.detail || "Failed to delete selected operators.", "error");
      }
    } catch {
      showToast("Network error while deleting selected operators.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUndoDelete = async () => {
    setIsDeleting(true);
    try {
        for (const id of lastDeletedIds) {
            await fetchWithAuth(`${API_URL}/api/operators/${encodeURIComponent(id)}/restore`, { method: "POST" });
        }
        await fetchMembersAndInfo();
        showToast(`Restored ${lastDeletedIds.length} operator(s).`, "success");
        setLastDeletedIds([]);
    } catch (e) {
        showToast("Network error while trying to restore.", "error");
    } finally {
        setIsDeleting(false);
    }
  };

  const handleSelectAll = (checked: boolean, paginatedList: Member[]) => {
    if (checked) {
      const pageIds = paginatedList.map(m => m.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedList.map(m => m.id);
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => Array.from(new Set([...prev, id])));
    } else {
      setSelectedIds(prev => prev.filter(existingId => existingId !== id));
    }
  };

  const executeExport = async () => {
    setIsExporting(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/export/masterlist/${safeRouteName}?status_filter=${statusFilter}`);
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.style.display = 'none'
        a.href = url
        const filename = `${safeRouteName} ${new Date().getFullYear()} - ${statusFilter.toUpperCase()}.xlsx`;
        a.download = filename;
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          document.body.removeChild(a)
          window.URL.revokeObjectURL(url)
        }, 1000)
        
        setExportSuccess(true);
        showToast(`Masterlist exported successfully.`, "success");
        setTimeout(() => setExportSuccess(false), 2000);
      } else {
        // may case na 404 (walang tugma sa filter): bigyan ng mas malinaw na mensahe
        const err = await response.json().catch(() => ({}))
        showToast(err.detail || "Failed to export masterlist.", "error")
      }
    } catch {
      showToast("Network error while exporting.", "error")
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportMasterlist = () => {
    const filename = `${safeRouteName} ${new Date().getFullYear()} - ${statusFilter.toUpperCase()}.xlsx`;
    executeDownloadWithGuard(filename, executeExport);
  };

  const handleDownloadWord = (member: Member) => {
    if (isDownloadingId) return;
    const filename = `${member.sbn_no}.docx`;
    
    const action = async () => {
      setIsDownloadingId(member.id);
      try {
        const response = await fetchWithAuth(`${API_URL}/franchise/download/word/${member.id}`, { method: 'POST' });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          
          setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }, 1000);

          setWordSuccessId(member.id);
          showToast(`${filename} downloaded successfully.`, "success");
          setTimeout(() => setWordSuccessId(null), 2000);
        } else {
          showToast(`Failed to download ${filename}.`, "error");
        }
      } catch (error) {
        console.error("Download Error", error);
        showToast(`Network error downloading ${filename}.`, "error");
      } finally {
        setIsDownloadingId(null);
      }
    };

    executeDownloadWithGuard(filename, action);
  };

  const handleNativePrint = async (member: Member) => {
    if (isGeneratingId) return;
    setIsGeneratingId(member.id);

    try {
      const response = await fetchWithAuth(`${API_URL}/franchise/generate/${member.id}`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        if (blob.type === "application/pdf") {
          const existingIframe = document.getElementById('pasada-print-frame');
          if (existingIframe) document.body.removeChild(existingIframe);
          
          const iframe = document.createElement('iframe');
          iframe.id = 'pasada-print-frame';
          iframe.style.position = 'fixed';
          iframe.style.right = '-2000px';
          iframe.style.bottom = '-2000px';
          iframe.style.width = '500px';
          iframe.style.height = '500px';
          iframe.src = url;
          
          document.body.appendChild(iframe);
          
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (e) {
              console.error(e);
            }
            setIsGeneratingId(null);
            showToast(`Print dialog opened. REMINDER: Please ensure Scale is set to "Actual Size"!`, "success");
            setTimeout(() => window.URL.revokeObjectURL(url), 300000);
          }, 1500); 
        } else {
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `${member.sbn_no}.docx`;
          document.body.appendChild(a);
          a.click();
          setIsGeneratingId(null);
          showToast(`Downloaded fallback ${member.sbn_no}.docx successfully.`, "success");
          setTimeout(() => document.body.removeChild(a), 100);
        }
      } else {
        setIsGeneratingId(null);
        showToast("Print generation failed on the server.", "error");
      }
    } catch (error) {
      console.error(error);
      setIsGeneratingId(null);
      showToast("Network error during print generation.", "error");
    }
  };

  const printBatchDocument = async (member: Member): Promise<'printed' | 'downloaded' | 'failed'> => {
    try {
      const res = await fetchWithAuth(`${API_URL}/franchise/generate/${member.id}`, { method: 'POST' });
      if (!res.ok) {
        return 'failed';
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      
      if (blob.type === "application/pdf") {
        const existingIframe = document.getElementById('pasada-print-frame');
        if (existingIframe) document.body.removeChild(existingIframe);
        
        const iframe = document.createElement('iframe');
        iframe.id = 'pasada-print-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '-2000px';
        iframe.style.bottom = '-2000px';
        iframe.style.width = '500px';
        iframe.style.height = '500px';
        iframe.src = url;
        document.body.appendChild(iframe);
        
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (e) {
              console.error("Batch print error:", e);
            }
            setTimeout(() => {
              window.URL.revokeObjectURL(url);
              resolve();
            }, 1200);
          }, 1500);
        });
        return 'printed';
      } else {
        const a = document.createElement("a");
        a.style.display = 'none';
        a.href = url;
        a.download = `${member.sbn_no}.docx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 1000);
        return 'downloaded';
      }
    } catch (error) {
      console.error("Batch print failed", error);
      return 'failed';
    }
  };

  const executeBatchPrint = async () => {
    let targetRecords: Member[] = []
    
    if (batchScope === "THIS") {
      targetRecords = members;
    } else if (batchScope === "ALL") {
      try {
        const res = await fetchWithAuth(`${API_URL}/franchise/route/ALL`);
        if (res.ok) targetRecords = await res.json();
      } catch {
        showToast("Failed to fetch ALL records. Network Error.", "error");
      }
    } else if (batchScope === "CUSTOM" && customRoutes.length > 0) {
      try {
        const res = await fetchWithAuth(`${API_URL}/franchise/route/${customRoutes.join(',')}`);
        if (res.ok) targetRecords = await res.json();
      } catch {
        showToast("Failed to fetch Custom records. Network Error.", "error");
      }
    }

    if (targetRecords.length === 0) {
      showToast("No route records found for selected scope.", "error")
      return
    }
    
    const now = new Date()
    const todayString = getLocalDateString(now);
    
    const filteredTargetRecords = targetRecords.filter(record => {
      if (!record.issue_date) return false
      
      const recordDateObj = new Date(record.issue_date)
      if (isNaN(recordDateObj.getTime())) return false;
          
      const recordDateString = getLocalDateString(recordDateObj);
      const hour = recordDateObj.getHours()
      
      switch (batchFilterType) {
        case "TODAY_ALL":
          return recordDateString === todayString
        case "TODAY_MORNING":
          return recordDateString === todayString && hour >= 0 && hour < 12
        case "TODAY_AFTERNOON":
          return recordDateString === todayString && hour >= 12 && hour <= 23
        case "TODAY_SPECIFIC_HOUR":
          return recordDateString === todayString && hour === parseInt(batchSpecificHour)
        case "TODAY_HOUR_RANGE":
          return recordDateString === todayString && hour >= parseInt(batchStartHour) && hour <= parseInt(batchEndHour)
        case "SPECIFIC_DATE":
          return recordDateString === batchSpecificDate
        case "DATE_RANGE":
          return recordDateString >= batchStartDate && recordDateString <= batchEndDate
        default:
          return false
      }
    })
    
    if (filteredTargetRecords.length === 0) {
      showToast(`No records found for scope ${batchScope} with filter ${batchFilterType.replace('_', ' ')}.`, "error")
      return
    }
    
    // START NON-BLOCKING BACKGROUND GENERATION
    setBatchModalOpen(false);
    setIsBackgroundGenerating(true);
    setBgProgress({ current: 0, total: filteredTargetRecords.length });
    
    const recordIds = filteredTargetRecords.map(r => r.id);
    setPendingBatchIds(recordIds);

    try {
        const res = await fetchWithAuth(`${API_URL}/franchise/generate-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ record_ids: recordIds })
        });

        if (res.ok) {
            const blob = await res.blob();
            if (blob.type === "application/pdf") {
                setBgProgress({ current: filteredTargetRecords.length, total: filteredTargetRecords.length });
                const url = window.URL.createObjectURL(blob);
                setReadyPrintData({ url, count: filteredTargetRecords.length });
                setIsBackgroundGenerating(false);
                if (pendingBatchIds.length < recordIds.length) {
                    showToast(`${recordIds.length - pendingBatchIds.length} record(s) were deleted while the batch was generating and are not in the merged PDF.`, "error");
                }
                setPendingBatchIds([]);
                return;
            }
        }
    } catch (e) {
        console.error("Batch merge failed on server, falling back to sequential processing...");
    }
    
    // NON-BLOCKING SEQUENTIAL FALLBACK LOOP
    let printedCount = 0;
    let downloadedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < filteredTargetRecords.length; i++) {
      setBgProgress({ current: i + 1, total: filteredTargetRecords.length })
      const result = await printBatchDocument(filteredTargetRecords[i])
      
      if (result === 'printed') printedCount++; 
      else if (result === 'downloaded') downloadedCount++;
      else failedCount++;
    }

    setIsBackgroundGenerating(false);
    
    if (failedCount > 0) {
      showToast(`Batch fallback complete. Printed/Downloaded ${printedCount + downloadedCount}, Failed ${failedCount}.`, "error");
    } else {
      showToast(`Batch fallback complete. Exported ${printedCount + downloadedCount} documents.`, "success");
    }
  };

  const handleExecuteReadyPrint = async () => {
    if (!readyPrintData) return;
    const { url } = readyPrintData;
    
    const existingIframe = document.getElementById('pasada-print-frame');
    if (existingIframe) document.body.removeChild(existingIframe);
    
    const iframe = document.createElement('iframe');
    iframe.id = 'pasada-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '-2000px';
    iframe.style.bottom = '-2000px';
    iframe.style.width = '500px';
    iframe.style.height = '500px';
    iframe.src = url;
    document.body.appendChild(iframe);
    
    setTimeout(() => {
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } catch (e) {
            console.error("Batch print error:", e);
        }
        setTimeout(() => {
            window.URL.revokeObjectURL(url);
        }, 300000);
    }, 1500);

    setReadyPrintData(null);
  };

  const handleRequestRestore = async () => {
    if (!activeMember || !restoreStatus?.is_deleted) return;
    let reason: string | null = "";
    if (restoreStatus.current_role !== "Admin") {
      reason = (await confirmDialog({
        mode: "prompt",
        title: `Request restore — ${activeMember.sbn_no}`,
        message: "Tell the Admin why this record should come back. It goes to the Admin console for approval.",
        fieldNote: "Shown in Activity History next to the restore request.",
        confirmLabel: "Send request",
      })) as string | null;
      if (reason === null) return;
    } else {
      reason = (await confirmDialog({
        mode: "prompt",
        title: `Restore now — ${activeMember.sbn_no}`,
        message: "As Admin you can bring the record back immediately. A reason is recorded in the audit log.",
        confirmLabel: "Restore now",
      })) as string | null;
      if (reason === null) return;
    }
    setRestoreBusy(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/restore-records/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_ids: [activeMember.id], override_reason: reason || undefined, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Request failed");
      if (data.status === "success") {
        showToast(data.message || "Record restored.", "success");
        await fetchMembersAndInfo();
        setIsHistoryOpen(false);
      } else {
        // ticket_filed
        showToast(data.message || "Restore request sent for approval.", "success");
      }
      const st = await fetchWithAuth(`${API_URL}/tickets/for-record/${activeMember.id}`);
      if (st.ok) setRestoreStatus(await st.json());
    } catch (e: any) {
      showToast(e?.detail || e?.message || "Could not file the restore request.", "error");
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleOpenHistory = async (member: Member) => {
    setActiveMember(member)
    setSpotlightId(member.id)
    setRestoreStatus(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/logs/record/${member.id}`)
      if (res.ok) setHistoryLogs(await res.json())
      setIsHistoryOpen(true)
      // CHANGE 1: ask the backend whether this record is deleted and whether a
      // restore request is already pending for it, so the History dialog can
      // show the live "Request restore" affordance (or "Restore pending...").
      const st = await fetchWithAuth(`${API_URL}/tickets/for-record/${member.id}`)
      if (st.ok) setRestoreStatus(await st.json())
    } catch (error) {
      console.error("Failed to load history", error)
      showToast("Network error while fetching record history.", "error")
    }
  };

  const handleSubmitForm = async (e: React.FormEvent, isAdd: boolean) => {
    e.preventDefault()
    
    try {
      const finalDrivingRoute = formData.driving_route.trim() !== "" ? formData.driving_route : formData.route;
      
      const finalIssueDate = formData.issue_date;
      const finalValidUntil = formData.valid_until;

      // Dito lang inilalagay yung uppercase (sa save), hindi habang nagta-type.
      // Ganito rin sa ibang text fields para walang cursor jump sa gitna ng typing.
      const upperTrim = (s: string) => s.toUpperCase();

      let finalAddress = formData.address.trim().toUpperCase();
      if (finalAddress) {
          if (!finalAddress.endsWith("NAIC, CAVITE")) {
              finalAddress = finalAddress.endsWith(",") ? `${finalAddress} NAIC, CAVITE` : `${finalAddress}, NAIC, CAVITE`;
          }
      }

      const payload = { 
        ...formData, 
        address: finalAddress,
        sbn_no: upperTrim(formData.sbn_no.trim()),
        original_sbn_no: upperTrim((formData.original_sbn_no || "").trim()),
        operator_name: upperTrim(formData.operator_name.trim()),
        motor_no: upperTrim(formData.motor_no.trim()),
        chassis_no: upperTrim(formData.chassis_no.trim()),
        make: upperTrim(formData.make.trim()),
        plate_no: upperTrim(formData.plate_no.trim()),
        driving_route: upperTrim(finalDrivingRoute),
        issue_date: finalIssueDate,
        valid_until: finalValidUntil,
        route: safeRouteName
      }

      const autoMotorDate = localStorage.getItem("pasada_auto_change_motor_date");
      const autoMotorDateEnabled = resolveAutoChangeMotorDate(autoMotorDate);
      
      const endpointUrl = isAdd 
        ? `${API_URL}/api/operators` 
        : `${API_URL}/franchise/${formData.id}?auto_change_motor_date=${autoMotorDateEnabled}`;

      const response = await fetchWithAuth(endpointUrl, {
        method: isAdd ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      
      if (response.ok) {
        const data = await response.json();
        if (isAdd) {
          setIsAddOpen(false)
        } else {
          setIsEditOpen(false)
        }
        
        const refreshedList = await fetchMembersAndInfo();
        // Keep the saved record highlighted in the list after the dialogs close.
        setSpotlightId(formData.id || null);
        
        const returnedIssue = data.issue_date ? data.issue_date.split('T')[0] : "None";
        const returnedValid = data.valid_until ? data.valid_until.split('T')[0] : "None";
        const returnedSBN = data.sbn_no || payload.sbn_no;
        
        const showPreviewPref = localStorage.getItem("pasada_show_save_preview");
        const shouldShowPreview = showPreviewPref === null || showPreviewPref === "true";

        // UNDO-ON-SAVE: right after a successful EDIT, the toast offers a
        // one-click "Undo Changes". The server already saved the record's
        // pre-edit values inside the audit entry this edit just wrote, so we
        // only need the newest entry that carries one. Never blocks the save
        // flow — if the lookup fails the toast simply appears without it.
        let undoAction: { label: string; onClick: () => void } | undefined = undefined;
        if (!isAdd && formData.id) {
            try {
                const hres = await fetchWithAuth(`${API_URL}/logs/record/${encodeURIComponent(formData.id)}`);
                if (hres.ok) {
                    const logs: Array<{ id: string; before_values?: string | null }> = await hres.json();
                    const latestUndoable = logs.find(l => l.before_values);
                    if (latestUndoable) {
                        const targetId = formData.id, targetLog = latestUndoable.id;
                        undoAction = { label: "Undo Changes", onClick: () => { void handleRevertEdit(targetId, targetLog); } };
                    }
                }
            } catch { /* toast without undo */ }
        }

        if (shouldShowPreview) {
            showToast(`Record ${isAdd ? "added" : "updated"}. Date Issued: ${returnedIssue}, Valid until: ${returnedValid}, SBN: ${returnedSBN}.`, "success", undoAction);
            
            if (refreshedList && refreshedList.length > 0) {
                const savedRecord = refreshedList.find(m => m.sbn_no === returnedSBN);
                if (savedRecord) {
                    setViewMember(savedRecord);
                    setIsViewOpen(true);
                }
            }
        } else {
            showToast(`Saved SBN: ${returnedSBN}`, "success", undoAction);
        }
        
      } else {
        const err = await response.json()
        showToast(err.detail || "Failed to save record.", "error")
      }
    } catch {
      showToast("Network error while trying to save record. Please check your connection.", "error")
    }
  };

  const currentYear = new Date().getFullYear()

  // useMemo: with thousands of records, the filter and sort must not rerun on
  // unrelated state changes like opening a dialog or toggling a checkbox.
  const filteredMembers = useMemo(() => members.filter(m => {
    const issueYear = m.issue_date ? new Date(m.issue_date).getFullYear() : 0;
    const isVacant = !m.operator_name || m.operator_name.trim() === "";
    
    let computedStatus = "ACTIVE";
    if (isVacant) {
      computedStatus = "VACANT";
    } else if (m.is_active === false || issueYear <= currentYear - 2) {
      computedStatus = "REVOKED";
    } else if (issueYear === currentYear - 1) {
      computedStatus = "FLAGGED";
    }

    if (statusFilter !== "ALL" && computedStatus !== statusFilter) {
      return false;
    }

    const term = search.toLowerCase();
    return (
      String(m.operator_name || "").toLowerCase().includes(term) ||
      String(m.sbn_no || "").toLowerCase().includes(term) ||
      String(m.plate_no || "").toLowerCase().includes(term) ||
      String(m.motor_no || "").toLowerCase().includes(term) ||
      String(m.chassis_no || "").toLowerCase().includes(term) ||
      String(m.make || "").toLowerCase().includes(term)
    )
  }), [members, statusFilter, search, currentYear]);

  const sortedMembers = useMemo(() => [...filteredMembers].sort((a, b) => {
    if (sortBy === "SBN_ASC") {
      const matchA = a.sbn_no.match(/-(\d+)/);
      const matchB = b.sbn_no.match(/-(\d+)/);
      const numA = matchA ? parseInt(matchA[1], 10) : 999999;
      const numB = matchB ? parseInt(matchB[1], 10) : 999999;
      return numA - numB;
    }
    if (sortBy === "SBN_DESC") {
      const matchA = a.sbn_no.match(/-(\d+)/);
      const matchB = b.sbn_no.match(/-(\d+)/);
      const numA = matchA ? parseInt(matchA[1], 10) : 0;
      const numB = matchB ? parseInt(matchB[1], 10) : 0;
      return numB - numA;
    }
    if (sortBy === "NAME_ASC") {
      const nameA = a.operator_name || "zzz";
      const nameB = b.operator_name || "zzz";
      return nameA.localeCompare(nameB);
    }
    if (sortBy === "YEAR_NEWEST") {
      const dateA = a.issue_date ? new Date(a.issue_date).getTime() : 0;
      const dateB = b.issue_date ? new Date(b.issue_date).getTime() : 0;
      return dateB - dateA;
    }
    if (sortBy === "YEAR_OLDEST") {
      const dateA = a.issue_date ? new Date(a.issue_date).getTime() : 0;
      const dateB = b.issue_date ? new Date(b.issue_date).getTime() : 0;
      return dateA - dateB;
    }
    return 0;
  }), [filteredMembers, sortBy]);

  const totalPages = Math.ceil(sortedMembers.length / rowsPerPage);
  const paginatedMembers = sortedMembers.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const isAllPageSelected = paginatedMembers.length > 0 && paginatedMembers.every(m => selectedIds.includes(m.id));

  // DYNAMIC SUBTITLE LOGIC
  // Yung address line sa ilalim ng route name: buong opisyal na address dapat,
  // hindi yung dominant driving route lang. Yung mga "PAL.central" / "Tim.balsahan"
  // na ganap nang na-expand sa backend side, dito natin nilalagay ang kumpleto.
  const subtitleText = 
    ROUTE_FULL_ADDRESSES[safeRouteName] || 
    (routeInfo?.display_name ? routeInfo.display_name.replace(/^[A-Z0-9&]+TODA\s*\(?/, "").replace(/\)$/, "") : "\u00A0");

  const renderPagination = (position: 'top' | 'bottom') => (
    <div className={`flex flex-col sm:flex-row items-center justify-between px-6 py-4 bg-muted/10 border-border/60 ${position === 'top' ? 'border-b' : 'border-t'}`}>
      <div className="text-sm text-muted-foreground font-bold mb-4 sm:mb-0">
        Showing {filteredMembers.length === 0 ? 0 : ((currentPage - 1) * rowsPerPage) + 1} to {Math.min(currentPage * rowsPerPage, filteredMembers.length)} of {filteredMembers.length} records
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-muted-foreground">Rows per page:</span>
          <select
              value={rowsPerPage}
              onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
            className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.5rem_center] bg-[length:16px_16px] h-8 w-20 rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer pr-8"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || isLoading}>Previous</Button>
          <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0 || isLoading}>Next</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500 relative">
      
      {/* BACKGROUND GENERATION FLOATING UI */}
      {isBackgroundGenerating && (
          <div className="fixed bottom-24 right-6 z-[9998] bg-card border border-border shadow-2xl rounded-xl p-5 w-80 animate-in slide-in-from-bottom-4">
              <div className="flex items-center gap-3 mb-3">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  <h4 className="font-black text-sm tracking-tight">Preparing Batch Documents</h4>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5 mb-2.5 overflow-hidden shadow-inner relative">
                  <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{width: `${(bgProgress.current / bgProgress.total) * 100}%`}}></div>
              </div>
              <p className="text-xs text-muted-foreground font-bold">Processing {bgProgress.current} of {bgProgress.total}</p>
          </div>
      )}

      {/* PRINT READY FLOATING UI */}
      {readyPrintData && (
          <div className="fixed bottom-24 right-6 z-[9998] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 shadow-2xl rounded-xl p-5 w-80 animate-in slide-in-from-bottom-4">
              <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                      <h4 className="font-black text-sm text-emerald-900 dark:text-emerald-400">Print Ready</h4>
                  </div>
                  <button onClick={() => setReadyPrintData(null)} className="text-emerald-700 hover:text-emerald-900 transition-colors"><X size={16}/></button>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-500/80 font-bold mb-4 leading-snug">Your {readyPrintData.count} documents have been successfully merged into a single file.</p>
              <Button onClick={handleExecuteReadyPrint} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-10 shadow-md">
                  <Printer className="w-4 h-4 mr-2" /> Print Now ({readyPrintData.count})
              </Button>
          </div>
      )}

      {/* PAGE HEADER */}
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-6">
        
        <div className="shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">{safeRouteName}</h2>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={handleOpenRename} className="h-8 shadow-sm" data-tip="Change this TODA line's code name, and optionally give every SBN here the same prefix. Admin only.">
                <Edit3 className="h-3.5 w-3.5 mr-2" /> Rename
              </Button>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-sm md:text-base font-bold min-h-[24px]">
            {isLoading && !routeInfo ? "..." : subtitleText}
          </p>
        </div>
        
        <div className="flex flex-col gap-3 w-full xl:w-auto">
          {/* Row 1: Filters & Sorting */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
            <div className="relative flex-1 w-full sm:w-auto">
              <ArrowUpDown className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] bg-background text-foreground pl-10 pr-10 h-11 rounded-lg border border-border/60 text-sm font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="SBN_ASC">Sort: SBN (1 to 1000)</option>
                <option value="SBN_DESC">Sort: SBN (Highest First)</option>
                <option value="NAME_ASC">Sort: Name (A-Z)</option>
                <option value="YEAR_NEWEST">Sort: Renewal (Newest First)</option>
                <option value="YEAR_OLDEST">Sort: Renewal (Oldest First)</option>
              </select>
            </div>
            
            <div className="relative flex-1 w-full sm:w-auto">
              <Filter className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] bg-background text-foreground pl-10 pr-10 h-11 rounded-lg border border-border/60 text-sm font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="ALL">All Records</option>
                <option value="ACTIVE">Active Only</option>
                <option value="FLAGGED">1-Year Non-Renewal</option>
                <option value="REVOKED">2+ Years Non-Renewal</option>
                <option value="VACANT">Vacant Slots</option>
              </select>
            </div>

            <Button variant="outline" onClick={async () => { const ok = await confirmDialog({ mode: "confirm", title: "Check and clean the records", message: "All records are checked and the usual mistakes get fixed: wrong dates, misspelled route names, and duplicate entries. Nothing is deleted.", confirmLabel: "Start" }); if (ok) handleRefreshDatabase(); }} disabled={isRefreshing} className="w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-orange-600" data-tip-align-right data-tip="Checks every record on this line and fixes the usual mistakes: wrong dates, misspelled routes, duplicates. Nothing is deleted.">
              {isRefreshing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
              Refresh DB
            </Button>
          </div>

          {/* Row 2: Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:justify-end">
            <Button variant="outline" onClick={handleExportMasterlist} disabled={isExporting} className="flex-1 w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-emerald-600" data-tip="Downloads the current list as an Excel file. Only the records matching the status filter above are included. (Alt+E)">
              {isExporting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : exportSuccess ? <CheckCircle2 className="mr-2 h-5 w-5 text-emerald-500" /> : <Download className="mr-2 h-5 w-5" />}
              Export Excel
            </Button>
            
            <Button variant="outline" onClick={() => setBatchModalOpen(true)} className="flex-1 w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-blue-600" data-tip="Print many MTOP certificates at once: pick which TODAs and which dates, and they merge into one print job. (Alt+P)">
              <Printer className="mr-2 h-5 w-5" /> Batch Print
            </Button>
            
            {!isViewer && (
            <Button onClick={handleOpenAdd} className="flex-1 w-full sm:w-auto shadow-md hover:shadow-lg transition-all duration-300 h-11 px-6 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 text-white" data-tour="tour-add" data-tip="Registers a new operator on this line. Leave the name blank to keep the slot vacant. (Alt+N)">
              <PlusCircle className="mr-2 h-5 w-5" /> Add Operator
            </Button>
            )}
          </div>
        </div>
      </div>

      {/* BULK DELETE TOOLBAR */}
      {selectedIds.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center justify-between animate-in fade-in duration-300 shadow-sm">
          <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
            <CheckSquare className="h-5 w-5" />
            <span>{selectedIds.length} operator(s) selected</span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={isDeleting}
            className="font-bold shadow-sm"
          >
            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Delete Selected
          </Button>
        </div>
      )}

      {/* UNDO DELETED BANNER */}
      {lastDeletedIds.length > 0 && (
        <div className="bg-slate-900 text-slate-100 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 shadow-lg animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
                <ArchiveX className="text-slate-400" />
                <p className="text-sm font-medium">Deleted {lastDeletedIds.length} record(s).</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="outline" size="sm" onClick={() => setLastDeletedIds([])} className="flex-1 sm:flex-none text-slate-900 border-slate-700 hover:bg-slate-800 hover:text-white dark:bg-transparent dark:text-white">Dismiss</Button>
                <Button size="sm" onClick={handleUndoDelete} disabled={isDeleting} className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-500 text-white font-bold border-none shadow-sm">
                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Undo Delete"}
                </Button>
            </div>
        </div>
      )}

      {/* RENAME ROUTE MODAL */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-[500px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Edit3 className="h-6 w-6 text-blue-600" /> Rename Route
            </DialogTitle>
            <DialogDescription>
              Update the route name and optionally unify all SBN prefixes across records.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="font-semibold text-foreground">New TODA Code Name</Label>
              <Input 
                value={renameData.new_route_name} 
                onChange={(e) => setRenameData(prev => ({ ...prev, new_route_name: e.target.value }))} 
                className="h-11 font-bold bg-muted/40 uppercase focus:bg-background"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-foreground">Standardized SBN Prefix <span className="text-xs text-muted-foreground font-normal ml-2">(Optional)</span></Label>
              <Input 
                value={renameData.new_prefix} 
                onChange={(e) => setRenameData(prev => ({ ...prev, new_prefix: e.target.value }))} 
                placeholder="e.g. NP"
                className="h-11 font-bold font-mono bg-muted/40 uppercase focus:bg-background"
              />
              <p className="text-xs text-muted-foreground italic">This will unify all records in this line (e.g. NP-001).</p>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-foreground">Dominant Driving Route <span className="text-xs text-muted-foreground font-normal ml-2">(Optional)</span></Label>
              <Input 
                value={renameData.new_driving_route} 
                onChange={(e) => setRenameData(prev => ({ ...prev, new_driving_route: e.target.value }))} 
                placeholder="e.g. POBLACION"
                className="h-11 font-bold bg-muted/40 uppercase focus:bg-background"
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="submit" disabled={isRenaming} className="w-full h-11 text-md font-bold bg-blue-600 hover:bg-blue-700 text-white">
                {isRenaming ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Save className="h-5 w-5 mr-2" />} Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* TODA SUMMARY PREVIEW MODAL */}
      <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
        <DialogContent className="sm:max-w-[700px] shadow-2xl rounded-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6 text-blue-600" /> TODA Renewal Summary Preview
            </DialogTitle>
            <DialogDescription>
              Verify route counts before printing or downloading the official summary document.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {isSummaryLoading ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-sm font-bold text-muted-foreground animate-pulse">Calculating route totals...</p>
              </div>
            ) : summaryData ? (
              <div className="space-y-4">
                <div className="border rounded-xl overflow-hidden shadow-sm">
                  {/* Fixed layout + normal wrapping: the shadcn Table container
                      is overflow-x-auto with nowrap cells, which made this preview
                      scroll sideways on narrow windows. Locking column widths and
                      allowing wraps keeps the whole table visible with no h-scroll. */}
                  <Table className="[&_[data-slot=table]]:table-fixed [&_th]:whitespace-normal [&_td]:whitespace-normal [&_td]:[overflow-wrap:anywhere]">
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="font-bold w-12">#</TableHead>
                        <TableHead className="font-bold uppercase w-[36%]">TODA</TableHead>
                        <TableHead className="font-bold text-center uppercase w-[27%]">MEMBER PER TODA</TableHead>
                        <TableHead className="font-bold text-center text-emerald-600 uppercase w-[27%]">
                          RENEWAL AS OF <br /> {summaryData.as_of_date}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summaryData.rows.map((row: any, i: number) => (
                        <TableRow key={row.route}>
                          <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-bold">{row.route}</TableCell>
                          <TableCell className="font-mono text-center text-[15px]">{row.total}</TableCell>
                          <TableCell className="font-mono text-center font-bold text-emerald-600 text-[15px]">{row.renewed}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={2} className="font-black text-right pr-6 uppercase">TOTAL</TableCell>
                        <TableCell className="font-black font-mono text-center text-lg">{summaryData.grand_total}</TableCell>
                        <TableCell className="font-black font-mono text-center text-lg text-emerald-600">{summaryData.grand_renewed}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
                <p className="font-medium">Failed to load preview data.</p>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 pt-4 border-t">
            {summaryData && (
              <>
                <Button 
                  variant="outline" 
                  onClick={handleDownloadSummaryWord} 
                  disabled={isDownloadingSummary}
                  className="font-bold"
                >
                  {isDownloadingSummary ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
                  ) : summaryWordSuccess ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4 text-blue-600" />
                  )}
                  Download Word File
                </Button>
                <Button onClick={handlePrintSummaryPDF} disabled={isPrintingSummary} className="font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md">
                  {isPrintingSummary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                  Print PDF
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BATCH PRINT DIALOG */}
      <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
        <DialogContent className="sm:max-w-[500px] shadow-2xl rounded-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Printer className="h-6 w-6 text-blue-600" /> Print Documents
            </DialogTitle>
            <DialogDescription>
              Select scope and date filter for document batch printing.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* SCOPE SELECTOR */}
            <div className="space-y-3">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Shield size={14} /> Batch Scope
              </Label>
              <select
                value={batchScope}
                onChange={(e) => setBatchScope(e.target.value)}
                className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] flex h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer pr-10"
              >
                <option value="THIS">This TODA Only ({safeRouteName})</option>
                <option value="ALL">All TODAs</option>
                <option value="CUSTOM">Custom Selection</option>
              </select>
            </div>

            {/* CUSTOM ROUTE CHECKLIST */}
            {batchScope === "CUSTOM" && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select TODAs</Label>
                <div className="grid grid-cols-2 gap-2 p-3 border border-border rounded-lg bg-muted/10 max-h-48 overflow-y-auto">
                  {KNOWN_ROUTES.map(route => (
                    <label key={route} className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={customRoutes.includes(route)}
                        onChange={(e) => {
                          if (e.target.checked) setCustomRoutes(prev => [...prev, route]);
                          else setCustomRoutes(prev => prev.filter(r => r !== route));
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {route}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* DATE FILTER */}
            <div className="space-y-3">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Filter size={14} /> Date Filter
              </Label>
              <select
                value={batchFilterType}
                onChange={(e) => setBatchFilterType(e.target.value)}
                className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] flex h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer pr-10"
              >
                <option value="TODAY_ALL">Today - All Applications</option>
                <option value="TODAY_MORNING">Today - Morning (12AM - 11:59AM)</option>
                <option value="TODAY_AFTERNOON">Today - Afternoon (12PM - 11:59PM)</option>
                <option value="TODAY_SPECIFIC_HOUR">Today - Specific Hour</option>
                <option value="TODAY_HOUR_RANGE">Today - Hour Range</option>
                <option value="SPECIFIC_DATE">Single Date Selection</option>
                <option value="DATE_RANGE">Custom Date Range</option>
              </select>
            </div>

            {batchFilterType === "TODAY_SPECIFIC_HOUR" && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <Calendar size={14} /> Select Specific Hour
                    </Label>
                    <select
                        value={batchSpecificHour}
                        onChange={(e) => setBatchSpecificHour(e.target.value)}
                        className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] flex h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer pr-10"
                    >
                        {HOURS.map(h => <option key={h.val} value={h.val}>{h.label}</option>)}
                    </select>
                </div>
            )}

            {batchFilterType === "TODAY_HOUR_RANGE" && (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-3">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Calendar size={14} /> Start Hour
                        </Label>
                        <select
                            value={batchStartHour}
                            onChange={(e) => setBatchStartHour(e.target.value)}
                            className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] flex h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer pr-10"
                        >
                            {HOURS.map(h => <option key={`start-${h.val}`} value={h.val}>{h.label}</option>)}
                        </select>
                    </div>
                    <div className="space-y-3">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Calendar size={14} /> End Hour
                        </Label>
                        <select
                            value={batchEndHour}
                            onChange={(e) => setBatchEndHour(e.target.value)}
                            className="appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_1rem_center] bg-[length:16px_16px] flex h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer pr-10"
                        >
                            {HOURS.map(h => <option key={`end-${h.val}`} value={h.val}>{h.label}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {(batchFilterType === "TODAY_SPECIFIC_HOUR" || batchFilterType === "TODAY_HOUR_RANGE") && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900/50 mt-2">
                    * Note: Hour-level filtering only applies to records created directly in the app. Imported or manual-date records default to 12 AM.
                </p>
            )}

            {batchFilterType === "SPECIFIC_DATE" && (
              <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Calendar size={14} /> Select Date
                </Label>
                <Input 
                  type="date" 
                  value={batchSpecificDate} 
                  onChange={(e) => setBatchSpecificDate(e.target.value)} 
                  className="h-12 font-semibold"
                />
              </div>
            )}

            {batchFilterType === "DATE_RANGE" && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <div className="space-y-3">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Calendar size={14} /> Start Date
                  </Label>
                  <Input type="date" value={batchStartDate} onChange={(e) => setBatchStartDate(e.target.value)} className="h-12 font-semibold" />
                </div>
                <div className="space-y-3">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Calendar size={14} /> End Date
                  </Label>
                  <Input type="date" value={batchEndDate} onChange={(e) => setBatchEndDate(e.target.value)} className="h-12 font-semibold" />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4">
            <Button 
              onClick={executeBatchPrint}
              disabled={
                isBackgroundGenerating ||
                (batchFilterType === "SPECIFIC_DATE" && !batchSpecificDate) || 
                (batchFilterType === "DATE_RANGE" && (!batchStartDate || !batchEndDate)) ||
                (batchScope === "CUSTOM" && customRoutes.length === 0)
              }
              className="w-full h-12 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors text-white"
            >
              {isBackgroundGenerating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle className="mr-2 h-5 w-5" />} 
              {isBackgroundGenerating ? "Generating..." : "Start Batch Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD OPERATOR DIALOG */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Add New Operator</DialogTitle>
            <DialogDescription>Leave fields blank to register a vacant slot.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => handleSubmitForm(e, true)} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="font-semibold flex justify-between">SBN No. <span className="text-blue-500 font-normal italic text-xs">Auto-Generated</span></Label>
                <Input name="sbn_no" value={formData.sbn_no} onChange={handleInputChange} placeholder="Auto-assigned if blank" className="border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 font-mono text-lg font-bold shadow-inner h-11 w-full" />
              </div>
              <div className="space-y-2"><Label className="font-semibold">Plate No.</Label><Input name="plate_no" value={formData.plate_no} onChange={handleInputChange} placeholder="Leave blank if None" className="h-11 uppercase" /></div>
            </div>              <div className="space-y-2"><Label className="font-semibold">Operator Name</Label><Input name="operator_name" value={formData.operator_name} onChange={handleInputChange} placeholder="Leave blank for Vacant Slot" className="h-11 uppercase" /></div>
            <div className="space-y-2">
              <Label className="font-semibold flex justify-between items-center">
                <span>Barangay <span className="text-[10px] text-muted-foreground font-normal ml-1">(* , NAIC, CAVITE is auto-added)</span></span>
              </Label>
              <Input name="address" value={formData.address} onChange={handleInputChange} placeholder="e.g. BANCAAN" className="h-11 uppercase" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label className="font-semibold">Make</Label><Input name="make" value={formData.make} onChange={handleInputChange} placeholder="e.g. HONDA" className="uppercase" /></div>
               <div className="space-y-2"><Label className="font-semibold">Driving Route</Label><Input name="driving_route" value={formData.driving_route} onChange={handleInputChange} placeholder="Leave blank to inherit" className="uppercase" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="font-semibold">Motor No.</Label><Input name="motor_no" value={formData.motor_no} onChange={handleInputChange} placeholder="Optional" /></div>
              <div className="space-y-2"><Label className="font-semibold">Chassis No.</Label><Input name="chassis_no" value={formData.chassis_no} onChange={handleInputChange} placeholder="Optional" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between items-center">
                      <span>Issue Date <span className="text-blue-500 font-normal italic text-[10px] ml-1">Optional Override</span></span>
                      <button type="button" onClick={() => { const d = new Date(); setFormData({...formData, issue_date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')}) }} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-200 transition-colors font-bold shadow-sm cursor-pointer whitespace-nowrap">Set Today</button>
                    </Label>
                    <Input type="date" name="issue_date" value={formData.issue_date} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between items-center">
                      <span>Valid Until <span className="text-blue-500 font-normal italic text-[10px] ml-1">Optional Override</span></span>
                      <button type="button" onClick={() => setFormData({...formData, valid_until: `${currentYear}-12-31`})} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-200 transition-colors font-bold shadow-sm cursor-pointer whitespace-nowrap">Set Dec 31, {currentYear}</button>
                    </Label>
                    <Input type="date" name="valid_until" value={formData.valid_until} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 italic">* Dates auto-generate for Renewals. For Change Motor, auto-date can be toggled in Settings; otherwise use Set Today.</p>
            <DialogFooter className="pt-4">
              <Button type="submit" className="w-full h-11 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors shadow-md text-white">Save Operator</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT OPERATOR DIALOG */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Edit / Renew Operator</DialogTitle>
            <DialogDescription>Update record details or clear fields to set as Vacant.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => handleSubmitForm(e, false)} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="font-semibold flex justify-between">SBN No. <span className="text-blue-500 font-normal italic text-xs">Edit to Renew</span></Label>
                <Input name="sbn_no" value={formData.sbn_no} onChange={handleInputChange} className="border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 font-mono text-lg font-bold shadow-inner h-11 w-full" required />
              </div>
              <div className="space-y-2"><Label className="font-semibold">Plate No.</Label><Input name="plate_no" value={formData.plate_no} onChange={handleInputChange} placeholder="Leave blank if None" className="h-11 uppercase" /></div>
            </div>              <div className="space-y-2"><Label className="font-semibold">Operator Name</Label><Input name="operator_name" value={formData.operator_name} onChange={handleInputChange} placeholder="Leave blank for Vacant Slot" className="h-11 uppercase" /></div>
            <div className="space-y-2">
              <Label className="font-semibold flex justify-between items-center">
                <span>Barangay <span className="text-[10px] text-muted-foreground font-normal ml-1">(* , NAIC, CAVITE is auto-added)</span></span>
              </Label>
              <Input name="address" value={formData.address} onChange={handleInputChange} placeholder="e.g. BANCAAN" className="h-11 uppercase" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label className="font-semibold">Make</Label><Input name="make" value={formData.make} onChange={handleInputChange} placeholder="e.g. HONDA" className="uppercase" /></div>
               <div className="space-y-2"><Label className="font-semibold">Driving Route</Label><Input name="driving_route" value={formData.driving_route} onChange={handleInputChange} placeholder="Leave blank to inherit" className="uppercase" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="font-semibold">Motor No.</Label><Input name="motor_no" value={formData.motor_no} onChange={handleInputChange} placeholder="Optional" className="uppercase" /></div>
              <div className="space-y-2"><Label className="font-semibold">Chassis No.</Label><Input name="chassis_no" value={formData.chassis_no} onChange={handleInputChange} placeholder="Optional" className="uppercase" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between items-center">
                      <span>Issue Date <span className="text-blue-500 font-normal italic text-[10px] ml-1">Optional Override</span></span>
                      <button type="button" onClick={() => { const d = new Date(); setFormData({...formData, issue_date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')}) }} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-200 transition-colors font-bold shadow-sm cursor-pointer whitespace-nowrap">Set Today</button>
                    </Label>
                    <Input type="date" name="issue_date" value={formData.issue_date} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between items-center">
                      <span>Valid Until <span className="text-blue-500 font-normal italic text-[10px] ml-1">Optional Override</span></span>
                      <button type="button" onClick={() => setFormData({...formData, valid_until: `${currentYear}-12-31`})} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200 hover:bg-blue-200 transition-colors font-bold shadow-sm cursor-pointer whitespace-nowrap">Set Dec 31, {currentYear}</button>
                    </Label>
                    <Input type="date" name="valid_until" value={formData.valid_until} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 italic">* Dates auto-generate for Renewals. For Change Motor, auto-date can be toggled in Settings; otherwise use Set Today.</p>
            <DialogFooter className="pt-4">
              <Button type="submit" className="w-full h-11 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors shadow-md text-white">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* RECORD HISTORY DIALOG */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-hidden flex flex-col p-0 rounded-2xl shadow-2xl">
          <div className="p-6 bg-muted/30 border-b border-border/50 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2"><History className="h-5 w-5 text-blue-600" /> Record History</DialogTitle>
              <DialogDescription className="mt-1">Action history for <span className="font-bold text-foreground">{activeMember?.operator_name || "VACANT"}</span></DialogDescription>
            </DialogHeader>
            {/* CHANGE 1: RESTORE VIA HISTORY — a deleted record gets its way
                back from inside its own history. Admin restores directly with
                a reason; Clerk files a ticket; an open ticket shows "pending". */}
            {restoreStatus?.is_deleted && (
              <div className="mt-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-amber-800 dark:text-amber-300">This record is deleted.</p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/80 font-medium mt-0.5">
                    {restoreStatus.restore_requested
                      ? "A restore request is already waiting for approval."
                      : "Bring it back in the registry — or ask the Admin to."}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={restoreBusy || restoreStatus.restore_requested}
                  onClick={handleRequestRestore}
                  className="shrink-0 font-bold bg-blue-600 hover:bg-blue-700 text-white border-none shadow-sm"
                >
                  {restoreBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {restoreStatus.restore_requested ? "Restore pending approval" : restoreStatus.current_role === "Admin" ? "Restore now" : "Request Restore"}
                </Button>
              </div>
            )}
          </div>
          <div className="p-6 overflow-y-auto custom-scrollbar">
            <div className="space-y-6">
              {historyLogs.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center justify-center opacity-50">
                  <ArchiveX className="h-10 w-10 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No historical interactions recorded.</p>
                </div>
              ) : historyLogs.map((log) => (
                <div key={log.id} className="relative pl-6 pb-6 border-l-2 border-blue-500/30 last:border-0 last:pb-0">
                  <div className="absolute w-3.5 h-3.5 bg-blue-600 rounded-full -left-[8px] top-1 shadow-sm ring-4 ring-background" />
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{new Date(log.timestamp).toLocaleString()}</p>
                  <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    {log.action} <span className="font-normal text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded-full ml-2">by {log.clerk_name}</span>
                  </p>
                  <div className="mt-2.5 bg-muted/30 p-3 rounded-lg text-sm border border-border/40 text-foreground/80 leading-relaxed shadow-sm font-medium">
                    {log.details}
                  </div>
                  {/* UNDO PER EDIT: every entry that changed the record saved
                      its own "before" values on the server, so each one can be
                      undone on its own. Plain words, clear colors, no jargon. */}
                  {log.before_values && activeMember && (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revertingLogId === log.id}
                        onClick={() => { void handleRevertEdit(activeMember.id, log.id); }}
                        className="h-8 text-xs font-bold border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-800 dark:hover:text-amber-200"
                      >
                        {revertingLogId === log.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 mr-1.5" />}
                        Undo this edit
                      </Button>
                      <span className="text-[11px] text-muted-foreground font-medium text-right">Puts the record back to its values before this entry.</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* VIEW DOCUMENT PREVIEW MODAL */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-blue-600" /> MTOP Certificate Preview
            </DialogTitle>
            <DialogDescription>
              Verify operator details before printing or downloading the MTOP form.
            </DialogDescription>
          </DialogHeader>
          
          {viewMember && (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-muted/30 border border-border rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-muted-foreground uppercase">SBN Number</span>
                  <Badge variant="secondary" className="font-mono text-base font-bold">{viewMember.sbn_no}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Operator Name</span>
                  <span className="font-bold text-foreground text-sm">{viewMember.operator_name || "VACANT SLOT"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Address</span>
                  <span className="text-sm font-medium text-foreground text-right">{viewMember.address || "None"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Route Assignment</span>
                  <Badge className="font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {viewMember.driving_route || viewMember.route}
                  </Badge>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 p-4 bg-muted/30 border border-border rounded-xl text-sm">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase">Make / Brand</p>
                  <p className="font-bold mt-0.5">{viewMember.make || "None"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase">Plate Number</p>
                  <p className="font-mono font-bold mt-0.5">{viewMember.plate_no || "NO PLATE"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase">Motor Number</p>
                  <p className="font-mono font-bold mt-0.5">{viewMember.motor_no || "None"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase">Chassis Number</p>
                  <p className="font-mono font-bold mt-0.5">{viewMember.chassis_no || "None"}</p>
                </div>
              </div>

              <div className="flex justify-between items-center px-4 py-3 bg-muted/30 border border-border rounded-xl text-xs font-bold text-muted-foreground">
                <span>Last Renewal Date: <span className="text-foreground">{formatSafeDate(viewMember.issue_date)}</span></span>
                <span>Valid Until: <span className="text-foreground">{formatSafeDate(viewMember.valid_until)}</span></span>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:justify-end">
            {viewMember && (
              <>
                <Button 
                  variant="outline" 
                  onClick={() => handleDownloadWord(viewMember)} 
                  disabled={isDownloadingId === viewMember.id}
                  className="font-bold"
                >
                  {isDownloadingId === viewMember.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
                  ) : wordSuccessId === viewMember.id ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4 text-blue-600" />
                  )}
                  Download Word File
                </Button>
                <Button onClick={() => handleNativePrint(viewMember)} disabled={isGeneratingId === viewMember.id} className="font-bold bg-blue-600 hover:bg-blue-700 text-white">
                  {isGeneratingId === viewMember.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                  Print MTOP
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DUPLICATE DOWNLOAD GUARD MODAL */}
      <Dialog open={dupModalOpen} onOpenChange={setDupModalOpen}>
        <DialogContent className="sm:max-w-[400px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Download className="h-5 w-5 text-orange-500" /> Re-download File?
            </DialogTitle>
            <DialogDescription className="text-sm mt-2 font-medium">
              You have already downloaded <span className="font-bold text-foreground">"{pendingDownload?.name}"</span> during this session. Do you want to download it again?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => { setDupModalOpen(false); setPendingDownload(null); }} className="font-bold">
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (pendingDownload) pendingDownload.action();
                setDupModalOpen(false);
                setPendingDownload(null);
              }} 
              className="font-bold bg-blue-600 hover:bg-blue-700 text-white"
            >
              Download Again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OPERATOR LIST TABLE */}
      <Card
        className="shadow-sm border-border/60 rounded-2xl overflow-hidden bg-card"
        data-tour="records-tour"
      >
        <CardHeader className="bg-muted/10 pb-5 border-b border-border/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle
                className="text-xl font-bold flex items-center gap-2"
                data-tip="The full list of operators on this line. Use the search box to find one fast."
              ><FileSignature className="h-5 w-5 text-blue-600"/> Operator List</CardTitle>
              <CardDescription className="mt-1 font-medium">Total of {filteredMembers.length} operator records found.</CardDescription>
            </div>
            
            <div className="relative w-full md:w-[24rem]">
              <Input
                type="search"
                ref={searchInputRef}
                placeholder="Search Operator, SBN, Make... (Press '/' to focus)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 bg-muted/40 border-border/50 focus:bg-background rounded-lg shadow-sm font-medium"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {renderPagination('top')}
          <div className="overflow-x-auto min-h-[400px]">
            <Table>
              <TableHeader className="bg-muted/20 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 pl-6">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      onChange={(e) => handleSelectAll(e.target.checked, paginatedMembers)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </TableHead>
                  <TableHead className="font-bold text-muted-foreground w-[160px] h-12">SBN No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-64">Operator Profile</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-32">Plate No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Renewal Date</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-center font-bold text-muted-foreground w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  // PULSING SKELETON LOADER
                  Array.from({ length: Math.min(rowsPerPage, 10) }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="animate-pulse hover:bg-transparent">
                      <TableCell className="pl-6"><div className="w-4 h-4 bg-muted/60 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-20 bg-muted/60 rounded" /></TableCell>
                      <TableCell>
                        <div className="h-4 w-40 bg-muted/60 rounded mb-2" />
                        <div className="h-3 w-24 bg-muted/60 rounded" />
                      </TableCell>
                      <TableCell><div className="h-6 w-24 bg-muted/60 rounded-md" /></TableCell>
                      <TableCell><div className="h-4 w-24 bg-muted/60 rounded" /></TableCell>
                      <TableCell><div className="h-6 w-24 bg-muted/60 rounded-full" /></TableCell>
                      <TableCell>
                         <div className="flex justify-center gap-1">
                           <div className="h-8 w-8 bg-muted/60 rounded-md" />
                           <div className="h-8 w-8 bg-muted/60 rounded-md" />
                           <div className="h-8 w-8 bg-muted/60 rounded-md" />
                           <div className="h-8 w-8 bg-muted/60 rounded-md" />
                         </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : paginatedMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-64 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <ArchiveX className="h-10 w-10 mb-3 opacity-20" />
                        No records matched your search parameters.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMembers.map((member) => {
                    const issueYear = member.issue_date ? new Date(member.issue_date).getFullYear() : 0;
                    const isVacant = !member.operator_name || member.operator_name.trim() === "";
                    
                    // Status badges speak for themselves; no hover bubbles here
                    // (they poked out of the window and cluttered every row).
                    let rowColor = "hover:bg-muted/30 transition-colors duration-200";
                    let statusBadge = <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400 font-bold tracking-wide shadow-sm"><CheckCircle className="h-3 w-3 mr-1"/> Active</Badge>;
                    
                    if (isVacant) {
                      rowColor = "bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-100/80 dark:hover:bg-blue-900/30 transition-colors duration-200";
                      statusBadge = <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400 font-bold tracking-wide shadow-sm">VACANT</Badge>;
                    } else if (member.is_active === false || issueYear <= currentYear - 2) {
                      rowColor = "bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/80 dark:hover:bg-red-900/30 transition-colors duration-200";
                      statusBadge = <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400 font-bold tracking-wide shadow-sm"><XCircle className="h-3 w-3 mr-1"/> Revoked (2+ Yrs)</Badge>;
                    } else if (issueYear === currentYear - 1) {
                      rowColor = "bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/80 dark:hover:bg-amber-900/30 transition-colors duration-200";
                      statusBadge = <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400 font-bold tracking-wide shadow-sm"><AlertCircle className="h-3 w-3 mr-1"/> 1-Year Non-Renewal</Badge>;
                    }

                    const isSpotlit = spotlightId === member.id;
                    return (
                      <TableRow key={member.id} className={`${rowColor} border-b border-border/40 group ${isSpotlit ? "ring-2 ring-inset ring-blue-500 bg-blue-50/40 dark:bg-blue-950/30" : ""}`}>
                        <TableCell className="pl-6">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(member.id)}
                            onChange={(e) => handleSelectOne(member.id, e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </TableCell>
                        <TableCell className="font-mono font-bold text-[13px] text-foreground/90 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span>{member.sbn_no}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          {/* The name, address, and make show in full on hover
                              through the browser's own title attribute. */}
                          <div className="font-bold text-foreground truncate max-w-[220px]" title={member.operator_name || "Vacant slot: no operator assigned"}>
                            {member.operator_name || <span className="text-blue-600 italic">VACANT SLOT</span>}
                          </div>
                          {/* full address ni operator, hindi yung pa-shortcut version */}
                          {member.address && (
                            <div className="text-xs text-muted-foreground truncate max-w-[220px] mt-0.5 font-medium" title={member.address}>
                              {member.address}
                            </div>
                          )}
                          <div className={`text-xs truncate max-w-[220px] font-medium ${member.address ? "text-muted-foreground/70" : "text-muted-foreground mt-0.5"}`} title={member.make ? `Vehicle: ${member.make}` : "No vehicle info recorded"}>
                            {member.make || "No Vehicle Info"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {member.plate_no ? 
                               <Badge variant="secondary" className="font-mono tracking-widest shadow-sm bg-background/60 font-bold">{member.plate_no}</Badge> : 
                               <span className="text-muted-foreground/60 italic text-xs font-bold tracking-wide px-1">NO PLATE</span>
                          }
                        </TableCell>
                        <TableCell className="text-sm font-bold text-muted-foreground">
                          {isVacant ? "None" : formatSafeDate(member.issue_date)}
                        </TableCell>
                        <TableCell>{statusBadge}</TableCell>
                        <TableCell className="text-center" data-tour="tour-row-actions">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" aria-label="View Certificate Preview" data-tip-align-right data-tip="Opens the MTOP certificate preview for this operator, where you can print or download it." onClick={() => handleOpenView(member)}>
                              <Eye className="h-3.5 w-3.5 text-slate-700 dark:text-slate-200" />
                            </Button>
                            {!isViewer && (
                            <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" aria-label="Edit Operator" data-tip-align-right data-tip="Edit or renew this record. Editing the SBN counts as a renewal and updates the dates." onClick={() => handleOpenEdit(member)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            )}
                            <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" aria-label="Record History" data-tip-align-right data-tip="Every change ever recorded for this operator, with dates and who made them." onClick={() => handleOpenHistory(member)}>
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            {!isViewer && (
                            <Button 
                                 variant="outline" 
                                 size="icon" 
                                 disabled={isDeleting}
                              onClick={() => handleDeleteOne(member)}
                              className="h-8 w-8 bg-background/50 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-all hover:scale-105 border-border/60 shadow-sm" aria-label="Delete Operator" data-tip-align-right data-tip="Asks first, and the delete can still be undone right after."
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {renderPagination('bottom')}
        </CardContent>
      </Card>

      {/* CUSTOM TOAST CONTAINER */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-bold animate-in slide-in-from-right-8 fade-in duration-300 ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button onClick={toast.action.onClick} className="ml-2 font-black underline underline-offset-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded px-2 py-1 transition-colors shrink-0">
                {toast.action.label}
              </button>
            )}
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="ml-4 opacity-50 hover:opacity-100 transition-opacity shrink-0"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}