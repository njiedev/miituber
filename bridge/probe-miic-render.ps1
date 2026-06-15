$ErrorActionPreference = 'Stop'
$path = 'C:\Users\thedr\Downloads\mee (1).miic'
$bytes = [System.IO.File]::ReadAllBytes($path)

function Get-Hex([byte[]]$data) {
  -join ($data | ForEach-Object { $_.ToString('x2') })
}

function Get-FfsdCrc16([byte[]]$data) {
  $crc = [uint32]0
  for ($i = 0; $i -lt 94; $i++) {
    $byte = [uint32]$data[$i]
    for ($bit = 7; $bit -ge 0; $bit--) {
      $flag = (($crc -band 0x8000) -ne 0)
      $crc = (($crc -shl 1) -bor (($byte -shr $bit) -band 1))
      if ($flag) { $crc = $crc -bxor 0x1021 }
    }
  }
  for ($i = 0; $i -lt 16; $i++) {
    $flag = (($crc -band 0x8000) -ne 0)
    $crc = ($crc -shl 1)
    if ($flag) { $crc = $crc -bxor 0x1021 }
  }
  [uint16]($crc -band 0xffff)
}

function Set-FfsdCrc16([byte[]]$data) {
  $copy = [byte[]]::new($data.Length)
  [Array]::Copy($data, $copy, $data.Length)
  $crc = Get-FfsdCrc16 $copy
  $copy[94] = [byte](($crc -shr 8) -band 0xff)
  $copy[95] = [byte]($crc -band 0xff)
  $copy
}

function Test-Render($name, [byte[]]$payload) {
  $hex = Get-Hex $payload
  $url = "http://127.0.0.1:5000/miis/image.png?data=$hex"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    [pscustomobject]@{
      Name=$name; Len=$payload.Length; Status=$response.StatusCode; ContentType=$response.Headers['Content-Type']; Bytes=$response.RawContentStream.Length; Body='OK'; First16=(Get-Hex $payload[0..([Math]::Min(15,$payload.Length-1))])
    }
  } catch {
    $status = $null
    $body = $_.Exception.Message
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $body = $reader.ReadToEnd()
      } catch {}
    }
    [pscustomobject]@{
      Name=$name; Len=$payload.Length; Status=$status; ContentType=''; Bytes=0; Body=($body -replace "\s+", ' '); First16=(Get-Hex $payload[0..([Math]::Min(15,$payload.Length-1))])
    }
  }
}

$tests = @()
$tests += @{ Name='raw-128'; Payload=$bytes }
$first96 = [byte[]]$bytes[0..95]
$tests += @{ Name='first96-as-is'; Payload=$first96 }
$tests += @{ Name='first96-recrc'; Payload=(Set-FfsdCrc16 $first96) }
$tests += @{ Name='first88'; Payload=[byte[]]$bytes[0..87] }
foreach ($offset in @(1,2,4,8,16,20,24,28,32)) {
  if ($offset + 95 -lt $bytes.Length) {
    $window = [byte[]]$bytes[$offset..($offset+95)]
    $tests += @{ Name="win96-$offset-recrc"; Payload=(Set-FfsdCrc16 $window) }
  }
}

$results = foreach ($test in $tests) { Test-Render $test.Name $test.Payload }
$results | Format-Table -AutoSize
$results | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath bridge\last-render-probes.json
