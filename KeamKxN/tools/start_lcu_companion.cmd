@echo off
py -B "%~dp0lcu_companion.py" %*
if errorlevel 1 pause
