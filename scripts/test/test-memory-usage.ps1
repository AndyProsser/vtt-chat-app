<#
.SYNOPSIS
  Measures the memory and CPU an app really uses on Windows: the app's whole process tree (helpers and the
  WebView2 web view included), memory as PRIVATE working set (what Task Manager's Details tab calls "Memory
  (private working set)"; shared pages are not counted twice), CPU as a share of the whole machine.

.EXAMPLE
  .\test-memory-usage.ps1                      # VTT Chat, 60 seconds
  .\test-memory-usage.ps1 -Name Discord -Seconds 120
  .\test-memory-usage.ps1 -RootPid 12345       # one process (and its children) by pid
  .\test-memory-usage.ps1 -SelfTest            # prove the script measures correctly

  -Name is the process name WITHOUT ".exe": see Task Manager > Details. See scripts\test\README.md for how to
  compare apps fairly. The output line has the same shape as test-memory-usage.sh (Linux) and -macos.sh.
#>
param([string]$Name = 'vtt-chat-app', [int]$Seconds = 60, [int]$RootPid = 0, [switch]$SelfTest)

function Get-Tree($rootPids) {
  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.HashSet[uint32]]::new()
  $queue = [System.Collections.Generic.Queue[uint32]]::new()
  foreach ($p in $rootPids) { [void]$ids.Add($p); $queue.Enqueue($p) }
  while ($queue.Count) {
    $parent = $queue.Dequeue()
    foreach ($c in $all | Where-Object ParentProcessId -eq $parent) {
      if ($ids.Add($c.ProcessId)) { $queue.Enqueue($c.ProcessId) }
    }
  }
  $ids
}

function Get-Roots([string]$Name, [int]$RootPid) {
  if ($RootPid -gt 0) { return @($RootPid) }
  $found = Get-Process -Name $Name -ErrorAction SilentlyContinue
  if (-not $found) {
    throw "No running process named '$Name'. Use the name from Task Manager > Details, without '.exe'."
  }
  @($found.Id)
}

# Samples every 5 seconds for $Seconds; returns the numbers (the caller prints or checks them).
function Measure-Footprint([string]$Name, [int]$Seconds, [int]$RootPid) {
  $cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
  $mem = @(); $cpu = @(); $most = 0
  for ($i = 0; $i -lt [math]::Max(1, $Seconds / 5); $i++) {
    $ids = Get-Tree (Get-Roots $Name $RootPid)
    $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
            Where-Object { $ids.Contains([uint32]$_.IDProcess) }
    $mem += ($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB
    $cpu += ($perf | Measure-Object PercentProcessorTime -Sum).Sum / $cores
    if ($ids.Count -gt $most) { $most = $ids.Count }
    Start-Sleep 5
  }
  [pscustomobject]@{
    Count = $most
    AvgMB = ($mem | Measure-Object -Average).Average
    PeakMB = ($mem | Measure-Object -Maximum).Maximum
    CpuPct = ($cpu | Measure-Object -Average).Average
    Cores = $cores
  }
}

function Format-Footprint($r) {
  "{0} processes, private working set: avg {1:N1} MB, peak {2:N1} MB; CPU avg {3:N2}% of the whole machine" -f `
    $r.Count, $r.AvgMB, $r.PeakMB, $r.CpuPct
}

if ($SelfTest) {
  # A parent holding ~100 MB with a child that holds ~100 MB and spins one core: the script must see both.
  $dir = Join-Path ([IO.Path]::GetTempPath()) "footprint-selftest-$PID"
  New-Item -ItemType Directory $dir | Out-Null
  $child = Join-Path $dir 'child.ps1'
  $parent = Join-Path $dir 'parent.ps1'
  "`$s = 'x' * 50MB; `$t = Get-Date; while (((Get-Date) - `$t).TotalSeconds -lt 60) { }" | Set-Content $child
  "`$null = Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-File','$child'; `$s = 'x' * 50MB; Start-Sleep 60" | Set-Content $parent
  $proc = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-File', $parent
  $ok = $true
  try {
    Start-Sleep 8
    $r = Measure-Footprint '' 10 $proc.Id
    Format-Footprint $r
    # Each host process also has its own baseline, so the memory bound is a floor, not a tight range.
    if ($r.Count -lt 2) { "FAIL: expected the parent and its child, saw $($r.Count) process(es)"; $ok = $false }
    if ($r.AvgMB -lt 200) { "FAIL: expected at least 200 MB (two 100 MB holders), saw $([math]::Round($r.AvgMB)) MB"; $ok = $false }
    $floor = 0.6 * 100 / $r.Cores
    if ($r.CpuPct -lt $floor) { "FAIL: expected about one busy core ($([math]::Round(100 / $r.Cores))%), saw $([math]::Round($r.CpuPct, 2))%"; $ok = $false }
  } finally {
    Get-Tree @($proc.Id) | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($ok) { 'SELF-TEST PASSED: the script counts the whole tree, its memory, and its CPU correctly.' }
  exit $(if ($ok) { 0 } else { 1 })
}

Format-Footprint (Measure-Footprint $Name $Seconds $RootPid)
