@echo off
title Kiosk Launcher RSUD Bukit Kerman
echo Membuka Chrome Mode Kiosk Silent Printing...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing "http://localhost:3000/kiosk"
exit