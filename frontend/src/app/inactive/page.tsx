"use client";

import { useEffect, useState } from "react";
import { ArchiveX, Search, AlertTriangle, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const API_URL = "http://127.0.0.1:43888";

interface FranchiseRecord {
  id: string;
  sbn_no: string;
  operator_name: string;
  plate_no: string;
  route: string;
  issue_date: string;
  is_active: boolean;
}

export default function InactiveLines() {
  const [records, setRecords] = useState<FranchiseRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  useEffect(() => {
    const fetchInactive = async () => {
      try {
        const token = localStorage.getItem("pasada_token") || localStorage.getItem("token");
        const res = await fetch(`${API_URL}/franchise/status/inactive`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setRecords(await res.json());
      } catch (e) {
        console.error("Failed to fetch inactive records");
      } finally {
        setLoading(false);
      }
    };
    fetchInactive();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const filteredRecords = records.filter(r => {
    const term = search.toLowerCase();
    return (
      r.operator_name?.toLowerCase().includes(term) ||
      r.sbn_no?.toLowerCase().includes(term) ||
      r.route?.toLowerCase().includes(term)
    );
  });

  const totalPages = Math.ceil(filteredRecords.length / rowsPerPage);
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  return (
    <div className="p-6 md:p-8 animate-in fade-in duration-500 min-h-screen bg-muted/5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <ArchiveX className="w-8 h-8 text-red-600" />
          <div>
            <h1 className="text-3xl font-black tracking-tight">Inactive Lines & Revoked Records</h1>
            <p className="text-muted-foreground mt-1 font-medium">Historical archive of operators with 2+ years of non-renewal.</p>
          </div>
        </div>
        <div className="relative w-full md:w-80 group">
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground group-focus-within:text-blue-600 transition-colors" />
          <Input 
            placeholder="Search Operator, SBN, or Route..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="pl-10 h-11 bg-card border-border/50 focus:bg-background transition-all rounded-lg shadow-sm font-medium" 
          />
        </div>
      </div>

      <div className="bg-card shadow-sm border border-border/60 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="h-48 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-600" />
              <p className="font-medium">Fetching Archives...</p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/20 border-b border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-bold text-muted-foreground w-[180px] pl-6 h-12">SBN No.</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Operator Name</TableHead>
                  <TableHead className="font-bold text-muted-foreground">TODA Line</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Last Known Issue Date</TableHead>
                  <TableHead className="font-bold text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center text-muted-foreground font-medium">
                      <div className="flex flex-col items-center justify-center">
                        <AlertTriangle className="h-8 w-8 mb-2 opacity-20" />
                        No revoked records found in the archive.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRecords.map((record) => (
                    <TableRow key={record.id} className="hover:bg-muted/30 transition-colors bg-red-50/20 dark:bg-red-950/10">
                      <TableCell className="font-mono font-bold pl-6 text-[13px]">{record.sbn_no}</TableCell>
                      <TableCell className="font-bold">{record.operator_name}</TableCell>
                      <TableCell><Badge variant="secondary" className="font-bold">{record.route}</Badge></TableCell>
                      <TableCell className="text-sm font-bold text-muted-foreground">
                        {record.issue_date ? new Date(record.issue_date).toLocaleDateString() : "Unknown"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400 font-bold shadow-sm">
                          Revoked
                        </Badge>
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
            Showing {filteredRecords.length === 0 ? 0 : ((currentPage - 1) * rowsPerPage) + 1} to {Math.min(currentPage * rowsPerPage, filteredRecords.length)} of {filteredRecords.length} archived records
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
      </div>
    </div>
  );
}