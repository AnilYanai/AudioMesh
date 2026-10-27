@echo off
setlocal enabledelayedexpansion
title VoiceMorph - Windows Audio Driver Installer

echo ==========================================================
echo  VoiceMorph Virtual Audio Cable Setup for Windows
echo ==========================================================

:: 1. Check if VB-Audio Cable is already installed via Win32_SoundDevice
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "if (Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*VB-Audio*' }) { exit 0 } else { exit 1 }"

if %ERRORLEVEL% EQU 0 (
    echo [OK] VB-Audio Virtual Cable is already installed on this PC!
    goto :done
)

echo [INFO] VB-Audio Virtual Cable not detected.
echo [INFO] Downloading official signed driver package from vb-audio.com...

:: 2. Download, extract, and elevate silent installer via PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$url = 'https://download.vb-audio.com/Download_CAB/VBCABLE_Driver_Pack43.zip'; " ^
    "$zip = Join-Path $env:TEMP 'vbcable.zip'; " ^
    "$dest = Join-Path $env:TEMP 'vbcable_setup'; " ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "Write-Host '[1/3] Downloading official VB-Cable zip...'; " ^
    "Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing; " ^
    "Write-Host '[2/3] Extracting installer package...'; " ^
    "if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }; " ^
    "Expand-Archive -Path $zip -DestinationPath $dest -Force; " ^
    "Write-Host '[3/3] Launching driver installer with Admin elevation...'; " ^
    "Write-Host '(Please click YES on the Windows UAC security prompt)'; " ^
    "Start-Process (Join-Path $dest 'VBCABLE_Setup_x64.exe') -ArgumentList '-i' -Verb RunAs -Wait; " ^
    "Write-Host 'Cleaning temporary files...'; " ^
    "Remove-Item $zip -Force -ErrorAction SilentlyContinue; " ^
    "Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue;"

echo ==========================================================
echo [SUCCESS] VB-Audio Virtual Cable setup complete!
echo In Discord / Games, select 'CABLE Output' as your Microphone.
echo ==========================================================

:done
