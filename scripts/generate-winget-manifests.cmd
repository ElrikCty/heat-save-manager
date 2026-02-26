@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0generate-winget-manifests.ps1" %*
