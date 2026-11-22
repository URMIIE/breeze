# breeze 서버 플러그인 설치(윈도우 PowerShell). 어느 폴더에서 실행하든 실리태번 폴더를 찾아 설치한다.
# 찾는 순서: 지금 폴더가 실리태번 폴더면 거기 → 돌고 있는 server.js 를 띄운 실행 파일(Start.bat 등)의 폴더.
# 못 찾으면 아무것도 건드리지 않는다.
$d = $null
if ((Test-Path server.js) -and (Test-Path config.yaml)) { $d = (Get-Location).Path }
else {
    $d = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match 'server\.js' } |
        ForEach-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)").CommandLine } |
        ForEach-Object { if ($_ -match '"([^"]+)\\[^\\"]+\.(bat|cmd)"') { $Matches[1] } } |
        Where-Object { Test-Path "$_\config.yaml" } | Select-Object -First 1
}
if (-not $d) { "실리태번 폴더를 못 찾았어요. 실리태번 폴더로 이동한 뒤 다시 붙여 넣어 주세요."; return }
$s = Get-ChildItem "$d\data", "$d\public" -Recurse -Directory -Filter breeze-server -ErrorAction SilentlyContinue |
    Where-Object FullName -like '*server-plugin*' | Select-Object -First 1
if (-not $s) { "breeze 확장 폴더를 못 찾았어요: $d"; return }
Copy-Item -Recurse -Force $s.FullName "$d\plugins"
(Get-Content "$d\config.yaml" -Encoding UTF8) -replace '^enableServerPlugins:.*', 'enableServerPlugins: true' | Set-Content "$d\config.yaml" -Encoding UTF8
"breeze 서버 플러그인 설치 완료: $d"
"실리태번 서버를 끄고 다시 실행하세요."
