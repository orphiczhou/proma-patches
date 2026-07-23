# Restart dev: kill Proma-white + relaunch with full ISOLATED env (separate userData/lock from release).
Write-Output 'killing dev (Proma-white)...'
Stop-Process -Name Proma-white -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$remain = @(Get-Process -Name Proma-white -ErrorAction SilentlyContinue)
Write-Output "remaining Proma-white: $($remain.Count)"
if($remain.Count -eq 0){
  $env:PROMA_INSTANCE_NAME = 'dev'
  $env:PROMA_INSTANCE_ISOLATED = '1'
  $env:PROMA_INDEPENDENT_PROFILE = '1'
  $env:CLAUDE_CONFIG_DIR = 'C:\Users\sir_c\.proma-dev\sdk-config'
  $env:CLAUDE_CODE_EXECPATH = 'D:\Proma-dev\resources\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe'
  Start-Process -FilePath 'D:\Proma-dev\Proma-white.exe' -WorkingDirectory 'D:\Proma-dev'
  Write-Output 'LAUNCHED dev (ISOLATED=1)'
} else {
  Write-Output 'ABORT: kill incomplete, not relaunching'
}
