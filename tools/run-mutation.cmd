@echo off
rem =========================================================================
rem run-mutation.cmd -- the full mutation battery, as a run that outlives
rem whatever started it. Keep this file ASCII only: cmd reads a script in the
rem OEM code page and mangles anything else in this repo's path.
rem
rem   tools\run-mutation.cmd           the full run (about 50 minutes)
rem   tools\run-mutation.cmd check     only ask whether this machine can run it
rem
rem The full run writes tools\.mutation-run.log (everything the harness prints)
rem and tools\.mutation-run.exit (its exit code; the file appearing means the run
rem is over). The verdict is tools\mutation-report.md.
rem
rem WHY THIS EXISTS. The battery is longer than a tool call or a terminal that
rem may close, so it is meant to be launched detached. A detached process does
rem not inherit what an interactive shell has, and two things it lacks cost an
rem afternoon (see claude\33-harness-counted-a-dead-suite-as-caught.md in
rem energytech-api, the section on what a machine needs):
rem
rem  1. PLAYWRIGHT_BROWSERS_PATH. The Claude desktop app is a packaged app: its
rem     LOCALAPPDATA is a private copy. Browsers installed from inside the app
rem     land under LOCALAPPDATA\Packages\Claude_*\LocalCache\Local\ms-playwright,
rem     and a process started from outside the app looks in the real
rem     LOCALAPPDATA\ms-playwright, finds nothing, and every browser suite dies
rem     at launch. Set below, only when nothing else says where the browsers are.
rem  2. unzip. The worksheet suites run it. It comes with Git for Windows (in
rem     usr\bin), which Git Bash has on PATH and a plain cmd does not. APPENDED,
rem     so it can only fill a gap: Git's find and sort must not shadow Windows.
rem
rem LAUNCHING DETACHED from PowerShell. Not Start-Process: it can stay inside the
rem caller's job object and die with it. WMI starts a process that belongs to no
rem job the caller controls:
rem
rem   Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
rem     CommandLine = 'cmd.exe /c "C:\full\path\to\energytech-mathquiz\tools\run-mutation.cmd"' }
rem
rem IF A RUN DIES. Each mutant is a temporary edit to a real source file. Do not
rem kill the run while one is applied. If it dies anyway, just start the harness
rem again: it finds tools\.mutation-snapshot\in-flight.json and restores the file
rem before doing anything else. Check git status in both repos before trusting
rem anything, and before committing.
rem =========================================================================
setlocal
cd /d "%~dp0.."

rem --- 1. Playwright browsers ------------------------------------------------
if defined PLAYWRIGHT_BROWSERS_PATH goto browsers_done
if exist "%LOCALAPPDATA%\ms-playwright" goto browsers_done
for /d %%D in ("%LOCALAPPDATA%\Packages\Claude_*") do if exist "%%~D\LocalCache\Local\ms-playwright" set "PLAYWRIGHT_BROWSERS_PATH=%%~D\LocalCache\Local\ms-playwright"
:browsers_done

rem --- 2. unzip --------------------------------------------------------------
where unzip >nul 2>&1
if errorlevel 1 if exist "%ProgramFiles%\Git\usr\bin\unzip.exe" set "PATH=%PATH%;%ProgramFiles%\Git\usr\bin"

if /i "%~1"=="check" goto check

node tools\mutate_backend.js > "%~dp0.mutation-run.log" 2>&1
echo %errorlevel% > "%~dp0.mutation-run.exit"
exit /b 0

:check
node tools\mutate_backend.js --preflight-only
exit /b %errorlevel%
