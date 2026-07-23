# Launch dev with PROMA_INSTANCE_ISOLATED=1 (the real userData/lock separator, not PROMA_INDEPENDENT_PROFILE).
# Without ISOLATED, packaged dev defaults to @proma/electron and collides with release's lock.
$env:PROMA_INSTANCE_NAME = 'dev'
$env:PROMA_INSTANCE_ISOLATED = '1'
$env:PROMA_INDEPENDENT_PROFILE = '1'
$env:CLAUDE_CONFIG_DIR = 'C:\Users\sir_c\.proma-dev\sdk-config'
$env:CLAUDE_CODE_EXECPATH = 'D:\Proma-dev\resources\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe'
Start-Process -FilePath 'D:\Proma-dev\Proma-white.exe' -WorkingDirectory 'D:\Proma-dev'
Write-Output 'launched dev (ISOLATED=1), wait 12s...'
Start-Sleep -Seconds 12
$w = @(Get-Process -Name Proma-white -ErrorAction SilentlyContinue)
Write-Output "Proma-white count: $($w.Count)"
$conn = Get-NetTCPConnection -LocalPort 19878 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if($conn){ Write-Output "OK 19878 LISTEN PID=$($conn.OwningProcess)" } else { Write-Output '19878 not listening' }
