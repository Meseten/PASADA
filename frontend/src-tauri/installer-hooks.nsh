; PASADA installer hooks (Tauri v2 bundle.windows.nsis.installerHooks).
;
; WHY THIS EXISTS: PASADA computers find each other by broadcasting on UDP
; port 54321 and then talk to each other on TCP port 43888. Windows Defender
; Firewall silently blocks BOTH for any program it has not been told about,
; so a freshly installed computer sits there forever showing
; "Connected computers: none yet" while the other office computers never
; appear — exactly the "second computer won't sync" failure.
;
; The NSIS installer runs elevated, so this is the one place a firewall rule
; can be added WITHOUT asking the user anything. The rule is deleted first
; so reinstalling or updating PASADA over an old install always leaves
; exactly one correct rule, even if the install path changed.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Allowing PASADA in Windows Firewall (computers must reach each other)..."
  nsExec::Exec 'netsh advfirewall firewall delete-rule name="$\"PASADA backend sync$\""'
  nsExec::Exec 'netsh advfirewall firewall add rule name="$\"PASADA backend sync$\"" description="$\"PASADA record sharing between office computers$\"" dir=in action=allow program="$\"$INSTDIR\backend\pasada-backend.exe$\"" enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall add rule name="$\"PASADA backend sync (UDP)$\"" description="$\"PASADA discovery broadcasts$\"" dir=in action=allow protocol=UDP localport=54321 enable=yes profile=any'
!macroend
