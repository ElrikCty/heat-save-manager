param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$PreviousTag = '',
    [string]$Repo = 'ElrikCty/heat-save-manager',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-PreviousTag([string]$newTag) {
    $tags = git tag --list "v*" --sort=v:refname
    if (-not $tags) {
        return ''
    }

    $index = [Array]::IndexOf($tags, $newTag)
    if ($index -le 0) {
        return ''
    }

    return $tags[$index - 1]
}

function Try-GetPRMetadata([int]$number, [string]$repo) {
    try {
        $raw = gh pr view $number --repo $repo --json title,author,url
        if (-not $raw) {
            return $null
        }

        return $raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Add-Contributor([System.Collections.Generic.HashSet[string]]$set, [string]$contributor) {
    if (-not $set) {
        return
    }

    $normalized = ([string]$contributor).Trim()
    if (-not $normalized -or $normalized -eq 'unknown') {
        return
    }

    [void]$set.Add($normalized)
}

function Try-GetCompareContributorLogins([string]$repo, [string]$baseTag, [string]$headTag) {
    if (-not $baseTag) {
        return @()
    }

    try {
        $rawLogins = gh api "repos/$repo/compare/$baseTag...$headTag" --jq ".commits[].author.login"
        if (-not $rawLogins) {
            return @()
        }

        $normalizedLogins = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $rawLogins) {
            $login = ([string]$entry).Trim()
            if ($login) {
                [void]$normalizedLogins.Add("@$login")
            }
        }

        return @($normalizedLogins)
    } catch {
        return @()
    }
}

function Try-GetCompareCommitAuthorMap([string]$repo, [string]$baseTag, [string]$headTag) {
    if (-not $baseTag) {
        return @{}
    }

    try {
        $rows = gh api "repos/$repo/compare/$baseTag...$headTag" --jq ".commits[] | [.sha, .author.login] | @tsv"
        $authorByCommit = @{}

        foreach ($row in $rows) {
            if (-not $row) {
                continue
            }

            $parts = ([string]$row).Split("`t", 2)
            if ($parts.Length -lt 2) {
                continue
            }

            $sha = ([string]$parts[0]).Trim()
            $login = ([string]$parts[1]).Trim()
            if (-not $sha -or -not $login -or $login -eq 'null') {
                continue
            }

            $authorByCommit[$sha] = "@$login"
        }

        return $authorByCommit
    } catch {
        return @{}
    }
}

if (-not (git rev-parse --verify $Tag 2>$null)) {
    throw "Tag not found: $Tag"
}

if (-not $PreviousTag) {
    $PreviousTag = Resolve-PreviousTag $Tag
}

$range = if ($PreviousTag) { "$PreviousTag..$Tag" } else { $Tag }
$logLines = git log --pretty=format:"%H`t%h`t%s`t%an" $range

$prItems = New-Object System.Collections.Generic.List[object]
$directCommitItems = New-Object System.Collections.Generic.List[object]
$prTitleSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$contributors = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

$compareContributorLogins = Try-GetCompareContributorLogins $Repo $PreviousTag $Tag
$hasCompareContributorLogins = $compareContributorLogins.Count -gt 0
foreach ($contributor in $compareContributorLogins) {
    Add-Contributor $contributors $contributor
}

$compareCommitAuthorMap = Try-GetCompareCommitAuthorMap $Repo $PreviousTag $Tag
$hasCompareCommitAuthorMap = $compareCommitAuthorMap.Keys.Count -gt 0

foreach ($line in $logLines) {
    if (-not $line) {
        continue
    }

    $parts = $line -split "`t", 4
    if ($parts.Length -lt 3) {
        continue
    }

    $fullHash = $parts[0].Trim()
    $hash = $parts[1].Trim()
    $subject = $parts[2].Trim()
    $commitAuthor = if ($parts.Length -ge 4) { $parts[3].Trim() } else { '' }

    $match = [Regex]::Match($subject, '^Merge pull request #(\d+)')
    if ($match.Success) {
        $number = [int]$match.Groups[1].Value
        $meta = Try-GetPRMetadata $number $Repo
        if ($meta) {
            $authorLogin = ([string]$meta.author.login).Trim()
            $prItems.Add([PSCustomObject]@{
                Number = $number
                Title = $meta.title
                Author = $authorLogin
                URL = $meta.url
            })

            if ($authorLogin) {
                Add-Contributor $contributors "@$authorLogin"
            }

            if ($meta.title) {
                [void]$prTitleSet.Add($meta.title.Trim())
            }
        } else {
            $fallbackAuthorLogin = ''
            if ($hasCompareCommitAuthorMap -and $compareCommitAuthorMap.ContainsKey($fullHash)) {
                $fallbackAuthorLogin = ([string]$compareCommitAuthorMap[$fullHash]).Trim().TrimStart('@')
            }

            if (-not $fallbackAuthorLogin) {
                $fallbackAuthorLogin = 'unknown'
            }

            $prItems.Add([PSCustomObject]@{
                Number = $number
                Title = "Pull request #$number"
                Author = $fallbackAuthorLogin
                URL = "https://github.com/$Repo/pull/$number"
            })

            if (-not $hasCompareContributorLogins) {
                Add-Contributor $contributors $commitAuthor
            }
        }

        continue
    }

    if ($subject -notlike 'Merge branch*' -and -not $prTitleSet.Contains($subject)) {
        $resolvedDirectAuthor = ''
        if ($hasCompareCommitAuthorMap -and $compareCommitAuthorMap.ContainsKey($fullHash)) {
            $resolvedDirectAuthor = ([string]$compareCommitAuthorMap[$fullHash]).Trim()
        }

        if (-not $resolvedDirectAuthor) {
            $resolvedDirectAuthor = $commitAuthor
        }

        if ($hasCompareContributorLogins) {
            Add-Contributor $contributors $resolvedDirectAuthor
        } else {
            Add-Contributor $contributors $commitAuthor
        }

        $directCommitItems.Add([PSCustomObject]@{
            Hash = $hash
            Subject = $subject
            Author = $resolvedDirectAuthor
        })
    }
}

$version = $Tag.TrimStart('v')
$compareLine = if ($PreviousTag) {
    "Full Changelog: https://github.com/$Repo/compare/$PreviousTag...$Tag"
} else {
    "Full Changelog: https://github.com/$Repo/releases/tag/$Tag"
}

$summaryLine = if ($PreviousTag) {
    "- Includes $($prItems.Count) merged PR(s) and $($directCommitItems.Count) direct commit(s) since $PreviousTag."
} else {
    "- Includes $($prItems.Count) merged PR(s) and $($directCommitItems.Count) direct commit(s)."
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('## Highlights')
$lines.Add($summaryLine)
$lines.Add('- <add one or two user-facing highlights here>')
$lines.Add('')
$lines.Add('## What''s changed')

if ($prItems.Count -eq 0 -and $directCommitItems.Count -eq 0) {
    $lines.Add('- No code changes detected in this tag range.')
}

foreach ($pr in $prItems) {
    if ($pr.Author -and $pr.Author -ne 'unknown') {
        $lines.Add("- $($pr.Title) (#$($pr.Number)) by @$($pr.Author) in $($pr.URL)")
    } else {
        $lines.Add("- $($pr.Title) (#$($pr.Number)) in $($pr.URL)")
    }
}

foreach ($commit in $directCommitItems) {
    if ($commit.Author) {
        $lines.Add("- $($commit.Subject) ($($commit.Hash)) by $($commit.Author)")
    } else {
        $lines.Add("- $($commit.Subject) ($($commit.Hash))")
    }
}

$lines.Add('')
$lines.Add('## Contributors')

if ($contributors.Count -eq 0) {
    $lines.Add('- No contributor metadata detected.')
} else {
    foreach ($contributor in (@($contributors) | Sort-Object)) {
        $lines.Add("- $contributor")
    }
}

$lines.Add('')
$lines.Add($compareLine)
$lines.Add('')
$lines.Add('## Verification')
$lines.Add('- Windows executable: `HeatSaveManager-vX.Y.Z-windows-x64.exe`'.Replace('vX.Y.Z', $Tag))
$lines.Add('- Windows installer: `HeatSaveManager-vX.Y.Z-windows-x64-installer.exe`'.Replace('vX.Y.Z', $Tag))
$lines.Add('- Windows zip: `HeatSaveManager-vX.Y.Z-windows-x64.zip`'.Replace('vX.Y.Z', $Tag))
$lines.Add('- Checksums:')
$lines.Add('  - `HeatSaveManager-vX.Y.Z-windows-x64.exe.sha256`'.Replace('vX.Y.Z', $Tag))
$lines.Add('  - `HeatSaveManager-vX.Y.Z-windows-x64-installer.exe.sha256`'.Replace('vX.Y.Z', $Tag))
$lines.Add('  - `HeatSaveManager-vX.Y.Z-windows-x64.zip.sha256`'.Replace('vX.Y.Z', $Tag))

$output = [string]::Join([Environment]::NewLine, $lines)

if (-not $OutputPath) {
    $OutputPath = "dist/release-notes/$Tag.md"
}

$outputAbsolutePath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path (Get-Location) $OutputPath
}

$outputDir = Split-Path -Parent $outputAbsolutePath
if ($outputDir) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

[System.IO.File]::WriteAllText($outputAbsolutePath, $output + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
Write-Host "Release notes generated: $OutputPath"
Write-Host ""
Write-Host $output
