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

if (-not (git rev-parse --verify $Tag 2>$null)) {
    throw "Tag not found: $Tag"
}

if (-not $PreviousTag) {
    $PreviousTag = Resolve-PreviousTag $Tag
}

$range = if ($PreviousTag) { "$PreviousTag..$Tag" } else { $Tag }
$logLines = git log --pretty=format:"%h`t%s" $range

$prItems = New-Object System.Collections.Generic.List[object]
$directCommitItems = New-Object System.Collections.Generic.List[object]
$prTitleSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

foreach ($line in $logLines) {
    if (-not $line) {
        continue
    }

    $parts = $line -split "`t", 2
    if ($parts.Length -ne 2) {
        continue
    }

    $hash = $parts[0].Trim()
    $subject = $parts[1].Trim()

    $match = [Regex]::Match($subject, '^Merge pull request #(\d+)')
    if ($match.Success) {
        $number = [int]$match.Groups[1].Value
        $meta = Try-GetPRMetadata $number $Repo
        if ($meta) {
            $prItems.Add([PSCustomObject]@{
                Number = $number
                Title = $meta.title
                Author = $meta.author.login
                URL = $meta.url
            })
            if ($meta.title) {
                [void]$prTitleSet.Add($meta.title.Trim())
            }
        } else {
            $prItems.Add([PSCustomObject]@{
                Number = $number
                Title = "Pull request #$number"
                Author = "unknown"
                URL = "https://github.com/$Repo/pull/$number"
            })
        }

        continue
    }

    if ($subject -notlike 'Merge branch*' -and -not $prTitleSet.Contains($subject)) {
        $directCommitItems.Add([PSCustomObject]@{
            Hash = $hash
            Subject = $subject
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
    $lines.Add("- $($pr.Title) (#$($pr.Number)) by @$($pr.Author) in $($pr.URL)")
}

foreach ($commit in $directCommitItems) {
    $lines.Add("- $($commit.Subject) ($($commit.Hash))")
}

$lines.Add('')
$lines.Add($compareLine)
$lines.Add('')
$lines.Add('## Verification')
$lines.Add('- Windows executable: `HeatSaveManager-vX.Y.Z-windows-x64.exe`'.Replace('vX.Y.Z', $Tag))
$lines.Add('- Windows zip: `HeatSaveManager-vX.Y.Z-windows-x64.zip`'.Replace('vX.Y.Z', $Tag))
$lines.Add('- Checksums:')
$lines.Add('  - `HeatSaveManager-vX.Y.Z-windows-x64.exe.sha256`'.Replace('vX.Y.Z', $Tag))
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
