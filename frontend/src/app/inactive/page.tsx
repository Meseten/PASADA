"use client"

import { useState, useEffect } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, ArchiveX } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"

interface Member {
  id: number; sbn_no: string; operator_name: string; address: string; 
  plate_no: string; route: string; issue_date: string;
}

export default function InactivePage() {
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState("")

  useEffect(() => {
    const fetchInactive = async () => {
      const token = localStorage.getItem("pasada_token")
      try {
        const response = await fetch(`${API_URL}/franchise/status/inactive`, { headers: { "Authorization": `Bearer ${token}` } })
        if (response.ok) setMembers(await response.json())
      } catch (error) {}
    }
    fetchInactive()
  }, [])

  const filteredMembers = members.filter(m => 
    m.operator_name?.toLowerCase().includes(search.toLowerCase()) || 
    m.sbn_no?.toLowerCase().includes(search.toLowerCase()) ||
    m.route?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 min-h-screen bg-muted/5">
      <div>
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-destructive">Inactive & Revoked Registry</h2>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">Archived operators excluded from Random Forest predictions.</p>
      </div>

      <Card className="shadow-lg border-border/50">
        <CardHeader className="bg-card pb-5 border-b border-border/50">
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2"><ArchiveX className="h-5 w-5 text-destructive" /> Non-Compliant Operators</CardTitle>
              <CardDescription>2+ Years without MTOP renewal.</CardDescription>
            </div>
            <div className="relative w-full md:w-96 group">
              <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search Operator, Route, SBN..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 h-10 bg-muted/40 rounded-full" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                <TableRow>
                  <TableHead className="font-bold pl-6">SBN No.</TableHead>
                  <TableHead className="font-bold">Operator Profile</TableHead>
                  <TableHead className="font-bold">Route</TableHead>
                  <TableHead className="font-bold">Plate No.</TableHead>
                  <TableHead className="font-bold">Last Issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground font-medium">No inactive records found.</TableCell></TableRow>
                ) : (
                  filteredMembers.map((member) => (
                    <TableRow key={member.id} className="bg-red-50/30 dark:bg-red-950/10">
                      <TableCell className="font-mono font-bold pl-6 text-[13px]">{member.sbn_no}</TableCell>
                      <TableCell className="py-3">
                        <div className="font-bold truncate max-w-[200px]">{member.operator_name}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">{member.address}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="bg-background">{member.route}</Badge></TableCell>
                      <TableCell>{member.plate_no || <span className="text-muted-foreground/60 italic text-xs">NO PLATE</span>}</TableCell>
                      <TableCell className="text-sm font-semibold text-muted-foreground">{new Date(member.issue_date).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}