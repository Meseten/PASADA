"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import Link from "next/link"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const trimmedName = fullName.trim()
      const nameParts = trimmedName.split(" ")
      const firstName = nameParts[0]
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : " "
      const username = trimmedName.toUpperCase()

      const payload = {
        first_name: firstName,
        last_name: lastName,
        username: username,
        password: password,
        role: "Clerk"
      }

      const response = await fetch(`${API_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        router.push("/")
      } else {
        const data = await response.json()
        setError(data.detail || "Registration failed. Ensure the name isn't already registered.")
      }
    } catch (error) {
      console.error(error)
      setError("Server disconnected. Ensure the Host PC is running.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-muted/50 to-background p-4">
      <Card className="w-full max-w-[420px] shadow-2xl border-border/50 bg-card/95 backdrop-blur">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mb-4 shadow-lg shadow-blue-500/30">
            <span className="text-2xl font-black text-white">P</span>
          </div>
          <CardTitle className="text-3xl font-extrabold tracking-tight text-foreground">PASADA</CardTitle>
          <CardDescription className="text-sm font-medium mt-2">Personnel Registration Portal</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullname" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Authorized Full Name</Label>
              <Input 
                id="fullname" 
                placeholder="e.g. JUAN DELA CRUZ" 
                value={fullName} 
                onChange={(e) => setFullName(e.target.value)} 
                required 
                className="h-12 bg-muted/30 focus-visible:ring-blue-500 transition-all uppercase" 
              />
              <p className="text-[11px] text-muted-foreground mt-1">This exact name will be permanently tied to your audit trail.</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Secure Passcode</Label>
              <div className="relative">
                <Input 
                  id="password" 
                  type={showPassword ? "text" : "password"} 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  required 
                  className="h-12 bg-muted/30 focus-visible:ring-blue-500 transition-all pr-12 font-mono" 
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            
            {error && <div className="text-sm text-red-600 bg-red-500/10 p-3 rounded-lg border border-red-500/20 font-medium animate-in fade-in slide-in-from-top-2">{error}</div>}
            
            <Button type="submit" disabled={loading} className="w-full h-12 text-md font-bold bg-blue-600 hover:bg-blue-700 transition-all shadow-md hover:shadow-lg mt-2">
              {loading ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Registering...</> : "Create Account"}
            </Button>
            
            <div className="text-center mt-6 text-sm font-medium text-muted-foreground">
              Already authorized? <Link href="/" className="text-blue-600 hover:text-blue-700 hover:underline transition-colors">Return to Login</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}