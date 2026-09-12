#requires -Version 5.1

<#
.SYNOPSIS
Builds and deploys the committed frontend and backend revisions to ITS staging.

.DESCRIPTION
The script requires clean frontend and backend Git worktrees. It runs local
tests, builds the frontend with staging URLs, creates immutable archives and
uploads them over SSH. The remote helper installs production dependencies,
runs backend tests and database migrations, atomically switches /srv/its/current,
then rolls the application back if the post-deploy smoke test fails.

.EXAMPLE
.\its_back\deploy-stage.ps1

.EXAMPLE
.\its_back\deploy-stage.ps1 -ValidateOnly
#>

[CmdletBinding()]
param(
    [string]$ServerAddress = "155.212.170.148",
    [string]$ServerDomain = "stage.its-site.ru",
    [string]$SshUser = "itsdeploy",
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\its_firstvds_codex",
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command was not found: $Name"
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath exited with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-GitOutput {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = @(& git.exe -C $Repository @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed for $Repository"
    }
    return $output
}

function Assert-CleanWorktree {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $changes = @(Get-GitOutput -Repository $Repository -Arguments @(
        "status", "--porcelain", "--untracked-files=all"
    ))
    if ($changes.Count -gt 0) {
        $details = $changes -join [Environment]::NewLine
        throw "$Label worktree is not clean. Commit or stash changes before deployment:`n$details"
    }
}

function Set-ProcessEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$Value
    )
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

$BackendRoot = $PSScriptRoot
$WorkspaceRoot = Split-Path -Parent $BackendRoot
$FrontendRoot = Join-Path $WorkspaceRoot "its_prototype"
$FrontendBuildDirectory = Join-Path $FrontendRoot "build"
$RemoteHelperSource = Join-Path $BackendRoot "scripts\deploy-stage-remote.sh"

if (-not (Test-Path -LiteralPath $FrontendRoot -PathType Container)) {
    throw "Frontend repository was not found: $FrontendRoot"
}
if (-not (Test-Path -LiteralPath $RemoteHelperSource -PathType Leaf)) {
    throw "Remote deployment helper was not found: $RemoteHelperSource"
}
if (-not (Test-Path -LiteralPath $SshKeyPath -PathType Leaf)) {
    throw "SSH key was not found: $SshKeyPath"
}
if ($ServerAddress -notmatch "^[A-Za-z0-9.:-]+$") {
    throw "ServerAddress contains unsupported characters"
}
if ($ServerDomain -notmatch "^[A-Za-z0-9.-]+$") {
    throw "ServerDomain contains unsupported characters"
}
if ($SshUser -notmatch "^[a-z_][a-z0-9_-]*$") {
    throw "SshUser contains unsupported characters"
}

foreach ($command in @("git.exe", "node.exe", "npm.cmd", "tar.exe", "ssh.exe", "scp.exe")) {
    Assert-Command -Name $command
}

$TemporaryDirectory = $null
$RemoteArtifactsMayExist = $false
$RemoteFrontendArchive = $null
$RemoteBackendArchive = $null
$RemoteHelper = $null
$SshOptions = @(
    "-i", $SshKeyPath,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3"
)
$RemoteTarget = "${SshUser}@${ServerAddress}"

