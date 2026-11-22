#!/bin/sh
# breeze 서버 플러그인 설치(맥 · 리눅스 · Termux). 어느 폴더에서 실행하든 실리태번 폴더를 찾아 설치한다.
#   sh install.sh [실리태번 포트]
# 찾는 순서: 지금 폴더가 실리태번 폴더면 거기 → 그 포트를 듣고 있는 서버 · 돌고 있는 server.js 의 작업 폴더.
# 못 찾으면 아무것도 건드리지 않는다.
port=${1:-8000}
d=
[ -f server.js ] && [ -f config.yaml ] && d=$PWD
if [ -z "$d" ]; then
    for p in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null) $(pgrep -f 'server\.js' 2>/dev/null); do
        c=$(readlink "/proc/$p/cwd" 2>/dev/null || lsof -a -d cwd -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p')
        if [ -f "$c/server.js" ] && [ -f "$c/config.yaml" ]; then d=$c; break; fi
    done
fi
if [ -z "$d" ]; then
    echo "실리태번 폴더를 못 찾았어요. 실리태번 폴더로 이동한 뒤 다시 붙여 넣어 주세요."
    exit 1
fi
cd "$d" || exit 1
# 확장이 어느 사용자 폴더 · 어느 이름으로 깔렸든 찾음(이미 깔린 plugins 쪽은 빼고)
s=$(find . -path ./node_modules -prune -o -path ./plugins -prune -o -type d -path '*/server-plugin/breeze-server' -print | head -1)
if [ -z "$s" ]; then
    echo "breeze 확장 폴더를 못 찾았어요: $d"
    exit 1
fi
mkdir -p plugins/breeze-server && cp -R "$s/." plugins/breeze-server/ || exit 1
sed -i.bak 's/^enableServerPlugins:.*/enableServerPlugins: true/' config.yaml
echo "breeze 서버 플러그인 설치 완료: $d"
echo "실리태번 서버를 끄고 다시 실행하세요."
