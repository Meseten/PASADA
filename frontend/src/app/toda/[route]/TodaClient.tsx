"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { History, FileSignature, Edit, Printer, Search, PlusCircle, CheckCircle, XCircle, AlertCircle, ArchiveX, Loader2, Filter, Calendar, FileText } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:43888";

interface Member {
  id: string; sbn_no: string; operator_name: string; address: string; 
  plate_no: string; motor_no: string; chassis_no: string; make: string; 
  route: string; driving_route: string; issue_date: string; valid_until: string; is_active: boolean;
}

interface LogEntry {
  id: string; timestamp: string; clerk_name: string; action: string; details: string;
}

export default function TodaClient() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  
  const fallbackRoute = pathname?.split('/').pop()?.toUpperCase() || ""
  const safeRouteName = (params?.route as string)?.toUpperCase() || fallbackRoute
  
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState("")
  
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isGeneratingId, setIsGeneratingId] = useState<string | null>(null)
  
  // Batch Printing States
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
    id: "", sbn_no: "", operator_name: "", address: "", motor_no: "", chassis_no: "", make: "", plate_no: "", route: safeRouteName, driving_route: ""
  })

  const fetchMembers = useCallback(async () => {
    if (!safeRouteName) return
    const token = localStorage.getItem("token")
    if (!token) return router.push("/")
    try {
      const response = await fetch(`${API_URL}/franchise/route/${safeRouteName}`, { headers: { "Authorization": `Bearer ${token}` } })
      if (response.ok) setMembers(await response.json())
    } catch (error) {}
  }, [safeRouteName, router])

  useEffect(() => {
    if (safeRouteName) {
      setFormData(prev => ({ ...prev, route: safeRouteName }))
      fetchMembers()
    }
  }, [safeRouteName, fetchMembers])

  useEffect(() => {
    setCurrentPage(1)
  }, [search])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value.toUpperCase() })
  }

  const handleOpenAdd = () => {
    const currentYear = new Date().getFullYear()
    setFormData({ id: "", sbn_no: `${safeRouteName.substring(0,3)}-000-${String(currentYear).slice(-2)}`, operator_name: "", address: "", motor_no: "", chassis_no: "", make: "", plate_no: "", route: safeRouteName, driving_route: "" })
    setIsAddOpen(true)
  }

  const handleOpenEdit = (member: Member) => {
    setFormData({ ...member, route: safeRouteName })
    setIsEditOpen(true)
  }

  const handleNativePrint = async (member: Member) => {
    setIsGeneratingId(member.id)
    const token = localStorage.getItem("token")
    try {
      const response = await fetch(`${API_URL}/franchise/generate/${member.id}`, { method: 'POST', headers: { "Authorization": `Bearer ${token}` } })
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)

        if (blob.type === "application/pdf") {
          const iframe = document.createElement('iframe')
          iframe.style.display = 'none'
          iframe.src = url
          document.body.appendChild(iframe)
          
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus()
              iframe.contentWindow?.print()
            } catch (e) {
              console.error(e)
            }
            setIsGeneratingId(null)
          }, 1000)

        } else {
          const a = document.createElement('a')
          a.style.display = 'none'
          a.href = url
          a.download = `MTOP_${member.sbn_no || member.plate_no}.docx`
          document.body.appendChild(a)
          a.click()
          setIsGeneratingId(null)
        }
      } else {
        setIsGeneratingId(null)
      }
    } catch (error) {
      setIsGeneratingId(null)
    }
  }

  const downloadBatchDocument = async (member: Member) => {
    const token = localStorage.getItem("token")
    try {
      const res = await fetch(`${API_URL}/franchise/generate/${member.id}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.style.display = 'none'
        a.href = url
        a.download = `MTOP_${member.operator_name.replace(/\s+/g, '_')}.docx`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }
    } catch (err) {
      console.error(err)
    }
  }

  const executeBatchPrint = async () => {
    setBatchPrinting(true)
    let targetRecords: Member[] = []
    const now = new Date()
    const todayString = now.toISOString().split('T')[0]

    targetRecords = members.filter(record => {
      if (!record.issue_date) return false
      const recordDateObj = new Date(record.issue_date)
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
      alert("No records found for the selected batch filter.")
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
  }

  const handleOpenHistory = async (member: Member) => {
    setActiveMember(member)
    const token = localStorage.getItem("token")
    try {
      const res = await fetch(`${API_URL}/logs/record/${member.id}`, { headers: { "Authorization": `Bearer ${token}` } })
      if (res.ok) setHistoryLogs(await res.json())
      setIsHistoryOpen(true)
    } catch (e) {}
  }

  const handleSubmitForm = async (e: React.FormEvent, isAdd: boolean) => {
    e.preventDefault()
    const token = localStorage.getItem("token")
    try {
      const payload = { ...formData, driving_route: formData.driving_route || formData.route, route: safeRouteName }
      const response = await fetch(isAdd ? `${API_URL}/franchise/` : `${API_URL}/franchise/${formData.id}`, {
        method: isAdd ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
      if (response.ok) {
        isAdd ? setIsAddOpen(false) : setIsEditOpen(false)
        fetchMembers()
      }
    } catch (error) {}
  }

  const filteredMembers = members.filter(m => {
    const term = search.toLowerCase();
    return (
      m.operator_name?.toLowerCase().includes(term) ||
      m.sbn_no?.toLowerCase().includes(term) ||
      m.plate_no?.toLowerCase().includes(term) ||
      m.motor_no?.toLowerCase().includes(term) ||
      m.chassis_no?.toLowerCase().includes(term) ||
      m.address?.toLowerCase().includes(term)
    )
  })

  const totalPages = Math.ceil(filteredMembers.length / rowsPerPage)
  const paginatedMembers = filteredMembers.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage)

  if (!safeRouteName) return <div className="p-8 animate-pulse text-muted-foreground flex items-center h-full justify-center text-lg">Synchronizing Route Data...</div>
  const currentYear = new Date().getFullYear()

  return (
    <div className="space-y-6 p-4 md:p-8 pt-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight text-foreground">{safeRouteName}</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">Comprehensive operator registry and compliance tracking.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setBatchModalOpen(true)} className="shadow-sm hover:shadow-md transition-all duration-300 h-11 px-6 rounded-lg font-bold border-border/60 bg-background text-blue-600">
            <Printer className="mr-2 h-5 w-5" /> Batch Print (A4)
          </Button>
          <Button onClick={handleOpenAdd} className="shadow-md hover:shadow-lg transition-all duration-300 h-11 px-6 rounded-lg font-bold bg-blue-600 hover:bg-blue-700 text-white">
            <PlusCircle className="mr-2 h-5 w-5" /> Process MTOP
          </Button>
        </div>
      </div>

      {/* BATCH PRINT MODAL */}
      <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
        <DialogContent className="sm:max-w-[500px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Printer className="h-6 w-6 text-blue-600" /> Print Documents (A4)
            </DialogTitle>
            <DialogDescription>
              Select temporal parameters for mass document generation. Output is strictly formatted for standard A4 Municipal Paper.
            </DialogDescription>
          </DialogHeader>

          {batchPrinting ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-6 text-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
              <div className="space-y-2 w-full">
                <p className="font-bold text-lg">Compiling A4 Documents</p>
                <p className="text-sm text-muted-foreground font-medium">
                  Processing {batchProgress.current} of {batchProgress.total} records...
                </p>
                <div className="w-full bg-muted rounded-full h-2.5 mt-4 overflow-hidden">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 mt-4">
              <div className="space-y-3">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Filter size={14} /> Output Session Filter
                </Label>
                <select
                  value={batchFilterType}
                  onChange={(e) => setBatchFilterType(e.target.value)}
                  className="flex h-12 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="TODAY_ALL">Today - Full Day Processing</option>
                  <option value="TODAY_MORNING">Today - Morning Session (12AM - 11:59AM)</option>
                  <option value="TODAY_AFTERNOON">Today - Afternoon Session (12PM - 11:59PM)</option>
                  <option value="SPECIFIC_DATE">Specific Day - Single Date Selection</option>
                  <option value="DATE_RANGE">Date Range - Custom Start & End</option>
                </select>
              </div>

              {batchFilterType === "SPECIFIC_DATE" && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Calendar size={14} /> Target Extraction Date
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
              
              <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-500/20 p-4 rounded-xl flex items-start gap-3">
                <FileText className="text-blue-600 mt-0.5 shrink-0" size={18} />
                <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold leading-relaxed">
                  Batch printing securely generates exact .docx files formatted specifically for A4 paper. This process runs sequentially without interrupting LAN synchronization.
                </p>
              </div>
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
                <CheckCircle className="mr-2 h-5 w-5" /> Initiate A4 Batch Sequence
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Register New Franchise</DialogTitle>
            <DialogDescription>Enter accurate details. SBN auto-generates the current year.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => handleSubmitForm(e, true)} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2"><Label className="font-semibold">SBN No.</Label><Input name="sbn_no" value={formData.sbn_no} onChange={handleInputChange} required className="font-mono bg-muted/50 border-border/50 shadow-inner h-11" /></div>
              <div className="space-y-2"><Label className="font-semibold">Plate No.</Label><Input name="plate_no" value={formData.plate_no} onChange={handleInputChange} placeholder="Leave blank if None" className="h-11" /></div>
            </div>
            <div className="space-y-2"><Label className="font-semibold">Operator Name</Label><Input name="operator_name" value={formData.operator_name} onChange={handleInputChange} required className="h-11" /></div>
            <div className="space-y-2"><Label className="font-semibold">Address</Label><Input name="address" value={formData.address} onChange={handleInputChange} required className="h-11" /></div>
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label className="font-semibold">Make</Label><Input name="make" value={formData.make} onChange={handleInputChange} required /></div>
               <div className="space-y-2"><Label className="font-semibold">Driving Route</Label><Input name="driving_route" value={formData.driving_route} onChange={handleInputChange} placeholder="e.g. POBLACION" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="font-semibold">Motor No.</Label><Input name="motor_no" value={formData.motor_no} onChange={handleInputChange} required /></div>
              <div className="space-y-2"><Label className="font-semibold">Chassis No.</Label><Input name="chassis_no" value={formData.chassis_no} onChange={handleInputChange} required /></div>
            </div>
            <DialogFooter className="pt-4">
              <Button type="submit" className="w-full h-11 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors text-white">Save Registry Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[550px] shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Modify / Renew Franchise</DialogTitle>
            <DialogDescription>Change the year suffix on the SBN to instantly trigger system compliance renewal.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => handleSubmitForm(e, false)} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="font-semibold flex justify-between">SBN No. <span className="text-blue-500 font-normal italic text-xs">Edit to Renew</span></Label>
                <Input name="sbn_no" value={formData.sbn_no} onChange={handleInputChange} className="border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 font-mono text-lg font-bold shadow-inner h-11 w-full" required />
              </div>
              <div className="space-y-2"><Label className="font-semibold">Plate No.</Label><Input name="plate_no" value={formData.plate_no} onChange={handleInputChange} placeholder="Leave blank if None" className="h-11" /></div>
            </div>
            <div className="space-y-2"><Label className="font-semibold">Operator Name</Label><Input name="operator_name" value={formData.operator_name} onChange={handleInputChange} required className="h-11" /></div>
            <div className="space-y-2"><Label className="font-semibold">Address</Label><Input name="address" value={formData.address} onChange={handleInputChange} required className="h-11" /></div>
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2"><Label className="font-semibold">Make</Label><Input name="make" value={formData.make} onChange={handleInputChange} required /></div>
               <div className="space-y-2"><Label className="font-semibold">Driving Route</Label><Input name="driving_route" value={formData.driving_route} onChange={handleInputChange} placeholder="e.g. POBLACION" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label className="font-semibold">Motor No.</Label><Input name="motor_no" value={formData.motor_no} onChange={handleInputChange} required /></div>
              <div className="space-y-2"><Label className="font-semibold">Chassis No.</Label><Input name="chassis_no" value={formData.chassis_no} onChange={handleInputChange} required /></div>
            </div>
            <DialogFooter className="pt-4">
              <Button type="submit" className="w-full h-11 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-colors shadow-md text-white">Commit Changes & Log</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-hidden flex flex-col p-0 rounded-2xl shadow-2xl">
          <div className="p-6 bg-muted/30 border-b border-border/50 shrink-0">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2"><History className="h-5 w-5 text-blue-600" /> Immutable Audit Trail</DialogTitle>
              <DialogDescription className="mt-1">Cryptographic action log for <span className="font-bold text-foreground">{activeMember?.operator_name}</span></DialogDescription>
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

      <Card className="shadow-sm border-border/60 rounded-2xl overflow-hidden bg-card">
        <CardHeader className="bg-muted/10 pb-5 border-b border-border/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2"><FileSignature className="h-5 w-5 text-blue-600"/> Active Registry Index</CardTitle>
              <CardDescription className="mt-1 font-medium">Real-time status tracking of {filteredMembers.length} operators.</CardDescription>
            </div>
            <div className="relative w-full md:w-96 group">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-blue-600 transition-colors" />
              <Input 
                placeholder="Search Operator, Address, Motor, SBN..." 
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
                  <TableHead className="font-bold text-muted-foreground w-[180px] pl-6 h-12">SBN No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-64">Operator Profile</TableHead>
                  <TableHead className="font-bold text-muted-foreground w-32">Plate No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Compliance Timeline</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Jurisdiction Status</TableHead>
                  <TableHead className="text-right font-bold text-muted-foreground pr-6">Administration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <ArchiveX className="h-8 w-8 mb-2 opacity-20" />
                        No records matched your search parameters.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedMembers.map((member) => {
                    const issueYear = new Date(member.issue_date).getFullYear();
                    let rowColor = "hover:bg-muted/30 transition-colors duration-200";
                    let statusBadge = <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400 font-bold tracking-wide shadow-sm"><CheckCircle className="h-3 w-3 mr-1"/> Active</Badge>;

                    if (member.is_active === false || issueYear <= currentYear - 2) {
                      rowColor = "bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/80 dark:hover:bg-red-900/30 transition-colors duration-200";
                      statusBadge = <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400 font-bold tracking-wide shadow-sm"><XCircle className="h-3 w-3 mr-1"/> Revoked (2+ Yrs)</Badge>;
                    } else if (issueYear === currentYear - 1) {
                      rowColor = "bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/80 dark:hover:bg-amber-900/30 transition-colors duration-200";
                      statusBadge = <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400 font-bold tracking-wide shadow-sm"><AlertCircle className="h-3 w-3 mr-1"/> Flagged (Pending)</Badge>;
                    }

                    return (
                      <TableRow key={member.id} className={`${rowColor} border-b border-border/40 group`}>
                        <TableCell className="font-mono font-bold pl-6 text-[13px] text-foreground/90 whitespace-nowrap">{member.sbn_no}</TableCell>
                        <TableCell className="py-3">
                          <div className="font-bold text-foreground truncate max-w-[200px]" title={member.operator_name}>{member.operator_name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5 font-medium" title={member.address}>{member.address}</div>
                        </TableCell>
                        <TableCell>
                          {member.plate_no ? 
                            <Badge variant="secondary" className="font-mono tracking-widest shadow-sm bg-background/60 font-bold">{member.plate_no}</Badge> : 
                            <span className="text-muted-foreground/60 italic text-xs font-bold tracking-wide px-1">NO PLATE</span>
                          }
                        </TableCell>
                        <TableCell className="text-sm font-bold text-muted-foreground">
                          {new Date(member.issue_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </TableCell>
                        <TableCell>{statusBadge}</TableCell>
                        <TableCell className="text-right space-x-1.5 pr-4">
                          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" title="Audit Trail" onClick={() => handleOpenHistory(member)}><History className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-border/60 shadow-sm" title="Modify Record" onClick={() => handleOpenEdit(member)}><Edit className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" size="icon" disabled={isGeneratingId === member.id} className="h-8 w-8 bg-background/50 hover:bg-background hover:text-blue-600 transition-all hover:scale-105 border-blue-500/30 shadow-sm" title="Native Browser Print" onClick={() => handleNativePrint(member)}>
                            {isGeneratingId === member.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 text-blue-600" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
          
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
                  className="h-8 w-20 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
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
  )
}