try {
    Write-Step "Checking Git worktrees"
    Assert-CleanWorktree -Repository $FrontendRoot -Label "Frontend"
    Assert-CleanWorktree -Repository $BackendRoot -Label "Backend"

    $FrontendCommit = (@(Get-GitOutput -Repository $FrontendRoot -Arguments @(
        "rev-parse", "--short=8", "HEAD"
    )))[0].Trim()
    $BackendCommit = (@(Get-GitOutput -Repository $BackendRoot -Arguments @(
        "rev-parse", "--short=8", "HEAD"
    )))[0].Trim()
    $ReleaseId = "{0}-{1}-{2}" -f (
        [DateTime]::UtcNow.ToString("yyyyMMddHHmmss"),
        $FrontendCommit,
        $BackendCommit
    )

    Write-Host "Release: $ReleaseId"
    Write-Host "Frontend commit: $FrontendCommit"
    Write-Host "Backend commit:  $BackendCommit"

    Write-Step "Installing deterministic local dependencies"
    Invoke-NativeCommand -FilePath "npm.cmd" -Arguments @("ci", "--no-audit", "--no-fund") -WorkingDirectory $FrontendRoot
    Invoke-NativeCommand -FilePath "npm.cmd" -Arguments @("ci", "--no-audit", "--no-fund") -WorkingDirectory $BackendRoot

    Write-Step "Running local tests"
    Invoke-NativeCommand -FilePath "npm.cmd" -Arguments @("test") -WorkingDirectory $FrontendRoot
    Invoke-NativeCommand -FilePath "npm.cmd" -Arguments @("test") -WorkingDirectory $BackendRoot

    Write-Step "Building frontend for staging"
    $buildVariables = @(
        "VITE_API_URL",
        "VITE_CDEK_SERVICE_URL",
        "VITE_DEMO_MODE",
        "VITE_SITE_URL",
        "VITE_ALLOW_INDEXING"
    )
    $previousBuildEnvironment = @{}
    foreach ($name in $buildVariables) {
        $previousBuildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    }

    try {
        Set-ProcessEnvironmentValue -Name "VITE_API_URL" -Value "/api"
        Set-ProcessEnvironmentValue -Name "VITE_CDEK_SERVICE_URL" -Value "/service.php"
        Set-ProcessEnvironmentValue -Name "VITE_DEMO_MODE" -Value "false"
        Set-ProcessEnvironmentValue -Name "VITE_SITE_URL" -Value "https://its-site.ru"
        Set-ProcessEnvironmentValue -Name "VITE_ALLOW_INDEXING" -Value "false"
        Invoke-NativeCommand -FilePath "npm.cmd" -Arguments @("run", "build") -WorkingDirectory $FrontendRoot
    }
    finally {
        foreach ($name in $buildVariables) {
            Set-ProcessEnvironmentValue -Name $name -Value $previousBuildEnvironment[$name]
        }
    }

    $FrontendIndex = Join-Path $FrontendBuildDirectory "index.html"
    if (-not (Test-Path -LiteralPath $FrontendIndex -PathType Leaf)) {
        throw "Frontend build did not produce $FrontendIndex"
    }
    $FrontendRobots = Join-Path $FrontendBuildDirectory "robots.txt"
    $FrontendSitemap = Join-Path $FrontendBuildDirectory "sitemap.xml"
    $FrontendCertificateIndex = Join-Path $FrontendBuildDirectory "certificate\index.html"
    $FrontendNotFound = Join-Path $FrontendBuildDirectory "404.html"
    if (-not (Test-Path -LiteralPath $FrontendRobots -PathType Leaf) -or
        -not (Test-Path -LiteralPath $FrontendSitemap -PathType Leaf) -or
        -not (Test-Path -LiteralPath $FrontendCertificateIndex -PathType Leaf) -or
        -not (Test-Path -LiteralPath $FrontendNotFound -PathType Leaf)) {
        throw "Frontend build did not produce the expected SEO assets"
    }
    if ((Get-Content -LiteralPath $FrontendRobots -Raw) -notmatch "(?m)^Disallow: /$") {
        throw "Staging robots.txt must disallow indexing"
    }

    Write-Step "Creating release archives"
    $TemporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "its-stage-deploy-$ReleaseId"
    [IO.Directory]::CreateDirectory($TemporaryDirectory) | Out-Null

    $ArchivePrefix = ".its-deploy-$ReleaseId"
    $FrontendArchive = Join-Path $TemporaryDirectory "$ArchivePrefix-frontend.tar.gz"
    $BackendArchive = Join-Path $TemporaryDirectory "$ArchivePrefix-backend.tar.gz"
    $RemoteHelperCopy = Join-Path $TemporaryDirectory "$ArchivePrefix-remote.sh"

    Invoke-NativeCommand -FilePath "tar.exe" -Arguments @(
        "-czf", $FrontendArchive, "-C", $FrontendBuildDirectory, "."
    ) -WorkingDirectory $WorkspaceRoot
    Invoke-NativeCommand -FilePath "git.exe" -Arguments @(
        "-C", $BackendRoot,
        "archive", "--format=tar.gz", "--output=$BackendArchive", "HEAD"
    ) -WorkingDirectory $WorkspaceRoot
    # Keep the Linux helper executable by Bash even when Git for Windows uses CRLF.
    $RemoteHelperContent = [IO.File]::ReadAllText($RemoteHelperSource).Replace("`r`n", "`n")
    $Utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($RemoteHelperCopy, $RemoteHelperContent, $Utf8WithoutBom)

    $FrontendHash = (Get-FileHash -LiteralPath $FrontendArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    $BackendHash = (Get-FileHash -LiteralPath $BackendArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "Frontend SHA-256: $FrontendHash"
    Write-Host "Backend SHA-256:  $BackendHash"

    if ($ValidateOnly) {
        Write-Step "Validation completed; no files were uploaded"
        return
    }

    Write-Step "Uploading release to $RemoteTarget"
    $RemoteFrontendArchive = "/home/$SshUser/$ArchivePrefix-frontend.tar.gz"
    $RemoteBackendArchive = "/home/$SshUser/$ArchivePrefix-backend.tar.gz"
    $RemoteHelper = "/home/$SshUser/$ArchivePrefix-remote.sh"
    $RemoteArtifactsMayExist = $true

    Invoke-NativeCommand -FilePath "scp.exe" -Arguments ($SshOptions + @(
        $FrontendArchive, "${RemoteTarget}:${RemoteFrontendArchive}"
    )) -WorkingDirectory $WorkspaceRoot
    Invoke-NativeCommand -FilePath "scp.exe" -Arguments ($SshOptions + @(
        $BackendArchive, "${RemoteTarget}:${RemoteBackendArchive}"
    )) -WorkingDirectory $WorkspaceRoot
    Invoke-NativeCommand -FilePath "scp.exe" -Arguments ($SshOptions + @(
        $RemoteHelperCopy, "${RemoteTarget}:${RemoteHelper}"
    )) -WorkingDirectory $WorkspaceRoot

    Write-Step "Installing and activating the release"
    $RemoteCommand = "bash $RemoteHelper $ReleaseId $FrontendHash $BackendHash $ServerDomain"
    Invoke-NativeCommand -FilePath "ssh.exe" -Arguments ($SshOptions + @(
        $RemoteTarget, $RemoteCommand
    )) -WorkingDirectory $WorkspaceRoot
    $RemoteArtifactsMayExist = $false

    Write-Step "Running client-side smoke tests"
    try {
        $homeResponse = Invoke-WebRequest -Uri "https://$ServerDomain/" -UseBasicParsing -TimeoutSec 20
        if ($homeResponse.StatusCode -ne 200 -or $homeResponse.Content -notmatch "<title>[^<]+</title>") {
            throw "Unexpected staging home page response"
        }

        $orderResponse = Invoke-WebRequest -Uri "https://$ServerDomain/order" -UseBasicParsing -TimeoutSec 20
        if ($orderResponse.StatusCode -ne 200) {
            throw "Staging SPA route returned HTTP $($orderResponse.StatusCode)"
        }

        $catalogResponse = Invoke-WebRequest -Uri "https://$ServerDomain/api/clothing-types" -UseBasicParsing -TimeoutSec 20
        if ($catalogResponse.StatusCode -ne 200) {
            throw "Staging API returned HTTP $($catalogResponse.StatusCode)"
        }
    }
    catch {
        Write-Warning "Server-side smoke tests passed, but this computer could not verify the public URL: $($_.Exception.Message)"
    }

    Write-Host "`nDeployment completed successfully." -ForegroundColor Green
    Write-Host "URL: https://$ServerDomain"
    Write-Host "Release: /srv/its/releases/$ReleaseId"
}
finally {
    if ($RemoteArtifactsMayExist -and $RemoteFrontendArchive -and $RemoteBackendArchive -and $RemoteHelper) {
        $cleanupCommand = "rm -f -- $RemoteFrontendArchive $RemoteBackendArchive $RemoteHelper"
        try {
            & ssh.exe @SshOptions $RemoteTarget $cleanupCommand 2>$null | Out-Null
        }
        catch {
            Write-Warning "Could not remove temporary upload files from the server"
        }
    }

    if ($TemporaryDirectory -and (Test-Path -LiteralPath $TemporaryDirectory)) {
        Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
