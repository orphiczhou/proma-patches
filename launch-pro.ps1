# Launch pro (Proma-green.exe, shares D:\Proma-dev dist with dev). ISOLATED=1 for own userData/lock.
$env:PROMA_INSTANCE_NAME = 'pro'
$env:PROMA_INSTANCE_ISOLATED = '1'
$env:PROMA_INDEPENDENT_PROFILE = '1'
$env:CLAUDE_CONFIG_DIR = 'C:\Users\sir_c\.proma-pro\sdk-config'
$env:CLAUDE_CODE_EXECPATH = 'D:\Proma-dev\resources\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe'
Start-Process -FilePath 'D:\Proma-dev\Proma-green.exe' -WorkingDirectory 'D:\Proma-dev'
Write-Output 'launched pro (ISOLATED=1), wait 15s...'
Start-Sleep -Seconds 15
$w = @(Get-Process -Name Proma-green -ErrorAction SilentlyContinue)
Write-Output "Proma-green count: $($w.Count)"
