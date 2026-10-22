param([string]$Folder = '', [switch]$Yes)
$ErrorActionPreference = 'Stop'
$planJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RENAME_PLAN_BASE64__'))
$plan = $planJson | ConvertFrom-Json

function Assert-Leaf([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name.Length -gt 255 -or $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $Name -match '[. ]$' -or $Name -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
        throw "Nama file tidak valid: $Name"
    }
}
function Get-Mark([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Bukan file biasa: $Path" }
    return [pscustomobject]@{ Size = $item.Length; Ticks = $item.LastWriteTimeUtc.Ticks; Creation = $item.CreationTimeUtc.Ticks }
}
function Test-Mark([string]$Path, $Mark) {
    try { $current = Get-Mark $Path; return $current.Size -eq $Mark.Size -and $current.Ticks -eq $Mark.Ticks -and $current.Creation -eq $Mark.Creation }
    catch { return $false }
}
function Save-Journal($Record) {
    $temporary = $script:journalPath + '.tmp'
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Record | ConvertTo-Json -Depth 8))
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if ([IO.File]::Exists($script:journalPath)) { [IO.File]::Replace($temporary, $script:journalPath, [System.Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temporary, $script:journalPath) }
}
function Restore-Pending($Record) {
    foreach ($entry in $Record.Entries) {
        $source = Join-Path $Folder $entry.Source
        $temporary = Join-Path $Folder $entry.Temp
        if (Test-Mark $temporary $entry.Mark) { continue }
        $candidates = @(@($entry.Source, $entry.Target) | Select-Object -Unique | Where-Object { Test-Mark (Join-Path $Folder $_) $entry.Mark })
        if ($candidates.Count -ne 1) { throw 'Pemulihan tidak dapat memastikan identitas file. Jurnal dipertahankan; periksa manual.' }
        if ($candidates[0] -ceq $entry.Source) { continue }
        [IO.File]::Move((Join-Path $Folder $candidates[0]), $temporary)
    }
    foreach ($entry in $Record.Entries) {
        $temporary = Join-Path $Folder $entry.Temp
        if ([IO.File]::Exists($temporary)) { [IO.File]::Move($temporary, (Join-Path $Folder $entry.Source)) }
    }
}
function Run-Transaction($Entries, [bool]$Undo) {
    $sourceNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $targetNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Entries) {
        Assert-Leaf $entry.Source
        Assert-Leaf $entry.Target
        if (-not $sourceNames.Add($entry.Source) -or -not $targetNames.Add($entry.Target)) { throw 'Nama file duplikat dalam batch.' }
        if (-not (Test-Mark (Join-Path $Folder $entry.Source) $entry.Mark)) { throw "File berubah atau hilang: $($entry.Source)" }
    }
    foreach ($entry in $Entries) {
        $target = Join-Path $Folder $entry.Target
        if ((Test-Path -LiteralPath $target) -and -not $sourceNames.Contains($entry.Target)) { throw "Nama tujuan sudah dipakai: $($entry.Target)" }
    }
    $record = [pscustomobject]@{ Version = 1; Id = $plan.id; Status = 'pending'; Undo = $Undo; Entries = @($Entries) }
    Save-Journal $record
    try {
        foreach ($entry in $Entries) {
            if (-not (Test-Mark (Join-Path $Folder $entry.Source) $entry.Mark)) { throw "File berubah: $($entry.Source)" }
            [IO.File]::Move((Join-Path $Folder $entry.Source), (Join-Path $Folder $entry.Temp))
        }
        foreach ($entry in $Entries) { [IO.File]::Move((Join-Path $Folder $entry.Temp), (Join-Path $Folder $entry.Target)) }
    } catch {
        $failure = $_
        try { Restore-Pending $record; $record.Status = 'rolled-back'; Save-Journal $record }
        catch { throw "Proses terhenti, pemulihan belum lengkap. Jurnal: $script:journalPath. $($_.Exception.Message)" }
        throw "Proses dibatalkan, nama awal dipulihkan. $($failure.Exception.Message)"
    }
    $record.Status = $(if ($Undo) { 'undone' } else { 'complete' })
    Save-Journal $record
    Write-Host "Selesai: $($Entries.Count) nama file diubah. Isi file tidak disalin." -ForegroundColor Green
    if (-not $Undo) { Write-Host 'Untuk undo, jalankan skrip ini lagi dan pilih folder yang sama. Simpan jurnal di folder aset.' }
}

