; NSIS additions for the Windows installer.
;
; Two jobs: warn before installing somewhere without room for the models, and
; leave the user's projects and models in place when uninstalling.

!macro customInit
  ; The application itself is about 400 MB; a user who intends to add the
  ; medium or large model needs several gigabytes more. Say so before they
  ; find out from a failed transcription.
  ${GetRoot} "$INSTDIR" $R0
  ${DriveSpace} "$R0" "/D=F /S=M" $R1
  ${If} $R1 < 2000
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "This drive has less than 2 GB free.$\n$\nSubtitleForge needs about 400 MB, plus 75 MB to 3 GB for each speech model you install.$\n$\nInstall anyway?" \
      IDYES continueInstall
    Abort
    continueInstall:
  ${EndIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Keep your projects and downloaded speech models?$\n$\nThey are in:$\n$APPDATA\SubtitleForge$\n$\nChoose Yes to keep them (recommended), No to delete them." \
      IDYES keepUserData
    RMDir /r "$APPDATA\SubtitleForge"
    keepUserData:
  ${endIf}
!macroend
