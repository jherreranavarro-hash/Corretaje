<#
 Instalador con Docker para Windows 10/11 (PowerShell). NO PROBADO en el entorno de desarrollo: si algo falla, copie el mensaje de error.
   .\instalar-docker.ps1                     instala (pide empresa, RUT y correo) o ACTUALIZA si ya está instalado
   .\instalar-docker.ps1 -Demo               con datos y usuarios de ejemplo
   .\instalar-docker.ps1 -Respaldo           crea un respaldo en .\respaldos
   .\instalar-docker.ps1 -Desinstalar [-BorrarDatos]
 Opciones: -Empresa "Nombre" -Rut 76.123.456-7 -AdminEmail yo@correo.cl -Puerto 3000
 Si Windows bloquea el script:  powershell -ExecutionPolicy Bypass -File .\instalar-docker.ps1
#>
param([string]$Empresa = "", [string]$Rut = "", [string]$AdminEmail = "", [switch]$Demo, [int]$Puerto = 3000,
      [switch]$Respaldo, [switch]$Desinstalar, [switch]$BorrarDatos)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Info($m) { Write-Host "[..] $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[X] $m" -ForegroundColor Red; exit 1 }
function RandHex([int]$bytes) { $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b | ForEach-Object { $_.ToString("x2") }) -join "") }
function RandPass { $chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray(); $b = New-Object byte[] 14; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b | ForEach-Object { $chars[$_ % $chars.Length] }) -join "") + "Aa1" }
function WriteUtf8NoBom($path, $text) { [IO.File]::WriteAllText((Join-Path $PSScriptRoot $path), $text, (New-Object Text.UTF8Encoding $false)) }
function Docker-Ok { cmd /c "docker info >nul 2>&1"; return ($LASTEXITCODE -eq 0) }

# ---- Docker disponible
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "No se encontró Docker."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $r = Read-Host "¿Instalar Docker Desktop con winget ahora? [s/N]"
    if ($r -match "^[sSyY]") {
      winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
      Write-Host "Docker Desktop instalado. REINICIE el equipo si se lo pide, abra Docker Desktop, acepte los términos y vuelva a ejecutar este script cuando indique 'Engine running'."
      exit 0
    }
  }
  Fail "Instale Docker Desktop desde https://www.docker.com/products/docker-desktop y vuelva a ejecutar este script."
}
if (-not (Docker-Ok)) { Fail "Docker está instalado pero no está en ejecución. Abra Docker Desktop, espere a que diga 'Engine running' y reintente." }
cmd /c "docker compose version >nul 2>&1"; if ($LASTEXITCODE -ne 0) { Fail "Falta 'docker compose' (Docker Desktop reciente lo incluye)." }

# ---- Respaldo / desinstalar
if ($Respaldo) {
  New-Item -ItemType Directory -Force -Path respaldos | Out-Null
  $f = "respaldos\corretaje-" + (Get-Date -Format "yyyyMMdd-HHmm")
  cmd /c "docker compose exec -T db pg_dump -U postgres -Fc corretaje > `"$f.dump`""
  cmd /c "docker compose exec -T app tar -czf - -C /app uploads > `"$f-fotos.tgz`""
  Ok "Respaldo creado: $f.dump y $f-fotos.tgz"; exit 0
}
if ($Desinstalar) {
  if ($BorrarDatos) { docker compose down -v; Remove-Item -Force -ErrorAction SilentlyContinue .env, credenciales.txt; Ok "Desinstalado y datos eliminados" }
  else { docker compose down; Ok "Detenido. Los datos se conservan (use -BorrarDatos para eliminarlos)" }
  exit 0
}

# ---- Configuración (primera vez)
$primera = -not (Test-Path ".env")
if ($primera) {
  if (-not $Demo) {
    if (-not $Empresa)    { $Empresa    = Read-Host "Nombre de la empresa" }
    if (-not $Rut)        { $Rut        = Read-Host "RUT de la empresa (ej. 76.123.456-7)" }
    if (-not $AdminEmail) { $AdminEmail = Read-Host "Correo del administrador (será su usuario)" }
    if (-not ($Empresa -and $Rut -and $AdminEmail)) { Fail "Faltan empresa, RUT o correo (o use -Demo)." }
    if ($AdminEmail -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") { Fail "Correo inválido: $AdminEmail" }
  }
  $adminPass = RandPass; $demoPass = "Demo-" + (RandHex 4) + "-Aa1"
  $l = @("POSTGRES_ADMIN_PASSWORD=$(RandHex 16)", "APP_DB_PASSWORD=$(RandHex 16)", "JWT_SECRET=$(RandHex 48)", "INTEGRATIONS_KEY=$(RandHex 32)", "PORT=$Puerto")
  if ($Demo) { $l += "SEED_MODE=demo"; $l += "DEMO_PASSWORD=$demoPass"; $usuario = "admin@demo.cl"; $clave = $demoPass }
  else { $l += "SEED_MODE=produccion"; $l += "EMPRESA_NOMBRE=$Empresa"; $l += "EMPRESA_RUT=$Rut"; $l += "ADMIN_EMAIL=$AdminEmail"; $l += "ADMIN_PASSWORD=$adminPass"; $usuario = $AdminEmail; $clave = $adminPass }
  WriteUtf8NoBom ".env" (($l -join "`n") + "`n")
  WriteUtf8NoBom "credenciales.txt" ("Usuario: $usuario`nClave:   $clave`n(Cámbiela al ingresar: menú Cuenta > Cambiar contraseña. Elimine este archivo después.)`n")
  Ok "Configuración generada (.env)"
} else {
  $m = Select-String -Path .env -Pattern "^PORT=(\d+)" ; if ($m) { $Puerto = [int]$m.Matches[0].Groups[1].Value }
  Ok "Instalación existente: se conservan configuración y datos"
}

# ---- Levantar
Info "Construyendo e iniciando (la primera vez descarga imágenes: puede tardar varios minutos)"
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose falló. Revise el mensaje anterior." }
Info "Esperando a que el sistema responda"
$listo = $false
for ($i = 0; $i -lt 90; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Puerto/api/health" -TimeoutSec 3; if ($r.StatusCode -eq 200) { $listo = $true; break } } catch { }
  Start-Sleep -Seconds 2
}
if (-not $listo) { Fail "No respondió a tiempo. Revise: docker compose logs app" }
if ($primera) { (Get-Content .env) -replace "^ADMIN_PASSWORD=.*", "ADMIN_PASSWORD=" | Set-Content -Encoding ascii .env }   # ya no se necesita

Write-Host ""; Write-Host "======== Instalación completa ========" -ForegroundColor Green
Write-Host "Abra: http://localhost:$Puerto"
if ($primera) { Write-Host ""; Get-Content credenciales.txt }
Write-Host ""; Write-Host "Respaldo: .\instalar-docker.ps1 -Respaldo    Actualizar: git pull; .\instalar-docker.ps1    Detener: docker compose stop"
if ($primera -and -not $Demo) { Write-Host "Pendiente: revise Mantenedores > Índices (UF/IPC), Comisiones y Administración > Parámetros." }
