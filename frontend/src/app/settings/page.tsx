"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Settings as SettingsIcon, CheckCircle2, ShieldAlert, DownloadCloud, Network, UploadCloud } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"

export default function SettingsPage() {
  const [chairName, setChairName] = useState("")
  const [eSign, setESign] = useState(false)
  const [saved, setSaved] = useState(false)

  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [passMsg, setPassMsg] = useState("")

  const [exportRoute, setExportRoute] = useState("ALL")
  const [exportYear, setExportYear] = useState("ALL")
  const [isExporting, setIsExporting] = useState(false)

  const [networkInfo, setNetworkInfo] = useState({ local_ip: "Loading...", connected_peers: [] })

  useEffect(() => {
    const fetchSettings = async () => {
      const token = localStorage.getItem("pasada_token")
      try {
        const res = await fetch(`${API_URL}/settings`, { headers: { "Authorization": `Bearer ${token}` } })
        if (res.ok) {
          const data = await res.json()
          setChairName(data.committee_chair)
          setESign(data.enable_esignature)
        }
        const netRes = await fetch(`${API_URL}/system/network`, { headers: { "Authorization": `Bearer ${token}` } })
        if (netRes.ok) setNetworkInfo(await netRes.json())
      } catch (error) {}
    }
    fetchSettings()
  }, [])

  const handleSaveConfig = async () => {
    const token = localStorage.getItem("pasada_token")
    try {
      const res = await fetch(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ committee_chair: chairName.toUpperCase(), enable_esignature: eSign })
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (error) {}
  }

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return
    const formData = new FormData()
    formData.append("file", e.target.files[0])
    const token = localStorage.getItem("pasada_token")
    await fetch(`${API_URL}/settings/signature`, {
      method: "POST", headers: { "Authorization": `Bearer ${token}` }, body: formData
    })
    alert("Signature uploaded and saved to OS Documents.")
  }

  const handlePasswordChange = async () => {
    const token = localStorage.getItem("pasada_token")
    const res = await fetch(`${API_URL}/users/password`, {
      method: 'PUT',
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    })
    if (res.ok) setPassMsg("Password updated successfully.")
    else setPassMsg("Failed. Ensure old password is correct and new is 8+ chars.")
  }

  const handleExport = async () => {
    setIsExporting(true)
    const token = localStorage.getItem("pasada_token")
    try {
      const res = await fetch(`${API_URL}/export/mass?route=${exportRoute}&year=${exportYear}`, { headers: { "Authorization": `Bearer ${token}` } })
      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `PASADA_Export_${exportRoute}_${exportYear}.zip`
        a.click()
      }
    } catch (e) {}
    setIsExporting(false)
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6 min-h-screen bg-muted/10">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">System Configuration</h2>
        <p className="text-muted-foreground mt-1">Manage global variables, security, and mass data exports.</p>
      </div>

      <Tabs defaultValue="general" className="mt-6">
        <TabsList className="grid w-full grid-cols-4 max-w-3xl">
          <TabsTrigger value="general">General Config</TabsTrigger>
          <TabsTrigger value="security">Account Security</TabsTrigger>
          <TabsTrigger value="export">Data Backup</TabsTrigger>
          <TabsTrigger value="network">LAN Network</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card className="max-w-2xl shadow-sm border-border/50">
            <CardHeader><CardTitle className="flex items-center gap-2"><SettingsIcon className="h-5 w-5 text-blue-500" /> Document Settings</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Committee Chairman Name</Label>
                <Input value={chairName} onChange={(e) => setChairName(e.target.value)} className="uppercase max-w-md bg-muted/50" />
              </div>
              <div className="space-y-2">
                <Label>Upload Official E-Signature (.png)</Label>
                <Input type="file" accept="image/png" onChange={handleSignatureUpload} className="max-w-md cursor-pointer" />
              </div>
              <div className="flex items-center justify-between border p-4 rounded-xl bg-card max-w-md">
                <div className="space-y-0.5"><Label>Enable E-Signatures</Label><p className="text-xs text-muted-foreground">Print docs with uploaded signature.</p></div>
                <Switch checked={eSign} onCheckedChange={setESign} />
              </div>
              <Button onClick={handleSaveConfig} className="w-full max-w-md">Save Configuration</Button>
              {saved && <p className="text-sm text-green-600 flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/> Saved.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card className="max-w-2xl shadow-sm border-border/50">
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" /> Password Management</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Current Password</Label><Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="max-w-md" /></div>
              <div className="space-y-2"><Label>New Password (Min 8 Chars)</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="max-w-md" /></div>
              <Button onClick={handlePasswordChange} className="w-full max-w-md bg-amber-600 hover:bg-amber-700">Update Credentials</Button>
              {passMsg && <p className="text-sm text-muted-foreground">{passMsg}</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export">
          <Card className="max-w-2xl shadow-sm border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><DownloadCloud className="h-5 w-5 text-green-500" /> Mass Document Export</CardTitle>
              <CardDescription>Generates a .ZIP containing CSV registries and exact .docx templates for external filing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 max-w-md">
                <div className="space-y-2"><Label>Target TODA</Label><Input value={exportRoute} onChange={(e) => setExportRoute(e.target.value)} placeholder="ALL" className="uppercase" /></div>
                <div className="space-y-2"><Label>Target Year</Label><Input value={exportYear} onChange={(e) => setExportYear(e.target.value)} placeholder="ALL" /></div>
              </div>
              <Button onClick={handleExport} disabled={isExporting} className="w-full max-w-md bg-green-600 hover:bg-green-700">
                {isExporting ? "Compiling Mass Backup..." : "Export ZIP Archive"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network">
          <Card className="max-w-2xl shadow-sm border-border/50">
            <CardHeader><CardTitle className="flex items-center gap-2"><Network className="h-5 w-5 text-indigo-500" /> Auto-Discovery LAN Sync</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900">
                <p className="font-semibold text-indigo-900 dark:text-indigo-400">Node IP Address: {networkInfo.local_ip}</p>
                <p className="text-sm text-indigo-700/70 mt-1">This node continuously broadcasts to other PASADA applications on this Wi-Fi network.</p>
              </div>
              <div>
                <Label>Connected Peer Laptops</Label>
                {networkInfo.connected_peers.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-2 border p-4 rounded-lg bg-muted/20">Listening for peers...</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {networkInfo.connected_peers.map(ip => (
                      <li key={ip} className="text-sm font-mono bg-muted p-2 rounded border">{ip}</li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}