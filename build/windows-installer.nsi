; Per-user Unicode installer. NSIS generates its uninstaller at install time,
; allowing an unsigned installer to be compiled without running Wine.
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

Name "ClipSync"
RequestExecutionLevel user
CRCCheck force
InstallDir "$LOCALAPPDATA\Programs\ClipSync"
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!ifndef MUI_ICON
  !define MUI_ICON "${PROJECT_DIR}/build/icons/icon.ico"
!endif
!ifndef MUI_UNICON
  !define MUI_UNICON "${PROJECT_DIR}/build/icons/icon.ico"
!endif
!define MUI_FINISHPAGE_RUN "$INSTDIR\ClipSync.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_LANGDLL_REGISTRY_ROOT HKCU
!define MUI_LANGDLL_REGISTRY_KEY "Software\ClipSync"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro addLangs

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "ClipSync requires 64-bit Windows."
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Section "ClipSync" install
  SetOutPath "$INSTDIR"
  File /r "${PROJECT_DIR}/release/installers/win-unpacked/*"
  WriteUninstaller "$INSTDIR\Uninstall ClipSync.exe"
  CreateDirectory "$SMPROGRAMS\ClipSync"
  CreateShortcut "$SMPROGRAMS\ClipSync\ClipSync.lnk" "$INSTDIR\ClipSync.exe"
  CreateShortcut "$SMPROGRAMS\ClipSync\Uninstall ClipSync.lnk" "$INSTDIR\Uninstall ClipSync.exe"
  CreateShortcut "$DESKTOP\ClipSync.lnk" "$INSTDIR\ClipSync.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "DisplayName" "ClipSync"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "DisplayIcon" "$INSTDIR\ClipSync.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "UninstallString" '"$INSTDIR\Uninstall ClipSync.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync" "NoRepair" 1
SectionEnd

Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Section "Uninstall"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ClipSync"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ClipSync"
  Delete "$DESKTOP\ClipSync.lnk"
  Delete "$SMPROGRAMS\ClipSync\ClipSync.lnk"
  Delete "$SMPROGRAMS\ClipSync\Uninstall ClipSync.lnk"
  RMDir "$SMPROGRAMS\ClipSync"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClipSync"
  DeleteRegKey HKCU "Software\ClipSync"
  ; User data and received files outside the application directory are retained.
SectionEnd
