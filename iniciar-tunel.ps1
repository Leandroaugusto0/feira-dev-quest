# Sobe o tunel da Cloudflare, pega o endereco publico e inicia o jogo com ele dentro do QR code.
# Uso: dois cliques em iniciar-tunel.bat
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$port = if ($env:PORT) { [int]$env:PORT } else { 8787 }

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "A porta $port ja esta em uso. Provavelmente o jogo ja esta aberto em outra janela."
  Write-Host 'Feche a outra janela (iniciar.bat ou iniciar-tunel.bat) e tente de novo.'
  exit 1
}

# recarrega o PATH (cobre o caso de ter acabado de instalar o cloudflared) e tenta o local padrao do instalador
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$padrao = "${env:ProgramFiles(x86)}\cloudflared"
if (Test-Path "$padrao\cloudflared.exe") { $env:Path += ";$padrao" }

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'cloudflared nao encontrado. Instale com:'
  Write-Host '  winget install --id Cloudflare.cloudflared --source winget'
  exit 1
}
if (-not (Test-Path node_modules)) {
  Write-Host 'Instalando dependencias, so na primeira vez...'
  npm install
}

$log = Join-Path $env:TEMP 'devquest-tunel.log'
Remove-Item $log, "$log.out" -ErrorAction SilentlyContinue

Write-Host 'Abrindo o tunel da Cloudflare (leva alguns segundos)...'
# -NoNewWindow: o tunel fica preso a esta janela. Fechar a janela (ou Ctrl+C) derruba o tunel junto.
$tunnel = Start-Process cloudflared -ArgumentList 'tunnel', '--url', "http://localhost:$port" `
  -RedirectStandardError $log -RedirectStandardOutput "$log.out" -NoNewWindow -PassThru

$url = $null
for ($i = 0; $i -lt 45 -and -not $url -and -not $tunnel.HasExited; $i++) {
  Start-Sleep 1
  if (Test-Path $log) {
    $hit = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue |
      ForEach-Object { $_.Matches } | Where-Object { $_.Value -notlike 'https://api.*' } | Select-Object -First 1
    if ($hit) { $url = $hit.Value }
  }
}

if (-not $url) {
  Write-Host ''
  Write-Host 'Nao consegui abrir o tunel. Ultimas linhas do log:'
  if (Test-Path $log) { Get-Content $log -Tail 15 }
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  exit 1
}

$env:PUBLIC_URL = $url
Write-Host ''
Write-Host "Endereco publico do jogo: $url"
Write-Host 'Deixe esta janela aberta durante o evento. Para encerrar, feche a janela.'
Write-Host ''

$srv = Start-Process node -ArgumentList 'server.js' -NoNewWindow -PassThru
Start-Sleep 2
if ($srv.HasExited) {
  Write-Host 'O servidor do jogo nao iniciou (veja a mensagem acima).'
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  exit 1
}
Start-Process "http://localhost:$port"   # a tela grande abre em localhost, so o celular passa pelo tunel

try {
  Wait-Process -Id $srv.Id
} finally {
  if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  if (-not $srv.HasExited) { Stop-Process -Id $srv.Id -Force }
}
