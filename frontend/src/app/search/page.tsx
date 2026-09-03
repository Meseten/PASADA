"use client"

import { useState, useEffect, useCallback, Suspense, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search, ArchiveX, Loader2, CheckCircle, XCircle, AlertCircle, Globe, Edit, Printer, History, Eye, Trash2, Shield, FileText, CheckCircle2, X, Download } from "lucide-react"
import { API_URL, fetchWithAuth } from "@/lib/api"

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

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

function GlobalSearchClient() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState(initialQuery)
  const [deferredSearch, setDeferredSearch] = useState(initialQuery)

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [viewMember, setViewMember] = useState<Member | null>(null)
  const [activeMember, setActiveMember] = useState<Member | null>(null)
  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>([])
  
  const [isGeneratingId, setIsGeneratingId] = useState<string | null>(null)
  const [isDownloadingId, setIsDownloadingId] = useState<string | null>(null)
  const [wordSuccessId, setWordSuccessId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [downloadedFiles, setDownloadedFiles] = useState<Set<string>>(new Set())
  const [dupModalOpen, setDupModalOpen] = useState(false)
  const [pendingDownload, setPendingDownload] = useState<{name: string, action: () => void} | null>(null)

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
    route: "",
    driving_route: "",
    issue_date: "",
    valid_until: ""
  })

  const currentYear = new Date().getFullYear()

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
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

  const fetchGlobalMembers = useCallback(async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/franchise/route/ALL`);
      if (response.ok) {
        setMembers(await response.json());
      }
    } catch (error) {
      console.error("Global fetch error", error)
    } finally {
      setIsLoading(false);
    }
  }, [])

  useEffect(() => {
    fetchGlobalMembers();
  }, [fetchGlobalMembers]);

  // Debounce typing to prevent screen lag
  useEffect(() => {
    const handler = setTimeout(() => {
      setDeferredSearch(search);
      setCurrentPage(1); // Reset to page 1 on new search
    }, 250);
    return () => clearTimeout(handler);
  }, [search]);

  const formatSafeDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "None";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const filteredMembers = useMemo(() => {
    const term = deferredSearch.toLowerCase();
    if (!term) return []; 
    return members.filter(m => {
      return (
        String(m.operator_name || "").toLowerCase().includes(term) ||
        String(m.sbn_no || "").toLowerCase().includes(term) ||
        String(m.plate_no || "").toLowerCase().includes(term) ||
        String(m.route || "").toLowerCase().includes(term) ||
        String(m.motor_no || "").toLowerCase().includes(term) ||
        String(m.chassis_no || "").toLowerCase().includes(term) ||
        String(m.make || "").toLowerCase().includes(term)
      )
    })
  }, [members, deferredSearch]);

  // Apply Pagination
  const totalPages = Math.ceil(filteredMembers.length / rowsPerPage);
  const paginatedMembers = filteredMembers.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isDate = e.target.name === "issue_date" || e.target.name === "valid_until";
    const val = isDate ? e.target.value : e.target.value.toUpperCase();
    setFormData({ ...formData, [e.target.name]: val })
  }

  const handleOpenEdit = (member: Member) => {
    setActiveMember(member); 
    setFormData({
        ...member,
      issue_date: member.issue_date ? member.issue_date.split('T')[0] : "",
      valid_until: member.valid_until ? member.valid_until.split('T')[0] : ""
    })
    setIsEditOpen(true)
  }

  const handleOpenView = (member: Member) => {
    setViewMember(member)
    setIsViewOpen(true)
  }

  const handleOpenHistory = async (member: Member) => {
    setActiveMember(member)
    try {
      const res = await fetchWithAuth(`${API_URL}/logs/record/${member.id}`)
      if (res.ok) setHistoryLogs(await res.json())
      setIsHistoryOpen(true)
    } catch (error) {
      console.error("Failed to load history", error)
      showToast("Network error while fetching record history.", "error")
    }
  };

  const handleDeleteOne = async (member: Member) => {
    if (!window.confirm(`Are you sure you want to delete SBN ${member.sbn_no}?`)) return;
    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/operators/${encodeURIComponent(member.sbn_no)}`, { method: "DELETE" });
      if (res.ok) {
        await fetchGlobalMembers();
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

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const finalDrivingRoute = formData.driving_route.trim() !== "" ? formData.driving_route : formData.route;
      
      const payload = { 
        ...formData, 
        driving_route: finalDrivingRoute
      }
      
      const response = await fetchWithAuth(`${API_URL}/franchise/${formData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      
      if (response.ok) {
        const data = await response.json();
        setIsEditOpen(false)
        await fetchGlobalMembers();
        
        const returnedIssue = data.issue_date ? data.issue_date.split('T')[0] : "None";
        const returnedValid = data.valid_until ? data.valid_until.split('T')[0] : "None";
        const returnedSBN = data.sbn_no || payload.sbn_no;
        
        showToast(`Record updated. Date Issued: ${returnedIssue}, Valid until: ${returnedValid}, SBN: ${returnedSBN}.`, "success");
      } else {
        const err = await response.json()
        showToast(err.detail || "Failed to save record.", "error")
      }
    } catch {
      showToast("Network error while trying to save record.", "error")
    }
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
            showToast(`Print dialog opened for ${member.sbn_no}.`, "success");
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

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500 min-h-screen bg-muted/5">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-6">
        <div className="shrink-0 flex items-center gap-3">
          <Globe className="w-8 h-8 text-blue-600" />
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">Global Registry Search</h2>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">
              Querying {members.length.toLocaleString()} total operators across all routes.
            </p>
          </div>
        </div>
        <div className="relative w-full xl:w-[32rem]">
            <Search className="absolute left-3.5 top-3 h-5 w-5 text-blue-600" />
            <input
              autoFocus
              placeholder="Search across all TODAs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 h-12 bg-background border-2 border-blue-500/50 focus:border-blue-600 transition-all rounded-xl shadow-md font-bold text-lg focus:outline-none focus:ring-4 focus:ring-blue-500/20"
            />
        </div>
      </div>

      <Card className="shadow-sm border-border/60 rounded-2xl overflow-hidden bg-card">
        <CardHeader className="bg-muted/10 pb-5 border-b border-border/50">
          <CardTitle className="text-xl font-bold">Search Results</CardTitle>
          <CardDescription className="mt-1 font-medium">
            {filteredMembers.length} matches found globally.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto min-h-[500px]">
            <Table>
              <TableHeader className="bg-muted/20 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-bold text-muted-foreground w-[160px] pl-6 h-12">SBN No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-64">Operator Profile</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-32">Plate No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Renewal Date</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-center font-bold text-muted-foreground w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="animate-pulse hover:bg-transparent">
                      <TableCell className="pl-6"><div className="h-4 w-20 bg-muted/60 rounded" /></TableCell>
                      <TableCell><div className="h-4 w-48 bg-muted/60 rounded mb-2"/><div className="h-3 w-24 bg-muted/60 rounded"/></TableCell>
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
                    <TableCell colSpan={6} className="h-[400px] text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <ArchiveX className="h-12 w-12 mb-3 opacity-20" />
                        {deferredSearch ? "No global matches found for this query." : "Type a query to search the entire municipality."}
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
                      statusBadge = <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400 font-bold tracking-wide shadow-sm"><XCircle className="h-3 w-3 mr-1"/> Revoked</Badge>;
                    } else if (issueYear === currentYear - 1) {
                      rowColor = "bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/80 dark:hover:bg-amber-900/30 transition-colors duration-200";
                      statusBadge = <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400 font-bold tracking-wide shadow-sm"><AlertCircle className="h-3 w-3 mr-1"/> 1-Year Non-Renewal</Badge>;
                    }

                    return (
                      <TableRow key={member.id} className={`${rowColor} border-b border-border/40`}>
                        <TableCell className="pl-6 font-mono font-bold text-[13px] text-foreground/90 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span>{member.sbn_no}</span>
                            <Badge variant="outline" className="bg-blue-600 text-white border-blue-700 text-[10px] px-2 py-0 shadow-sm leading-tight h-5 uppercase">
                              {member.route}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="font-bold text-foreground truncate max-w-[250px]">{member.operator_name || <span className="text-blue-600 italic">VACANT SLOT</span>}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[250px] mt-0.5 font-medium">{member.make || "No Vehicle Info"}</div>
                        </TableCell>
                        <TableCell>
                          {member.plate_no ? <Badge variant="secondary" className="font-mono tracking-widest shadow-sm bg-background/60 font-bold">{member.plate_no}</Badge> : <span className="text-muted-foreground/60 italic text-xs font-bold tracking-wide px-1">NO PLATE</span>}
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
                <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || isLoading}>Previous</Button>
                <Button variant="outline" size="sm" className="font-bold shadow-sm border-border/60" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0 || isLoading}>Next</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* EDIT OPERATOR DIALOG */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Edit / Renew Operator</DialogTitle>
            <DialogDescription>Update record details or clear fields to set as Vacant.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitForm} className="space-y-5 mt-2">
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

      {/* CUSTOM TOAST CONTAINER */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-bold animate-in slide-in-from-right-8 fade-in duration-300 ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            {toast.type === 'success' ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="ml-4 opacity-50 hover:opacity-100 transition-opacity shrink-0"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center"><Loader2 className="animate-spin w-10 h-10 text-blue-600" /></div>}>
      <GlobalSearchClient />
    </Suspense>
  )
}