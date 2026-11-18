param([string]$Name = 'vtt-chat-app', [int]$Seconds = 60)

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

$roots = (Get-Process -Name $Name -ErrorAction Stop).Id
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$mem = @(); $cpu = @()
for ($i = 0; $i -lt ($Seconds / 5); $i++) {
  $ids = Get-Tree $roots
  $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
          Where-Object { $ids.Contains([uint32]$_.IDProcess) }
  $mem += ($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB
  $cpu += ($perf | Measure-Object PercentProcessorTime -Sum).Sum / $cores
  Start-Sleep 5
}
"{0} processes, private working set: avg {1:N1} MB, peak {2:N1} MB; CPU avg {3:N2}% of the whole machine" -f `
  $ids.Count, ($mem | Measure-Object -Average).Average, ($mem | Measure-Object -Maximum).Maximum, ($cpu | Measure-Object -Average).Average
