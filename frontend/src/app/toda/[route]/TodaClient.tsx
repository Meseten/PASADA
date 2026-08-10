"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { History, FileSignature, Edit, Printer, Search, PlusCircle, CheckCircle, XCircle, AlertCircle, ArchiveX, Loader2, Filter, Calendar, FileText, Download, Trash2, CheckSquare, Eye, Shield, RefreshCw, ArrowUpDown } from "lucide-react"
import { API_URL, fetchWithAuth, computeRecordStatus } from "@/lib/api"

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
}

export default function TodaClient() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const fallbackRoute = pathname?.split('/').pop()?.toUpperCase() || ""
  const safeRouteName = (params?.route as string)?.toUpperCase() || fallbackRoute
  
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sortBy, setSortBy] = useState("SBN_ASC")
  
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [viewMember, setViewMember] = useState<Member | null>(null)
  
  const [isGeneratingId, setIsGeneratingId] = useState<string | null>(null)
  const [isDownloadingId, setIsDownloadingId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  const [selectedSbns, setSelectedSbns] = useState<string[]>([])
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchFilterType, setBatchFilterType] = useState("TODAY_ALL")
  const [batchSpecificDate, setBatchSpecificDate] = useState("")
  const [batchStartDate, setBatchStartDate] = useState("")
  const [batchEndDate, setBatchEndDate] = useState("")
  const [batchPrinting, setBatchPrinting] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })
  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>([])
  const [activeMember, setActiveMember] = useState<Member | null>(null)
  
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(50)
  
  const [formData, setFormData] = useState({
    id: "",
    sbn_no: "",
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

  const formatSafeDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "None";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const fetchMembers = useCallback(async () => {
    if (!safeRouteName) return;
    try {
      const response = await fetchWithAuth(`${API_URL}/franchise/route/${safeRouteName}`);
      if (response.ok) {
        const data = await response.json()
        setMembers(data)
      }
    } catch (error) {
      console.error("Failed to fetch operators", error)
    }
  }, [safeRouteName])

  useEffect(() => {
    fetchMembers();
    const intervalId = setInterval(fetchMembers, 15000); 
    return () => clearInterval(intervalId);
  }, [fetchMembers])

  useEffect(() => {
    setCurrentPage(1)
    setSelectedSbns([])
  }, [search, statusFilter, sortBy])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isTyping = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'SELECT';
      
      if (e.key === '/' && !isTyping) {
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getNextSbnPreview = (route: string, list: Member[]): string => {
    let prefix = "";
    let maxNum = 0;
    let padding = 3;
    
    list.forEach(m => {
      const sbnStr = String(m.sbn_no || "").toUpperCase();
      const match = sbnStr.match(/^([A-Z0-9]+)[\-\_](\d+)/);
      if (match) {
        if (!prefix) prefix = match[1]; 
        const numStr = match[2];
        const val = parseInt(numStr, 10);
        if (!isNaN(val) && val > maxNum) {
          maxNum = val; 
        }
        if (numStr.length > padding) padding = numStr.length;
      }
    });

    if (!prefix) {
      const cleanRoute = route.replace(/TODA/g, '').trim();
      prefix = cleanRoute.length <= 4 ? cleanRoute : cleanRoute.substring(0, 3);
    }
    let nextNum = maxNum + 1;
    while (nextNum === 0 || String(nextNum).endsWith("000") || String(nextNum).endsWith("0000")) {
      nextNum += 1;
    }
    
    return `${prefix}-${String(nextNum).padStart(padding, '0')}`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isDate = e.target.name === "issue_date" || e.target.name === "valid_until";
    const val = isDate ? e.target.value : e.target.value.toUpperCase();
    setFormData({ ...formData, [e.target.name]: val })
  }

  const handleOpenAdd = () => {
    const nextSbn = getNextSbnPreview(safeRouteName, members);
    setFormData({ 
      id: "", 
      sbn_no: nextSbn, 
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
    setIsAddOpen(true)
  }

  const handleOpenEdit = (member: Member) => {
    setActiveMember(member); 
    setFormData({ 
      ...member, 
      route: safeRouteName,
      issue_date: member.issue_date ? member.issue_date.split('T')[0] : "",
      valid_until: member.valid_until ? member.valid_until.split('T')[0] : ""
    })
    setIsEditOpen(true)
  }

  const handleOpenView = (member: Member) => {
    setViewMember(member)
    setIsViewOpen(true)
  }

  const handleRefreshDatabase = async () => {
    const confirmRefresh = window.confirm("This will execute the self-healing protocol: cleaning ghost dates, fixing route names, and restoring tally accuracy. Continue?");
    if (!confirmRefresh) return;
    setIsRefreshing(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/admin/refresh-db`, { method: "POST" });
      if (res.ok) {
        const result = await res.json();
        alert(result.message || "Database refreshed successfully!");
        window.location.reload(); 
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to refresh database.");
      }
    } catch (err) {
      alert("Network error while trying to refresh the database.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteOne = async (member: Member) => {
    const confirmDelete = window.confirm(`Are you sure you want to delete operator ${member.sbn_no} (${member.operator_name || "VACANT"})?`);
    if (!confirmDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/operators/${encodeURIComponent(member.sbn_no)}`, { method: "DELETE" });
      if (res.ok) {
        const result = await res.json();
        alert(result.message || "Operator deleted successfully.");
        setSelectedSbns(prev => prev.filter(id => id !== member.sbn_no));
        window.location.reload(); 
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to delete operator.");
      }
    } catch (err) {
      alert("Network error while trying to delete operator.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSbns.length === 0) return;
    const confirmDelete = window.confirm(`Are you sure you want to delete ${selectedSbns.length} selected operator(s)? This action cannot be undone.`);
    if (!confirmDelete) return;
    
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/operators/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sbn_list: selectedSbns })
      });
      if (res.ok) {
        const result = await res.json();
        alert(result.message || `${selectedSbns.length} operator(s) deleted successfully.`);
        setSelectedSbns([]);
        window.location.reload(); 
      } else {
        const err = await res.json();
        alert(err.detail || "Failed to delete selected operators.");
      }
    } catch (err) {
      alert("Network error while deleting selected operators.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSelectAll = (checked: boolean, paginatedList: Member[]) => {
    if (checked) {
      const pageSbns = paginatedList.map(m => m.sbn_no);
      setSelectedSbns(prev => Array.from(new Set([...prev, ...pageSbns])));
    } else {
      const pageSbns = paginatedList.map(m => m.sbn_no);
      setSelectedSbns(prev => prev.filter(id => !pageSbns.includes(id)));
    }
  };

  const handleSelectOne = (sbn: string, checked: boolean) => {
    if (checked) {
      setSelectedSbns(prev => Array.from(new Set([...prev, sbn])));
    } else {
      setSelectedSbns(prev => prev.filter(id => id !== sbn));
    }
  };

  const handleExportMasterlist = async () => {
    setIsExporting(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/export/masterlist/${safeRouteName}?status_filter=${statusFilter}`);
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.style.display = 'none'
        a.href = url
        a.download = `${safeRouteName}_MASTERLIST_${new Date().getFullYear()}${statusFilter !== "ALL" ? `_${statusFilter}` : ""}.xlsx`
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          document.body.removeChild(a)
          window.URL.revokeObjectURL(url)
        }, 1000)
      } else {
        alert("Failed to export masterlist.")
      }
    } catch (error) {
      alert("Network error while exporting.")
    } finally {
      setIsExporting(false)
    }
  };

  const handleDownloadWord = async (member: Member) => {
    if (isDownloadingId) return;
    setIsDownloadingId(member.id);
    try {
      const response = await fetchWithAuth(`${API_URL}/franchise/download/word/${member.id}`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const safeName = String(member.operator_name || "VACANT").replace(/\s+/g, '_');
        a.download = `MTOP_${member.sbn_no}_${safeName}.docx`;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1000);
      }
    } catch (error) {
      console.error("Download Error", error);
    } finally {
      setIsDownloadingId(null);
    }
  };

  // BLAZING FAST NATIVE PRINT ENGINE - 100% BULLETPROOF IFRAME
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
          // DO NOT USE display: 'none' (Breaks Tauri Webviews)
          iframe.style.position = 'fixed';
          iframe.style.right = '0';
          iframe.style.bottom = '0';
          iframe.style.width = '2px';
          iframe.style.height = '2px';
          iframe.style.opacity = '0.01';
          iframe.style.pointerEvents = 'none';
          iframe.src = url;
          
          document.body.appendChild(iframe);
          
          // INSTANT EXECUTION: Bypass buggy OS onload events entirely
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (e) {
              console.error("Print dialog failed:", e);
            }
            setIsGeneratingId(null); // Clear spinner instantly
          }, 400); // 400ms delay ensures Blob is ready without freezing
          
        } else {
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `MTOP_${member.sbn_no}.docx`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 100);
          setIsGeneratingId(null);
        }
      } else {
         setIsGeneratingId(null);
      }
    } catch (error) {
      console.error(error);
      setIsGeneratingId(null);
    }
  };

  const downloadBatchDocument = async (member: Member) => {
    try {
      const res = await fetchWithAuth(`${API_URL}/franchise/generate/${member.id}`, { method: "POST" });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        
        if (blob.type === "application/pdf") {
          const iframe = document.createElement('iframe');
          iframe.style.position = 'fixed';
          iframe.style.right = '0';
          iframe.style.bottom = '0';
          iframe.style.width = '2px';
          iframe.style.height = '2px';
          iframe.style.opacity = '0.01';
          iframe.style.pointerEvents = 'none';
          iframe.src = url;
          document.body.appendChild(iframe);
          
          return new Promise<void>((resolve) => {
             // INSTANT BATCH EXECUTION: No more infinite hangs
             setTimeout(() => {
                try {
                  iframe.contentWindow?.focus();
                  iframe.contentWindow?.print();
                } catch (e) {
                  console.error(e);
                }
                setTimeout(() => {
                  window.URL.revokeObjectURL(url);
                  if (iframe.parentNode) document.body.removeChild(iframe);
                  resolve();
                }, 1000); // Wait 1 second before moving to next batch item
              }, 400); 
          });
        } else {
          const a = document.createElement("a");
          a.style.display = 'none';
          a.href = url;
          a.download = `MTOP_${String(member.operator_name || "VACANT").replace(/\s+/g, '_')}.docx`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
          }, 1000);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const executeBatchPrint = async () => {
    setBatchPrinting(true)
    let targetRecords: Member[] = []
    
    const now = new Date()
    const todayString = now.toISOString().split('T')[0]
    
    targetRecords = members.filter(record => {
      if (!record.issue_date) return false
      
      const recordDateObj = new Date(record.issue_date)
      if (isNaN(recordDateObj.getTime())) return false; 
      
      const recordDateString = recordDateObj.toISOString().split('T')[0]
      const hour = recordDateObj.getHours()
      
      switch (batchFilterType) {
        case "TODAY_ALL":
          return recordDateString === todayString
        case "TODAY_MORNING":
          return recordDateString === todayString && hour >= 0 && hour < 12
        case "TODAY_AFTERNOON":
          return recordDateString === todayString && hour >= 12 && hour <= 23
        case "SPECIFIC_DATE":
          return recordDateString === batchSpecificDate
        case "DATE_RANGE":
          return recordDateString >= batchStartDate && recordDateString <= batchEndDate
        default:
          return false
      }
    })
    
    if (targetRecords.length === 0) {
      alert("No records found for the selected date filter.")
      setBatchPrinting(false)
      return
    }
    
    setBatchProgress({ current: 0, total: targetRecords.length })
    for (let i = 0; i < targetRecords.length; i++) {
      setBatchProgress({ current: i + 1, total: targetRecords.length })
      await downloadBatchDocument(targetRecords[i])
      await new Promise(resolve => setTimeout(resolve, 800))
    }
    setBatchPrinting(false)
    setBatchModalOpen(false)
    setBatchProgress({ current: 0, total: 0 })
  };

  const handleOpenHistory = async (member: Member) => {
    setActiveMember(member)
    try {
      const res = await fetchWithAuth(`${API_URL}/logs/record/${member.id}`)
      if (res.ok) setHistoryLogs(await res.json())
      setIsHistoryOpen(true)
    } catch (e) {}
  };

  const handleSubmitForm = async (e: React.FormEvent, isAdd: boolean) => {
    e.preventDefault()
    
    try {
      const finalDrivingRoute = formData.driving_route.trim() !== "" ? formData.driving_route : formData.route;
      
      let finalIssueDate = formData.issue_date;
      let finalValidUntil = formData.valid_until;
      
      if (!isAdd && activeMember) {
        const origIssue = activeMember.issue_date ? activeMember.issue_date.split('T')[0] : "";
        const origValid = activeMember.valid_until ? activeMember.valid_until.split('T')[0] : "";
        
        if (finalIssueDate === origIssue) finalIssueDate = "";
        if (finalValidUntil === origValid) finalValidUntil = "";
      }

      const payload = { 
        ...formData, 
        issue_date: finalIssueDate,
        valid_until: finalValidUntil,
        driving_route: finalDrivingRoute, 
        route: safeRouteName 
      }
      
      const response = await fetchWithAuth(isAdd ? `${API_URL}/api/operators` : `${API_URL}/franchise/${formData.id}`, {
        method: isAdd ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      
      if (response.ok) {
        isAdd ? setIsAddOpen(false) : setIsEditOpen(false)
        window.location.reload();
      } else {
        const err = await response.json()
        alert(err.detail || "Failed to save record.")
      }
    } catch (error) {
      alert("Network error while trying to save record.")
    }
  };

  const currentYear = new Date().getFullYear()

  const filteredMembers = members.filter(m => {
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
  });

  const sortedMembers = [...filteredMembers].sort((a, b) => {
    if (sortBy === "SBN_ASC") {
      const numA = parseInt((a.sbn_no.match(/\d+/) || ["999999"])[0], 10);
      const numB = parseInt((b.sbn_no.match(/\d+/) || ["999999"])[0], 10);
      return numA - numB;
    }
    if (sortBy === "SBN_DESC") {
      const numA = parseInt((a.sbn_no.match(/\d+/) || ["0"])[0], 10);
      const numB = parseInt((b.sbn_no.match(/\d+/) || ["0"])[0], 10);
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
  });

  const totalPages = Math.ceil(sortedMembers.length / rowsPerPage);
  const paginatedMembers = sortedMembers.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  
  const isAllPageSelected = paginatedMembers.length > 0 && paginatedMembers.every(m => selectedSbns.includes(m.sbn_no));

  if (!safeRouteName) {
    return (
      <div className="p-8 text-muted-foreground flex items-center gap-3 h-full text-lg font-medium">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" /> Loading Route Records...
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500">
      
      {/* PAGE HEADER - Responsive Full-Width Layout */}
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-6">
        
        {/* Title Area */}
        <div className="shrink-0">
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">{safeRouteName}</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Tricycle Operators and Drivers Association Route Registry
          </p>
        </div>
        
        {/* Controls Area */}
        <div className="flex flex-col gap-3 w-full xl:w-auto">
          
          {/* Row 1: Filters & Sorting - Full Width Expansion */}
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

            <Button variant="outline" onClick={handleRefreshDatabase} disabled={isRefreshing} className="w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-orange-600" title="Self-Heal Database">
              {isRefreshing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <RefreshCw className="mr-2 h-5 w-5" />}
              Refresh DB
            </Button>
          </div>

          {/* Row 2: Actions - Full Width Expansion */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full xl:justify-end">
            <Button variant="outline" onClick={handleExportMasterlist} disabled={isExporting} className="flex-1 w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-emerald-600">
              {isExporting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
              Export Excel
            </Button>
            
            <Button variant="outline" onClick={() => setBatchModalOpen(true)} className="flex-1 w-full sm:w-auto shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-blue-600" title="Alt + P">
              <Printer className="mr-2 h-5 w-5" /> Batch Print
            </Button>
            
            <Button onClick={handleOpenAdd} className="flex-1 w-full sm:w-auto shadow-md hover:shadow-lg transition-all duration-300 h-11 px-6 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 text-white" title="Alt + N">
              <PlusCircle className="mr-2 h-5 w-5" /> Add Operator
            </Button>
          </div>
          
        </div>
      </div>

      {/* BULK DELETE TOOLBAR */}
      {selectedSbns.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center justify-between animate-in fade-in duration-300 shadow-sm">
          <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
            <CheckSquare className="h-5 w-5" />
            <span>{selectedSbns.length} operator(s) selected</span>
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
                <Button variant="outline" onClick={() => handleDownloadWord(viewMember)} className="font-bold">
                  <FileText className="mr-2 h-4 w-4 text-blue-600" /> Download Word File
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

      {/* BATCH PRINT DIALOG */}
      <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
        <DialogContent className="sm:max-w-[500px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Printer className="h-6 w-6 text-blue-600" /> Print Documents
            </DialogTitle>
            <DialogDescription>
              Select date filter for document printing.
            </DialogDescription>
          </DialogHeader>
          
          {batchPrinting ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-6 text-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              <div className="space-y-2 w-full">
                <p className="font-bold text-lg">Preparing Documents</p>
                <p className="text-sm text-muted-foreground font-medium">
                  Opening print dialog {batchProgress.current} of {batchProgress.total}...
                </p>
                <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-3 mt-4 overflow-hidden shadow-inner">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${Math.max((batchProgress.current / batchProgress.total) * 100, 5)}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 mt-4">
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
                  <option value="SPECIFIC_DATE">Single Date Selection</option>
                  <option value="DATE_RANGE">Custom Date Range</option>
                </select>
              </div>

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
          )}

          {!batchPrinting && (
            <DialogFooter className="pt-4">
              <Button 
                onClick={executeBatchPrint}
                disabled={
                  (batchFilterType === "SPECIFIC_DATE" && !batchSpecificDate) || 
                  (batchFilterType === "DATE_RANGE" && (!batchStartDate || !batchEndDate))
                }
                className="w-full h-12 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors text-white"
              >
                <CheckCircle className="mr-2 h-5 w-5" /> Start Batch Print
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* ADD OPERATOR DIALOG */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Add Operator / Slot</DialogTitle>
            <DialogDescription>Leave fields blank to register a vacant slot.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => handleSubmitForm(e, true)} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="font-semibold flex justify-between">
                  SBN No. <span className="text-xs text-blue-600 font-normal">(Auto-Generated)</span>
                </Label>
                <Input 
                  name="sbn_no" 
                  value={formData.sbn_no} 
                  onChange={handleInputChange} 
                  placeholder="Auto-assigned if blank"
                  className="font-mono bg-background border-border/50 shadow-inner h-11 font-bold" 
                />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold">Plate No.</Label>
                <Input name="plate_no" value={formData.plate_no} onChange={handleInputChange} placeholder="Leave blank if None" className="h-11" />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="font-semibold">Operator Name</Label>
              <Input name="operator_name" value={formData.operator_name} onChange={handleInputChange} placeholder="Leave blank for Vacant Slot" className="h-11" />
            </div>
            
            <div className="space-y-2">
              <Label className="font-semibold">Address</Label>
              <Input name="address" value={formData.address} onChange={handleInputChange} placeholder="Leave blank if Unknown" className="h-11" />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label className="font-semibold">Make</Label><Input name="make" value={formData.make} onChange={handleInputChange} placeholder="e.g. HONDA" /></div>
               <div className="space-y-2"><Label className="font-semibold">Driving Route</Label><Input name="driving_route" value={formData.driving_route} onChange={handleInputChange} placeholder="Leave blank to inherit" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="font-semibold">Motor No.</Label><Input name="motor_no" value={formData.motor_no} onChange={handleInputChange} placeholder="Optional" /></div>
              <div className="space-y-2"><Label className="font-semibold">Chassis No.</Label><Input name="chassis_no" value={formData.chassis_no} onChange={handleInputChange} placeholder="Optional" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between">Issue Date <span className="text-blue-500 font-normal italic text-xs">Optional Override</span></Label>
                    <Input type="date" name="issue_date" value={formData.issue_date} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between">Valid Until <span className="text-blue-500 font-normal italic text-xs">Optional Override</span></Label>
                    <Input type="date" name="valid_until" value={formData.valid_until} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 italic">* Leave dates blank to auto-generate for Renewals & Change Motor.</p>

            <DialogFooter className="pt-4">
              <Button type="submit" className="w-full h-11 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors text-white">Save Operator</Button>
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
              <div className="space-y-2"><Label className="font-semibold">Plate No.</Label><Input name="plate_no" value={formData.plate_no} onChange={handleInputChange} placeholder="Leave blank if None" className="h-11" /></div>
            </div>
            
            <div className="space-y-2"><Label className="font-semibold">Operator Name</Label><Input name="operator_name" value={formData.operator_name} onChange={handleInputChange} placeholder="Leave blank for Vacant Slot" className="h-11" /></div>
            <div className="space-y-2"><Label className="font-semibold">Address</Label><Input name="address" value={formData.address} onChange={handleInputChange} placeholder="Leave blank if Unknown" className="h-11" /></div>
            
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label className="font-semibold">Make</Label><Input name="make" value={formData.make} onChange={handleInputChange} placeholder="e.g. HONDA" /></div>
               <div className="space-y-2"><Label className="font-semibold">Driving Route</Label><Input name="driving_route" value={formData.driving_route} onChange={handleInputChange} placeholder="Leave blank to inherit" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="font-semibold">Motor No.</Label><Input name="motor_no" value={formData.motor_no} onChange={handleInputChange} placeholder="Optional" /></div>
              <div className="space-y-2"><Label className="font-semibold">Chassis No.</Label><Input name="chassis_no" value={formData.chassis_no} onChange={handleInputChange} placeholder="Optional" /></div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between">Issue Date <span className="text-blue-500 font-normal italic text-xs">Optional Override</span></Label>
                    <Input type="date" name="issue_date" value={formData.issue_date} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
                <div className="space-y-2">
                    <Label className="font-semibold flex justify-between">Valid Until <span className="text-blue-500 font-normal italic text-xs">Optional Override</span></Label>
                    <Input type="date" name="valid_until" value={formData.valid_until} onChange={handleInputChange} className="h-11 bg-background text-foreground" />
                </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 italic">* Leave dates blank to auto-generate for Renewals & Change Motor.</p>

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
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* OPERATOR LIST TABLE */}
      <Card className="shadow-sm border-border/60 rounded-2xl overflow-hidden bg-card">
        <CardHeader className="bg-muted/10 pb-5 border-b border-border/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2"><FileSignature className="h-5 w-5 text-blue-600"/> Operator List</CardTitle>
              <CardDescription className="mt-1 font-medium">Total of {filteredMembers.length} operator records found.</CardDescription>
            </div>
            
            <div className="relative w-full md:w-96 group">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-blue-600 transition-colors" />
              <Input
                ref={searchInputRef}
                placeholder="Search Operator, SBN, Make... (Press '/' to focus)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-10 bg-muted/40 border-border/50 focus:bg-background transition-all rounded-lg shadow-sm font-medium"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                {paginatedMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <ArchiveX className="h-8 w-8 mb-2 opacity-20" />
                        No records matched your search parameters.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMembers.map((member) => {
                    const issueYear = member.issue_date ? new Date(member.issue_date).getFullYear() : 0;
                    const isVacant = !member.operator_name || member.operator_name.trim() === "";
                    
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

                    return (
                      <TableRow key={member.id} className={`${rowColor} border-b border-border/40 group`}>
                        <TableCell className="pl-6">
                          <input
                            type="checkbox"
                            checked={selectedSbns.includes(member.sbn_no)}
                            onChange={(e) => handleSelectOne(member.sbn_no, e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </TableCell>
                        <TableCell className="font-mono font-bold text-[13px] text-foreground/90 whitespace-nowrap">{member.sbn_no}</TableCell>
                        <TableCell className="py-3">
                          <div className="font-bold text-foreground truncate max-w-[200px]" title={member.operator_name || "VACANT"}>
                            {member.operator_name || <span className="text-blue-600 italic">VACANT SLOT</span>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5 font-medium" title={member.make}>
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
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" title="View Certificate Preview" onClick={() => handleOpenView(member)}>
                              <Eye className="h-3.5 w-3.5 text-slate-700 dark:text-slate-200" />
                            </Button>
                            <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" title="Edit Operator" onClick={() => handleOpenEdit(member)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" title="Record History" onClick={() => handleOpenHistory(member)}>
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            <Button 
                                variant="outline" 
                                size="icon" 
                                disabled={isDeleting}
                              onClick={() => handleDeleteOne(member)}
                              className="h-8 w-8 bg-background/50 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-all hover:scale-105 border-border/60 shadow-sm" 
                                title="Delete Operator"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* PAGINATION FOOTER */}
          <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-border/60 bg-muted/10">
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
                <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
                <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0}>Next</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}