try {
    if ($plan.id -notmatch '^[a-zA-Z0-9-]{1,64}$' -or $plan.mode -notin @('rename', 'undo')) { throw 'Data batch tidak valid.' }
    if (-not $Folder) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = "Rename Studio: pilih folder $($plan.folderName)"
        $dialog.ShowNewFolderButton = $false
        try { if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { Write-Host 'Dibatalkan.'; exit 0 }; $Folder = $dialog.SelectedPath }
        finally { $dialog.Dispose() }
    }
    $folderInfo = Get-Item -LiteralPath $Folder -Force
    if (-not $folderInfo.PSIsContainer -or ($folderInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Lokasi harus folder biasa, bukan symlink.' }
    $Folder = $folderInfo.FullName
    $script:journalPath = Join-Path $Folder ('.rename-studio-' + $plan.id + '.json')
    Write-Host "`nRENAME STUDIO`nFolder: $Folder`n"
    $previous = $null
    if ([IO.File]::Exists($script:journalPath)) {
        $previous = Get-Content -LiteralPath $script:journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($previous.Id -ne $plan.id -or $previous.Version -ne 1) { throw 'Jurnal tidak cocok dengan batch ini.' }
        foreach ($entry in $previous.Entries) { Assert-Leaf $entry.Source; Assert-Leaf $entry.Target; if ($entry.Temp -notmatch '^\.rename-studio-[a-f0-9]{32}$') { throw 'Nama sementara dalam jurnal tidak valid.' } }
        if ($previous.Status -eq 'pending') {
            if (-not $Yes -and (Read-Host 'Ada proses terputus. Ketik PULIHKAN untuk mengembalikan nama awal') -cne 'PULIHKAN') { throw 'Pemulihan dibatalkan.' }
            Restore-Pending $previous
            $previous.Status = 'rolled-back'; Save-Journal $previous
            Write-Host 'Nama sebelum transaksi dipulihkan. Jalankan skrip kembali jika perlu.'
            exit 0
        }
    }
    $undo = $plan.mode -eq 'undo' -or ($previous -and $previous.Status -eq 'complete')
    if ($undo) {
        if (-not $previous -or $previous.Status -ne 'complete') { throw 'Tidak ada batch selesai yang dapat di-undo di folder ini.' }
        $entries = @($previous.Entries | ForEach-Object { [pscustomobject]@{ Source = $_.Target; Target = $_.Source; Mark = $_.Mark; Temp = '.rename-studio-' + [Guid]::NewGuid().ToString('N') } })
    } else {
        if ($previous -and $previous.Status -eq 'undone') { throw 'Batch ini sudah di-undo. Buat skrip baru dari web untuk rename berikutnya.' }
        $entries = @($plan.entries | Where-Object { $_.source -cne $_.target } | ForEach-Object {
            Assert-Leaf $_.source; Assert-Leaf $_.target
            $path = Join-Path $Folder $_.source
            $mark = Get-Mark $path
            $modified = [long][Math]::Floor(((Get-Item -LiteralPath $path -Force).LastWriteTimeUtc - [DateTime]::SpecifyKind([DateTime]'1970-01-01', [DateTimeKind]::Utc)).TotalMilliseconds)
            if ($mark.Size -ne $_.size -or $modified -ne $_.modified) { throw "File berubah sejak dipilih di web: $($_.source). Pilih folder kembali di web." }
            [pscustomobject]@{ Source = $_.source; Target = $_.target; Mark = $mark; Temp = '.rename-studio-' + [Guid]::NewGuid().ToString('N') }
        })
    }
    if (-not $entries.Count) { Write-Host 'Tidak ada nama yang perlu diubah.'; exit 0 }
    foreach ($entry in $entries) { Write-Host ($entry.Source + '  -->  ' + $entry.Target) }
    $word = $(if ($undo) { 'UNDO' } else { 'RENAME' })
    Write-Host "`n$($entries.Count) file. Tutup aplikasi lain yang sedang mengedit file tersebut."
    if (-not $Yes -and (Read-Host "Ketik $word untuk melanjutkan") -cne $word) { Write-Host 'Dibatalkan.'; exit 0 }
    Run-Transaction $entries $undo
    exit 0
} catch { Write-Host ("GAGAL: " + $_.Exception.Message) -ForegroundColor Red; exit 1 }
