#!/bin/zsh
# 더블클릭하면 로컬 서버를 켜고 브라우저에서 포스터 월 시뮬레이터를 엽니다.
# (index.html을 직접 더블클릭하면 file:// 로 열려서 데이터 로딩이 막힙니다.)
cd "$(dirname "$0")"
PORT=5300
URL="http://localhost:$PORT/"

if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html"; then
  nohup /usr/bin/python3 tools/serve.py >/dev/null 2>&1 &
  disown
  for i in {1..30}; do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break
    sleep 0.2
  done
fi

open "$URL"
