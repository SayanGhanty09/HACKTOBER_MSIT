@echo off
echo Enabling Windows Long Path support...
powershell -NoProfile -Command "Start-Process reg -ArgumentList 'add \"HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\" /v LongPathsEnabled /t REG_DWORD /d 1 /f' -Verb RunAs"
echo Done! Once you click 'Yes' on the Windows prompt, Long Paths are enabled.
pause
