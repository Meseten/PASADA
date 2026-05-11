"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"

export default function ImportPage() {
  const [route, setRoute] = useState("")
  const [files, setFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ type: "success" | "error", message: string } | null>(null)

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!files || !route) return

    setUploading(true)
    setResult(null)
    setProgress(0)

    const token = localStorage.getItem("pasada_token")
    const fileArray = Array.from(files)
    const MAX_FILES_PER_REQUEST = 200 
    
    let totalImported = 0
    let hasError = false

    for (let i = 0; i < fileArray.length; i += MAX_FILES_PER_REQUEST) {
      const chunk = fileArray.slice(i, i + MAX_FILES_PER_REQUEST)
      const formData = new FormData()
      
      for (let j = 0; j < chunk.length; j++) {
        formData.append("files", chunk[j])
      }

      try {
        const response = await fetch(`${API_URL}/upload/bulk/${route.toUpperCase()}`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          body: formData
        })

        if (response.ok) {
          const data = await response.json()
          totalImported += data.imported
          const currentProgress = Math.round(((i + chunk.length) / fileArray.length) * 100)
          setProgress(currentProgress > 100 ? 100 : currentProgress)
          await new Promise(resolve => setTimeout(resolve, 300))
        } else {
          hasError = true
          break
        }
      } catch (error) {
        hasError = true
        break
      }
    }

    if (hasError) {
      setResult({ type: "error", message: "Data ingestion interrupted. Server rejected a chunk payload." })
    } else {
      setResult({ type: "success", message: `Successfully synchronized ${totalImported} records into ${route.toUpperCase()}` })
      setFiles(null)
      window.dispatchEvent(new Event('toda_imported'))
    }
    
    setUploading(false)
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6 min-h-screen bg-muted/10 transition-all duration-300">
      <div className="flex items-center justify-between space-y-2 mb-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">System Data Ingestion</h2>
          <p className="text-muted-foreground mt-1">Securely migrate legacy municipal records into the active database.</p>
        </div>
      </div>
      
      <Card className="max-w-2xl mt-4 shadow-xl border-border/50 bg-card/95 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl"><UploadCloud className="h-6 w-6 text-blue-500"/> Mass Upload Protocol</CardTitle>
          <CardDescription>Drag and drop or select records. Large batches will be auto-chunked to prevent server rejection.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Target TODA Route Allocation</Label>
              <Input value={route} onChange={(e) => setRoute(e.target.value)} required placeholder="e.g. NCTODA" className="uppercase h-12 text-lg tracking-wider font-medium" />
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Document Selection</Label>
              <div className={`border-2 border-dashed rounded-xl p-10 text-center transition-all duration-300 flex flex-col items-center justify-center ${files ? 'border-blue-500 bg-blue-50/30' : 'border-border/60 hover:bg-muted/50'}`}>
                <Input type="file" multiple accept=".xlsx,.csv,.docx" onChange={(e) => setFiles(e.target.files)} className="hidden" id="file-upload" disabled={uploading} />
                <Label htmlFor="file-upload" className={`cursor-pointer flex flex-col items-center gap-3 w-full h-full ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
                  <FileSpreadsheet className={`h-12 w-12 transition-colors ${files ? 'text-blue-500' : 'text-muted-foreground/70'}`} />
                  <span className="text-base font-semibold">{files ? `${files.length} documents verified and ready` : "Click to browse local files"}</span>
                </Label>
              </div>
            </div>

            <div className={`transition-all duration-500 overflow-hidden ${uploading ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className="flex justify-between text-xs font-semibold mb-1 text-muted-foreground">
                <span>Ingesting and Parsing Data Batches...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden border border-border/50">
                <div className="bg-blue-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>

            {result && !uploading && (
              <div className={`flex items-center gap-3 text-sm p-4 rounded-lg border transition-all ${result.type === 'success' ? 'text-green-700 bg-green-500/10 border-green-500/20' : 'text-red-700 bg-red-500/10 border-red-500/20'}`}>
                {result.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                <span className="font-medium">{result.message}</span>
              </div>
            )}

            <Button type="submit" disabled={!files || !route || uploading} className="w-full h-12 text-md font-bold">
              {uploading ? "Processing Sequential Batches..." : "Initialize Import Sequence"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}