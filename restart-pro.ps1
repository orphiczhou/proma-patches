# Restart pro: kill Proma-green + relaunch with full ISOLATED env.
Write-Output 'killing pro (Proma-green)...'
Stop-Process -Name Proma-green -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$remain = @(Get-Process -Name Proma-green -ErrorAction SilentlyContinue)
Write-Output "remaining Proma-green: $($remain.Count)"
if($remain.Count -eq 0){
  $env:PROMA_INSTANCE_NAME = 'pro'
  $env:PROMA_INSTANCE_ISOLATED = '1'
  $env:PROMA_INDEPENDENT_PROFILE = '1'
  $env:CLAUDE_CONFIG_DIR = 'C:\Users\sir_c\.proma-pro\sdk-config'
  $env:CLAUDE_CODE_EXECPATH = 'D:\Proma-dev\resources\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe'
  Start-Process -FilePath 'D:\Proma-dev\Proma-green.exe' -WorkingDirectory 'D:\Proma-dev'
  Write-Output 'LAUNCHED pro (ISOLATED=1)'
} else {
  Write-Output 'ABORT: kill incomplete, not relaunching'
}
