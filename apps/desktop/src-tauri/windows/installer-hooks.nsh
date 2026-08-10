!define PI_AGENT_INSTALLER_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File /oname=$PLUGINSDIR\stop-sidecar.ps1 "${PI_AGENT_INSTALLER_HOOK_DIR}\stop-sidecar.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-sidecar.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1

  ${If} $0 != 0
    DetailPrint "Unable to stop PI-AI-Agent sidecar: $1"
    MessageBox MB_ICONSTOP|MB_OK "PI-AI-Agent is still using files required by this update. Close the application and try again."
    Abort
  ${EndIf}
!macroend
