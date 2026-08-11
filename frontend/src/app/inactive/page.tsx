"use client";

import { useEffect, useState } from "react";
import { ArchiveX, Search, AlertTriangle, Loader2, Download, Eye, FileText, Printer, ArrowUpDown, Filter, Shield } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { API_URL, fetchWithAuth } from "@/lib/api";

interface FranchiseRecord {
  id: string;
  sbn_no: string;
  operator_name: string;
  plate_no: string;
  motor_no: string;
  chassis_no: string;
  make: string;
  address: string;
  route: string;
  issue_date: string;
  valid_until: string;
  is_active: boolean;
}

export default function InactiveLines() {
  const [records, setRecords] = useState<FranchiseRecord[]>([]);
  const [search, setSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("ROUTE_ASC");
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isPrinting, setIsPrinting] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [viewMember, setViewMember] = useState<FranchiseRecord | null>(null);

  useEffect(() => {
    const fetchInactive = async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/franchise/status/inactive`);
        if (res.ok) setRecords(await res.json());
      } catch (e) {
        console.error("Failed to fetch inactive operators", e);
      } finally {
        setLoading(false);
      }
    };
    fetchInactive();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, routeFilter, sortBy]);

  const uniqueRoutes = Array.from(new Set(records.map(r => r.route))).sort();

  const filteredRecords = records.filter(r => {
    if (routeFilter !== "ALL" && r.route !== routeFilter) return false;
    const term = search.toLowerCase();
    return (
      r.operator_name?.toLowerCase().includes(term) ||
      r.sbn_no?.toLowerCase().includes(term) ||
      r.route?.toLowerCase().includes(term) ||
      r.plate_no?.toLowerCase().includes(term)
    );
  });

  const sortedRecords = [...filteredRecords].sort((a, b) => {
    if (sortBy === "ROUTE_ASC") {
      const cmp = (a.route || "").localeCompare(b.route || "");
      if (cmp !== 0) return cmp;
      const numA = parseInt((a.sbn_no.match(/\d+/) || ["999999"])[0], 10);
      const numB = parseInt((b.sbn_no.match(/\d+/) || ["999999"])[0], 10);
      return numA - numB;
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
    if (sortBy === "SBN_ASC") {
      const numA = parseInt((a.sbn_no.match(/\d+/) || ["999999"])[0], 10);
      const numB = parseInt((b.sbn_no.match(/\d+/) || ["999999"])[0], 10);
      return numA - numB;
    }
    if (sortBy === "NAME_ASC") {
      const nameA = a.operator_name || "zzz";
      const nameB = b.operator_name || "zzz";
      return nameA.localeCompare(nameB);
    }
    return 0;
  });

  const totalPages = Math.ceil(sortedRecords.length / rowsPerPage);
  const paginatedRecords = sortedRecords.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const formatSafeDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "None";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const handleOpenView = (member: FranchiseRecord) => {
    setViewMember(member);
    setIsViewOpen(true);
  };

  const handleExportInactive = async () => {
    setIsExporting(true);
    try {
      const response = await fetchWithAuth(`${API_URL}/export/masterlist/${routeFilter}?status_filter=REVOKED`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        const year = new Date().getFullYear();
        const routePrefix = routeFilter === "ALL" ? "ALL_ROUTES" : routeFilter;
        a.download = `${routePrefix} ${year} - REVOKED.xlsx`;
        
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1000);
      } else {
        alert("Failed to export inactive records.");
      }
    } catch (error) {
      alert("Network error while exporting.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadWord = async (member: FranchiseRecord) => {
    try {
      const response = await fetchWithAuth(`${API_URL}/franchise/download/word/${member.id}`, { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        
        a.download = `${member.sbn_no}.docx`;
        
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1000);
      }
    } catch (error) {
      console.error("Download Error", error);
    }
  };

  const handleNativePrint = async (member: FranchiseRecord) => {
    if (isPrinting) return;
    setIsPrinting(member.id);
    
    try {
      const response = await fetchWithAuth(`${API_URL}/franchise/generate/${member.id}`, { method: 'POST' });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        if (blob.type === "application/pdf") {
          const isLinux = navigator.userAgent.toLowerCase().includes('linux');

          if (isLinux) {
            // LINUX WEBVIEW FIX: Hidden iframe auto-print
            const existingIframe = document.getElementById('pasada-print-frame');
            if (existingIframe) document.body.removeChild(existingIframe);
            
            const iframe = document.createElement('iframe');
            iframe.id = 'pasada-print-frame';
            iframe.style.position = 'fixed';
            iframe.style.right = '-10000px';
            iframe.style.bottom = '-10000px';
            iframe.style.width = '1000px';
            iframe.style.height = '1000px';
            iframe.style.pointerEvents = 'none';
            iframe.style.border = 'none';
            iframe.src = url;
            
            document.body.appendChild(iframe);
            
            setTimeout(() => {
              try {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
              } catch (e) {
                console.error("Print dialog failed:", e);
              }
              setIsPrinting(null);
              setTimeout(() => window.URL.revokeObjectURL(url), 120000);
            }, 2000);

          } else {
            // WINDOWS WEBVIEW2 FIX: Active Embed Overlay
            const overlayId = 'pasada-print-overlay';
            const existingOverlay = document.getElementById(overlayId);
            if (existingOverlay) document.body.removeChild(existingOverlay);

            const overlay = document.createElement('div');
            overlay.id = overlayId;
            Object.assign(overlay.style, {
              position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
              backgroundColor: 'rgba(0,0,0,0.85)', zIndex: '999999', display: 'flex',
              flexDirection: 'column', backdropFilter: 'blur(4px)'
            });

            const toolbar = document.createElement('div');
            Object.assign(toolbar.style, {
              padding: '12px 24px', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', backgroundColor: '#1e293b', color: 'white',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)', fontFamily: 'system-ui, -apple-system, sans-serif'
            });

            const title = document.createElement('div');
            title.innerText = 'Document Preview (Click the Print icon inside the viewer)';
            title.style.fontWeight = 'bold';
            title.style.fontSize = '16px';

            const closeBtn = document.createElement('button');
            closeBtn.innerText = 'Close Preview';
            Object.assign(closeBtn.style, {
              padding: '8px 16px', backgroundColor: '#ef4444', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold',
              transition: 'background-color 0.2s'
            });
            closeBtn.onmouseover = () => closeBtn.style.backgroundColor = '#dc2626';
            closeBtn.onmouseout = () => closeBtn.style.backgroundColor = '#ef4444';
            closeBtn.onclick = () => {
              document.body.removeChild(overlay);
              window.URL.revokeObjectURL(url);
            };

            toolbar.appendChild(title);
            toolbar.appendChild(closeBtn);

            const embed = document.createElement('embed');
            embed.src = url;
            embed.type = 'application/pdf';
            Object.assign(embed.style, {
              flex: '1', width: '100%', height: '100%', border: 'none'
            });

            overlay.appendChild(toolbar);
            overlay.appendChild(embed);
            document.body.appendChild(overlay);

            setIsPrinting(null);
          }
        } else {
          // DOCX Fallback
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `${member.sbn_no}.docx`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => document.body.removeChild(a), 100);
          setIsPrinting(null);
        }
      } else {
        setIsPrinting(null);
      }
    } catch (error) {
      console.error(error);
      setIsPrinting(null);
    }
  };

  return (
    <div className="p-6 md:p-8 animate-in fade-in duration-500 min-h-screen bg-muted/5">
      
      {/* HEADER WITH CONTROLS - GILID RIGHT ALIGNED */}
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 mb-8">
        <div className="flex items-center gap-3 shrink-0">
          <ArchiveX className="w-8 h-8 text-red-600" />
          <div>
            <h1 className="text-3xl font-black tracking-tight">2+ Years Non-Renewal / Inactive</h1>
            <p className="text-muted-foreground mt-1 font-medium">Historical archive of operators with 2 or more years of non-renewal.</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center xl:justify-end gap-3 w-full xl:w-auto md:ml-auto">
          {/* SORT BY DROPDOWN */}
          <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-lg px-3 h-11 shadow-sm">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer pr-2 text-foreground"
            >
              <option value="ROUTE_ASC">Sort: TODA Route (A Z)</option>
              <option value="YEAR_NEWEST">Sort: Renewal Year (Newest)</option>
              <option value="YEAR_OLDEST">Sort: Renewal Year (Oldest)</option>
              <option value="SBN_ASC">Sort: SBN Number</option>
              <option value="NAME_ASC">Sort: Operator Name (A Z)</option>
            </select>
          </div>
          {/* FILTER BY TODA ROUTE */}
          <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-lg px-3 h-11 shadow-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
              className="bg-transparent text-sm font-bold focus:outline-none cursor-pointer pr-2 text-foreground"
            >
              <option value="ALL">All TODA Routes</option>
              {uniqueRoutes.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={handleExportInactive} disabled={isExporting} className="shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-emerald-600">
            {isExporting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
            Export Excel
          </Button>
          <div className="relative w-full md:w-72 group">
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground group-focus-within:text-blue-600 transition-colors" />
            <Input 
              placeholder="Search Operator, SBN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 bg-card border-border/50 focus:bg-background transition-all rounded-lg shadow-sm font-medium"
            />
          </div>
        </div>
      </div>

      {/* VIEW DOCUMENT PREVIEW MODAL */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-red-600" /> Inactive Operator Profile
            </DialogTitle>
            <DialogDescription>
              Archived municipal tricycle franchise record details.
            </DialogDescription>
          </DialogHeader>
          
          {viewMember && (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl space-y-3">
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
                  <span className="text-xs font-bold text-muted-foreground uppercase">TODA Route</span>
                  <Badge className="font-bold bg-red-500 text-white">{viewMember.route}</Badge>
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
                <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 font-bold">2+ Years Non-Renewal</Badge>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2 sm:justify-end">
            {viewMember && (
              <>
                <Button variant="outline" onClick={() => handleDownloadWord(viewMember)} className="font-bold">
                  <FileText className="mr-2 h-4 w-4 text-blue-600" /> Download Word File
                </Button>
                <Button onClick={() => handleNativePrint(viewMember)} disabled={isPrinting === viewMember.id} className="font-bold bg-blue-600 hover:bg-blue-700 text-white">
                  {isPrinting === viewMember.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                  Print MTOP
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-card shadow-sm border border-border/60 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-600" />
              <p className="font-medium">Loading inactive records...</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/20 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-bold text-muted-foreground w-[160px] pl-6 h-12">SBN No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Operator Name</TableHead>
                  <TableHead className="font-bold text-muted-foreground">TODA Line</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Last Renewal Date</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-center font-bold text-muted-foreground w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <AlertTriangle className="h-8 w-8 mb-2 opacity-20" />
                        No inactive operators found in the archive.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRecords.map((record) => (
                    <TableRow key={record.id} className="hover:bg-muted/30 transition-colors bg-red-50/20 dark:bg-red-950/10">
                      <TableCell className="font-mono font-bold pl-6 text-[13px]">{record.sbn_no}</TableCell>
                      <TableCell className="font-bold">{record.operator_name || "VACANT SLOT"}</TableCell>
                      <TableCell><Badge variant="secondary" className="font-bold">{record.route}</Badge></TableCell>
                      <TableCell className="text-sm font-bold text-muted-foreground">
                        {formatSafeDate(record.issue_date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400 font-bold shadow-sm">
                          Revoked
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" title="View Certificate Preview" onClick={() => handleOpenView(record)}>
                            <Eye className="h-3.5 w-3.5 text-slate-700 dark:text-slate-200" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-border/60 bg-muted/10">
          <div className="text-sm text-muted-foreground font-bold mb-4 sm:mb-0">
            Showing {filteredRecords.length === 0 ? 0 : ((currentPage - 1) * rowsPerPage) + 1} to {Math.min(currentPage * rowsPerPage, filteredRecords.length)} of {filteredRecords.length} records
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-muted-foreground">Rows per page:</span>
              <select
                value={rowsPerPage}
                onChange={(e) => { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="h-8 w-20 rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
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
      </div>
    </div>
  );
}