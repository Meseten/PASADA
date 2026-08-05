"use client"
import { useState, useEffect } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { API_URL, fetchWithAuth } from "@/lib/api";

interface LogEntry {
  id: number;
  timestamp: string;
  clerk_username: string;
  action: string;
  target_record: string;
  details: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const router = useRouter();

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetchWithAuth(`${API_URL}/logs`);
        if (response.ok) {
          const data = await response.json();
          setLogs(data);
        }
      } catch (error) {
        console.error(error);
      }
    };
    fetchLogs();
  }, [router]);

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <h2 className="text-3xl font-bold tracking-tight">Activity History</h2>
      
      <Card>
        <CardHeader>
          <CardTitle>System Action Log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target Record</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm">{new Date(log.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{log.clerk_username}</TableCell>
                  <TableCell>{log.action}</TableCell>
                  <TableCell>{log.target_record}</TableCell>
                  <TableCell className="text-muted-foreground">{log.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}