# Mantem o backend do Archilume rodando: confere a cada 10s e reinicia se cair.
$ErrorActionPreference = 'SilentlyContinue'
$root = "C:\Users\MonkeyPC\Documents\claude\archilume-backend"

while ($true) {
    $healthy = $false
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3900/health" -TimeoutSec 2 -UseBasicParsing
        if ($resp.StatusCode -eq 200) { $healthy = $true }
    } catch {}

    if (-not $healthy) {
        $conn = Get-NetTCPConnection -LocalPort 3900 -State Listen -ErrorAction SilentlyContinue
        if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
        Start-Process -FilePath "node" -ArgumentList "src\server.js" -WorkingDirectory $root -WindowStyle Hidden
        Write-Output "[$(Get-Date -Format 'HH:mm:ss')] backend estava fora do ar, reiniciei"
    }

    Start-Sleep -Seconds 10
}
