<#
  Сборка AE для Android на Windows.

  Запуск из папки проекта (двойной щелчок по build-android.cmd или в PowerShell):
    powershell -ExecutionPolicy Bypass -File tools\android\build-android.ps1                 # подписанный AAB для Google Play
    powershell -ExecutionPolicy Bypass -File tools\android\build-android.ps1 -Mode DebugApk  # APK для проверки на своём телефоне
    ... -VersionCode 2                         # номер сборки (увеличивайте при каждой загрузке в Google Play)
    ... -OverlayDir папка                      # свежие решения админ-панели: в папке файлы <предмет>.json
                                               # (резервные копии «Админ-панель → Публикация → Сохранить копию», например crm.json)

  Нужно заранее: Node.js 22+, Android Studio (Otter 2025.2.1 или новее) с Android SDK 36, JDK 21 (подойдёт 21–24;
  если подходящего нет — скрипт предложит установить Eclipse Temurin 21 через winget).
  Пароли ключа подписи вводятся только здесь, в окне сборки, и никуда не сохраняются.
  Никому их не сообщайте, в том числе в чат.
#>
[CmdletBinding()]
param(
  [ValidateSet('Aab', 'Apk', 'DebugApk')] [string] $Mode = 'Aab',
  [int] $VersionCode = 0,
  [string] $OverlayDir = '',
  [string] $Keystore = (Join-Path $env:USERPROFILE 'ae-keys\upload-keystore.jks'),
  [string] $KeyAlias = 'upload'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Say([string] $text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail([string] $text) { Write-Host ''; Write-Host "ОШИБКА: $text" -ForegroundColor Red; exit 1 }
function Run([string] $what, [scriptblock] $cmd) {
  Say $what
  & $cmd
  if ($LASTEXITCODE -ne 0) { Fail "$what — команда завершилась с кодом $LASTEXITCODE" }
}
function WriteText([string] $path, [string] $text) {
  # UTF-8 без BOM: Gradle и properties-файлы BOM не ждут
  [System.IO.File]::WriteAllText((Join-Path $root $path), $text, (New-Object System.Text.UTF8Encoding $false))
}
function Plain([System.Security.SecureString] $s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
Write-Host "Проект: $root"

# ───── 1. Проверка инструментов ─────
Say 'Проверка инструментов'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Не найден Node.js. Установите версию 22 или новее с https://nodejs.org и перезапустите окно.' }
$nodeMajor = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { Fail "Нужен Node.js 22 или новее, установлен $(& node -v)." }
Write-Host "Node.js $(& node -v)"

# JDK: Capacitor 8 компилируется на Java 21, а Gradle 8.14 запускается не новее чем на Java 24 — значит, нужна Java 21–24 (лучше 21). Java 25 и новее не подходит
# («Unsupported class file major version 69»), поэтому ищем подходящий JDK, а не берём первый попавшийся.
function JavaMajor([string] $jdk) {
  if (-not $jdk) { return 0 }
  $exe = Join-Path $jdk 'bin\java.exe'
  if (-not (Test-Path $exe)) { return 0 }
  # java -version пишет в поток ошибок; в Windows PowerShell 5.1 это не должно прерывать скрипт
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $line = (& $exe -version 2>&1 | Select-Object -First 1 | Out-String) } finally { $ErrorActionPreference = $old }
  if ($line -match 'version "1\.(\d+)') { return [int]$Matches[1] }
  if ($line -match 'version "(\d+)') { return [int]$Matches[1] }
  return 0
}
function FindJdk {
  $cands = @()
  if ($env:JAVA_HOME) { $cands += $env:JAVA_HOME }
  $cands += (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr')
  $cands += (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr')
  foreach ($vendor in @('Eclipse Adoptium', 'Microsoft', 'Java', 'Zulu', 'BellSoft', 'Amazon Corretto')) {
    $dir = Join-Path $env:ProgramFiles $vendor
    if (Test-Path $dir) { $cands += (Get-ChildItem $dir -Directory | ForEach-Object { $_.FullName }) }
  }
  $found = @()
  foreach ($c in ($cands | Select-Object -Unique)) {
    $v = JavaMajor $c
    if ($v -gt 0) { $found += [pscustomobject]@{ Path = $c; Version = $v } }
  }
  foreach ($f in $found) { Write-Host ("  найден JDK {0}: {1}" -f $f.Version, $f.Path) }
  $ok = @($found | Where-Object { $_.Version -ge 21 -and $_.Version -le 24 })
  $best = $ok | Where-Object { $_.Version -eq 21 } | Select-Object -First 1
  if (-not $best) { $best = $ok | Sort-Object Version -Descending | Select-Object -First 1 }
  return $best
}
$jdk = FindJdk
if (-not $jdk) {
  Write-Host ''
  Write-Host 'Не найден подходящий JDK (нужна Java 21–24, лучше 21). Java 25 и новее Gradle 8.14 не поддерживает, а Java 17 слишком старая для Capacitor 8.' -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Fail 'Установите JDK 21 (Eclipse Temurin): https://adoptium.net/temurin/releases/?version=21 — файл .msi для Windows x64, затем запустите сборку снова.' }
  $answer = Read-Host 'Установить JDK 21 (Eclipse Temurin) сейчас через winget? Введите Y и нажмите Enter'
  if ($answer -notmatch '^[YyДд]') { Fail 'Установите JDK 21: https://adoptium.net/temurin/releases/?version=21 и запустите сборку снова.' }
  & winget install --id EclipseAdoptium.Temurin.21.JDK -e --accept-source-agreements --accept-package-agreements
  $env:JAVA_HOME = ''
  $jdk = FindJdk
  if (-not $jdk) { Fail 'JDK 21 установлен, но не найден. Закройте это окно, откройте новое и запустите сборку снова.' }
}
$env:JAVA_HOME = $jdk.Path
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path
Write-Host "JDK для сборки: $env:JAVA_HOME (Java $($jdk.Version))"

if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'platform-tools'))) {
  Fail "Не найден Android SDK в $env:ANDROID_HOME. Откройте Android Studio → More Actions → SDK Manager и установите Android SDK Platform 36 и Android SDK Build-Tools."
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Write-Host "Android SDK: $env:ANDROID_HOME"

# ───── 2. Зависимости и релизная учебная база ─────
Run 'Установка зависимостей (npm install)' { npm install --no-audit --no-fund }

# предметы — из реестра content/subjects.json
$subjects = (Get-Content 'content\subjects.json' -Raw -Encoding UTF8 | ConvertFrom-Json).subjects
if ($OverlayDir) {
  if (-not (Test-Path $OverlayDir)) { Fail "Нет папки с решениями админ-панели: $OverlayDir" }
  foreach ($f in Get-ChildItem (Join-Path $OverlayDir '*.json')) {
    $id = $f.BaseName
    if (-not ($subjects | Where-Object { $_.id -eq $id })) { Fail "Файл $($f.Name): предмета «$id» нет в content\subjects.json" }
    Run "Релизная база: $id (свежие решения админ-панели)" { npx tsx tools/release-pack.ts --subject $id --overlay $f.FullName }
  }
}
foreach ($s in $subjects) {
  if (-not (Test-Path "content\release\$($s.id).json")) { Run "Релизная база: $($s.id) (сохранённые решения)" { npx tsx tools/release-pack.ts --subject $s.id } }
}
Write-Host ''
foreach ($s in $subjects) {
  $line = Get-Content "content\release\REPORT-$($s.id).md" -Encoding UTF8 | Where-Object { $_ -like 'Тем в релизе*' } | Select-Object -First 1
  Write-Host "$($s.title): $line"
}

Run 'Сборка приложения (только утверждённые материалы)' { npm run build:release }

# ───── 3. Нативный проект Android ─────
if (-not (Test-Path 'android\app\build.gradle')) {
  Run 'Создание проекта Android (один раз)' { npx cap add android }
}
Run 'Копирование приложения в проект Android' { npx cap sync android }
Run 'Иконки и заставка' { npx capacitor-assets generate --android --assetPath assets }

# local.properties: путь к SDK для Gradle
$sdkDir = $env:ANDROID_HOME -replace '\\', '\\'
WriteText 'android\local.properties' "sdk.dir=$sdkDir`n"

# требование Google Play: targetSdk 36 (Android 16) для новых приложений с 31.08.2026
$vars = Get-Content 'android\variables.gradle' -Raw
if ($vars -match 'targetSdkVersion\s*=\s*(\d+)') {
  $target = [int]$Matches[1]
  if ($target -lt 36) { Fail "targetSdkVersion = $target, а Google Play требует 36. Обновите Capacitor: npm install @capacitor/core@latest @capacitor/android@latest @capacitor/cli@latest" }
  Write-Host "targetSdkVersion = $target"
}

# версия: versionName — из package.json, versionCode — параметр или текущий + 1 при каждой релизной сборке
$pkg = Get-Content 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$gradlePath = 'android\app\build.gradle'
$gradle = [System.IO.File]::ReadAllText((Join-Path $root $gradlePath))
$current = 1
if ($gradle -match 'versionCode\s+(\d+)') { $current = [int]$Matches[1] }
if ($VersionCode -le 0) {
  $stamp = 'android\.ae-last-release-code'
  if ($Mode -eq 'DebugApk') { $VersionCode = $current }
  elseif (Test-Path $stamp) { $VersionCode = [int](Get-Content $stamp) + 1 }
  else { $VersionCode = 1 }
}
$gradle = $gradle -replace 'versionCode\s+\d+', "versionCode $VersionCode"
$gradle = $gradle -replace 'versionName\s+"[^"]*"', "versionName `"$($pkg.version)`""
WriteText $gradlePath $gradle
Write-Host "Версия $($pkg.version), номер сборки (versionCode) $VersionCode"

# ───── 4. Сборка ─────
$outDir = Join-Path $root 'release'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ($Mode -eq 'DebugApk') {
  Push-Location android
  Run 'Сборка отладочного APK' { .\gradlew.bat assembleDebug }
  Pop-Location
  $apk = 'android\app\build\outputs\apk\debug\app-debug.apk'
  $dest = Join-Path $outDir "AE-$($pkg.version)-debug.apk"
  Copy-Item $apk $dest -Force
  Say "Готово: $dest"
  Write-Host 'Это отладочная сборка: установите её на свой телефон для проверки. В Google Play загружается AAB.'
  exit 0
}

# ключ подписи (upload key) — хранится вне папки проекта, чтобы не попасть в архивы
if (-not (Test-Path $Keystore)) {
  Say 'Создание ключа подписи (один раз)'
  Write-Host 'Сейчас keytool спросит пароль (дважды) и данные владельца (имя, организация, город, страна — можно латиницей).'
  Write-Host "Ключ будет сохранён: $Keystore"
  Write-Host 'ВАЖНО: сохраните этот файл и пароль в надёжном месте (например, на флешке и в менеджере паролей).' -ForegroundColor Yellow
  Write-Host 'Без них нельзя выпускать обновления приложения. Никому их не передавайте.' -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path (Split-Path $Keystore) | Out-Null
  & keytool -genkeypair -v -keystore $Keystore -alias $KeyAlias -keyalg RSA -keysize 2048 -validity 10000
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Keystore)) { Fail 'Ключ подписи не создан.' }
}

$ksPass = Plain (Read-Host -AsSecureString 'Пароль ключа подписи')
$type = 'AAB'
if ($Mode -eq 'Apk') { $type = 'APK' }
Say "Сборка подписанного $type"
if ($type -eq 'AAB') {
  & npx cap build android --androidreleasetype AAB --keystorepath $Keystore --keystorepass $ksPass --keystorealias $KeyAlias --keystorealiaspass $ksPass
} else {
  # APK подписывается apksigner (схема подписи v2+); он лежит в Android SDK\build-tools\<версия>
  $bt = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } -Descending | Select-Object -First 1
  if (-not $bt) { Fail 'Не найдены Android SDK Build-Tools (нужны для подписи APK). Установите их в SDK Manager.' }
  $env:Path = $bt.FullName + ';' + $env:Path
  & npx cap build android --androidreleasetype APK --signing-type apksigner --keystorepath $Keystore --keystorepass $ksPass --keystorealias $KeyAlias --keystorealiaspass $ksPass
}
$code = $LASTEXITCODE
$ksPass = $null
if ($code -ne 0) { Fail "Сборка завершилась с кодом $code. Если ошибка про пароль — проверьте пароль ключа подписи." }

if ($type -eq 'AAB') { $built = Get-ChildItem 'android\app\build\outputs\bundle\release\*-release-signed.aab' -ErrorAction SilentlyContinue | Select-Object -First 1 }
else { $built = Get-ChildItem 'android\app\build\outputs\apk\release\*-release-signed.apk' -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $built) { Fail 'Не найден собранный файл в android\app\build\outputs.' }
$dest = Join-Path $outDir ("AE-$($pkg.version)-$VersionCode." + $type.ToLower())
Copy-Item $built.FullName $dest -Force
WriteText 'android\.ae-last-release-code' "$VersionCode"

Say "Готово: $dest"
if ($type -eq 'AAB') { Write-Host 'Загрузите этот файл в Play Console → Тестирование → Закрытое тестирование. Следующую сборку номер versionCode получит на 1 больше.' }
