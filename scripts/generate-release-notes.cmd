@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0generate-release-notes.ps1" %*
