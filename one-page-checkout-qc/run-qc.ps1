param(
    [Parameter(Position = 0)]
    [string]$InputTarget = "",
    [string]$Config = "",
    [string]$Url = "",
    [ValidateSet("desktop", "mobile", "both", "d", "m", "b")]
    [string]$Device = "",
    [Alias("h")]
    [switch]$Headed,
    [switch]$Headless,
    [switch]$AllowCartMutations
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configDir = Join-Path $projectRoot "configs"

function Resolve-ConfigPath {
    param([string]$InputPath)

    if ([string]::IsNullOrWhiteSpace($InputPath)) {
        return $null
    }

    if (Test-Path $InputPath) {
        return (Resolve-Path $InputPath).Path
    }

    $configCandidate = Join-Path $configDir $InputPath
    if (Test-Path $configCandidate) {
        return (Resolve-Path $configCandidate).Path
    }

    $rootCandidate = Join-Path $projectRoot $InputPath
    if (Test-Path $rootCandidate) {
        return (Resolve-Path $rootCandidate).Path
    }

    return $null
}

function Test-IsUrl {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    return $Value -match '^(https?://)'
}

function Normalize-Device {
    param([string]$Value)

    $normalized = $Value.Trim().ToLowerInvariant()
    switch ($normalized) {
        "d" { return "desktop" }
        "desktop" { return "desktop" }
        "m" { return "mobile" }
        "mobile" { return "mobile" }
        "b" { return "both" }
        "both" { return "both" }
        default { throw "Invalid device mode: $Value" }
    }
}

function Normalize-BrowserMode {
    param([string]$Value)

    $normalized = $Value.Trim().ToLowerInvariant()
    switch ($normalized) {
        "h" { return "headed" }
        "headed" { return "headed" }
        "head" { return "headed" }
        "hl" { return "headless" }
        "headless" { return "headless" }
        default { throw "Invalid browser mode: $Value" }
    }
}

if ([string]::IsNullOrWhiteSpace($Config) -and [string]::IsNullOrWhiteSpace($Url) -and -not [string]::IsNullOrWhiteSpace($InputTarget)) {
    if (Test-IsUrl $InputTarget) {
        $Url = $InputTarget
    }
    else {
        $Config = $InputTarget
    }
}

if ([string]::IsNullOrWhiteSpace($Config) -and [string]::IsNullOrWhiteSpace($Url)) {
    $availableConfigs = Get-ChildItem $configDir -Filter *.json | Sort-Object Name
    $defaultConfigName = "dynamic-local.config.json"

    Write-Host ""
    Write-Host "Available config files:"
    foreach ($file in $availableConfigs) {
        Write-Host " - $($file.Name)"
    }
    Write-Host ""

    $enteredTarget = Read-Host "Enter config file path/name or site URL [$defaultConfigName]"
    if ([string]::IsNullOrWhiteSpace($enteredTarget)) {
        $enteredTarget = $defaultConfigName
    }

    if (Test-IsUrl $enteredTarget) {
        $Url = $enteredTarget
    }
    else {
        $Config = $enteredTarget
    }
}

if ($Headed -and $Headless) {
    throw "Choose either -Headed or -Headless, not both."
}

if ([string]::IsNullOrWhiteSpace($Device)) {
    $enteredDevice = Read-Host "Test device [desktop/d, mobile/m, both/b] [both]"
    if ([string]::IsNullOrWhiteSpace($enteredDevice)) {
        $enteredDevice = "both"
    }

    $Device = Normalize-Device $enteredDevice
}
else {
    $Device = Normalize-Device $Device
}

$browserMode = if ($Headless) { "headless" } else { "headed" }

if (-not $Headed -and -not $Headless) {
    $enteredBrowserMode = Read-Host "Browser mode [headed/h, headless/hl] [headed]"
    if (-not [string]::IsNullOrWhiteSpace($enteredBrowserMode)) {
        $browserMode = Normalize-BrowserMode $enteredBrowserMode
    }
}

if (-not [string]::IsNullOrWhiteSpace($Config)) {
    $resolvedConfig = Resolve-ConfigPath $Config
    if (-not $resolvedConfig) {
        throw "Config file not found: $Config"
    }

    $Config = $resolvedConfig
}

if (-not [string]::IsNullOrWhiteSpace($Url) -and -not (Test-IsUrl $Url)) {
    throw "Invalid URL: $Url"
}

if ([string]::IsNullOrWhiteSpace($Config) -and [string]::IsNullOrWhiteSpace($Url)) {
    throw "Provide either a config file or a site URL."
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
    Write-Host "Installing dependencies..."
    Push-Location $projectRoot
    try {
        npm install
    }
    finally {
        Pop-Location
    }
}

$deviceRuns = if ($Device -eq "both") { @("desktop", "mobile") } else { @($Device) }
$hadFailure = $false
$runNumber = 0

Push-Location $projectRoot
try {
    foreach ($deviceRun in $deviceRuns) {
        $runNumber += 1
        Write-Host ""
        Write-Host "Starting QC run $runNumber/$($deviceRuns.Count): device=$deviceRun, browser=$browserMode"

        $args = @("src/run-qc.js", "--device", $deviceRun)

        if (-not [string]::IsNullOrWhiteSpace($Config)) {
            $args += @("--config", $Config)
        }

        if (-not [string]::IsNullOrWhiteSpace($Url)) {
            $args += @("--url", $Url)
        }

        if ($browserMode -eq "headed") {
            $args += "--headed"
        }
        else {
            $args += "--headless"
        }

        if ($AllowCartMutations) {
            $args += "--allow-cart-mutations"
        }

        & node @args
        if ($LASTEXITCODE -ne 0) {
            $hadFailure = $true
        }
    }
}
finally {
    Pop-Location
}

if ($hadFailure) {
    exit 1
}

exit 0
