param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$PackageIdentifier = 'ElrikCty.HeatSaveManager',
    [string]$Publisher = 'Eduardo Baltra',
    [string]$PackageName = 'Heat Save Manager',
    [string]$License = 'MIT',
    [string]$ShortDescription = 'Desktop app to manage Need for Speed Heat save profiles on Windows.',
    [string]$Repo = 'ElrikCty/heat-save-manager'
)

$ErrorActionPreference = 'Stop'

if (-not $Tag.StartsWith('v')) {
    throw "Tag must start with 'v' (example: v1.0.2)"
}

$version = $Tag.TrimStart('v')
$releaseApi = "https://api.github.com/repos/$Repo/releases/tags/$Tag"
$release = Invoke-RestMethod -Uri $releaseApi -Headers @{ 'User-Agent' = 'heat-save-manager-winget-manifest' }

$installerName = "HeatSaveManager-$Tag-windows-x64-installer.exe"
$checksumName = "$installerName.sha256"

$installerAsset = $release.assets | Where-Object { $_.name -eq $installerName } | Select-Object -First 1
if (-not $installerAsset) {
    throw "Release asset not found: $installerName. This helper expects releases that include installer assets."
}

$checksumAsset = $release.assets | Where-Object { $_.name -eq $checksumName } | Select-Object -First 1
if (-not $checksumAsset) {
    throw "Release checksum asset not found: $checksumName"
}

$checksumLine = Invoke-RestMethod -Uri $checksumAsset.browser_download_url -Headers @{ 'User-Agent' = 'heat-save-manager-winget-manifest' }
$installerSha256 = ($checksumLine -split '\s+')[0].Trim().ToUpperInvariant()
if ($installerSha256.Length -ne 64) {
    throw "Invalid SHA256 value from checksum file: $installerSha256"
}

$segments = $PackageIdentifier.Split('.')
if ($segments.Length -lt 2) {
    throw "PackageIdentifier must include vendor and package (example: ElrikCty.HeatSaveManager)"
}

$packageLeaf = $segments[-1]
$vendorPath = ($segments[0..($segments.Length - 2)] -join '/')
$prefix = $segments[0].Substring(0, 1).ToLowerInvariant()
$manifestDir = Join-Path (Get-Location) "dist/winget/manifests/$prefix/$vendorPath/$packageLeaf/$version"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null

$baseFileName = "$PackageIdentifier"

$versionManifest = @"
# Created with scripts/generate-winget-manifests.ps1
PackageIdentifier: $PackageIdentifier
PackageVersion: $version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
"@

$installerManifest = @"
# Created with scripts/generate-winget-manifests.ps1
PackageIdentifier: $PackageIdentifier
PackageVersion: $version
InstallerType: nullsoft
Scope: machine
Installers:
  - Architecture: x64
    InstallerUrl: $($installerAsset.browser_download_url)
    InstallerSha256: $installerSha256
    InstallerLocale: en-US
    AppsAndFeaturesEntries:
      - DisplayName: $PackageName
        Publisher: $Publisher
        DisplayVersion: $version
ManifestType: installer
ManifestVersion: 1.6.0
"@

$localeManifest = @"
# Created with scripts/generate-winget-manifests.ps1
PackageIdentifier: $PackageIdentifier
PackageVersion: $version
PackageLocale: en-US
Publisher: $Publisher
PackageName: $PackageName
License: $License
ShortDescription: $ShortDescription
ReleaseNotesUrl: $($release.html_url)
ManifestType: defaultLocale
ManifestVersion: 1.6.0
"@

$versionPath = Join-Path $manifestDir "$baseFileName.yaml"
$installerPath = Join-Path $manifestDir "$baseFileName.installer.yaml"
$localePath = Join-Path $manifestDir "$baseFileName.locale.en-US.yaml"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($versionPath, $versionManifest, $utf8NoBom)
[System.IO.File]::WriteAllText($installerPath, $installerManifest, $utf8NoBom)
[System.IO.File]::WriteAllText($localePath, $localeManifest, $utf8NoBom)

Write-Host "Winget manifests generated:"
Write-Host "- $versionPath"
Write-Host "- $installerPath"
Write-Host "- $localePath"
