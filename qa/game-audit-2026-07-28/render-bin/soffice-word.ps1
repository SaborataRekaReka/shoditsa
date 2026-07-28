param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$SofficeArgs
)

$outDir = $null
$inputPath = $null

for ($i = 0; $i -lt $SofficeArgs.Count; $i++) {
    if ($SofficeArgs[$i] -eq "--outdir" -and ($i + 1) -lt $SofficeArgs.Count) {
        $outDir = $SofficeArgs[$i + 1]
        $i++
        continue
    }
    if ($SofficeArgs[$i] -match "\.(docx?|odt)$") {
        $inputPath = $SofficeArgs[$i]
    }
}

if (-not $outDir -or -not $inputPath) {
    Write-Error "Word rendering shim requires --outdir and a DOCX input."
    exit 2
}

$resolvedInput = (Resolve-Path -LiteralPath $inputPath).Path
$resolvedOutDir = [System.IO.Path]::GetFullPath($outDir)
[System.IO.Directory]::CreateDirectory($resolvedOutDir) | Out-Null
$outputPath = Join-Path $resolvedOutDir (([System.IO.Path]::GetFileNameWithoutExtension($resolvedInput)) + ".pdf")

$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open($resolvedInput, $false, $true)
    $document.ExportAsFixedFormat($outputPath, 17)
    Write-Output "Converted $resolvedInput -> $outputPath"
}
finally {
    if ($document) {
        $document.Close($false)
    }
    if ($word) {
        $word.Quit()
    }
    if ($document) {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) | Out-Null
    }
    if ($word) {
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
