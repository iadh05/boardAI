#!/usr/bin/env bash
# Checks the edge proxy end to end (ticket M1-14b). Needs Nginx (`docker compose up -d nginx`),
# the server on :3000 with its log in $SERVER_LOG, and Vite on :5173.
#   SERVER_LOG=/tmp/server.log infra/nginx/smoke.sh
set -euo pipefail

EDGE=${EDGE:-http://localhost:8080}
SERVER_LOG=${SERVER_LOG:?set SERVER_LOG to the file the server logs to}
failures=0

pass() { echo "ok   - $1"; }
fail() {
  echo "FAIL - $1"
  failures=$((failures + 1))
}

# 1. /api/* reaches Hono, and one id ties the Nginx log to the server log.
headers=$(curl -s -o /dev/null -D - "$EDGE/api/health")
status=$(head -1 <<<"$headers" | awk '{print $2}')
request_id=$(grep -i '^x-request-id:' <<<"$headers" | awk '{print $2}' | tr -d '\r')
[[ $status == 200 ]] && pass "GET /api/health -> 200" || fail "GET /api/health -> $status"
sleep 1 # both logs are written after the response is sent
if [[ -n $request_id ]] && docker compose logs nginx | grep -q "\"request_id\":\"$request_id\""; then
  pass "Nginx logged request id $request_id"
else
  fail "Nginx log has no request id '$request_id'"
fi
if [[ -n $request_id ]] && grep -q "\"requestId\":\"$request_id\"" "$SERVER_LOG"; then
  pass "server logged the same request id"
else
  fail "server log has no request id '$request_id'"
fi

# 2. / reaches Vite, including the hot-reload WebSocket handshake (101 Switching Protocols).
status=$(curl -s -o /dev/null -w '%{http_code}' "$EDGE/")
[[ $status == 200 ]] && pass "GET / -> 200 (Vite)" || fail "GET / -> $status"
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: c21va2UtdGVzdC1rZXkxMg==' -H 'Sec-WebSocket-Protocol: vite-hmr' \
  "$EDGE/" || true)
[[ $status == 101 ]] && pass "hot-reload WebSocket upgrades (101)" || fail "WebSocket upgrade -> $status"

# 2b. A room's WebSocket (M2) reaches the server through /ws/, from a page on this host…
upgrade() { # $1 = path, $2 = Origin
  curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: c21va2UtdGVzdC1rZXkxMg==' -H "Origin: $2" "$EDGE$1" || true
}
status=$(upgrade /ws/rooms/k3x9a2b7q1zm "$EDGE")
[[ $status == 101 ]] && pass "room WebSocket upgrades (101)" || fail "room WebSocket -> $status"
# …and not from another site (cross-site WebSocket hijacking).
status=$(upgrade /ws/rooms/k3x9a2b7q1zm https://evil.example)
[[ $status == 403 ]] && pass "room WebSocket from another site -> 403" || fail "foreign origin -> $status"

# 3. A board bigger than 1 MB is refused at the edge.
status=$(head -c 1100000 /dev/zero | tr '\0' 'a' |
  curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary @- "$EDGE/api/chat")
[[ $status == 413 ]] && pass "1.1 MB body -> 413" || fail "1.1 MB body -> $status"

# 4. Rate limit on /api/chat: 10/min with a burst of 3, so most of 15 rapid requests get 429.
# (The other ones reach the server; before the chat module exists it answers 404.)
limited=0
for _ in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$EDGE/api/chat")
  [[ $code == 429 ]] && limited=$((limited + 1))
done
((limited >= 10)) && pass "$limited of 15 rapid POST /api/chat -> 429" || fail "only $limited of 15 got 429"

# 5. Rate limit on opening rooms: 30/min with a burst of 10, so most of 40 rapid opens get 429.
limited=0
for _ in $(seq 1 40); do
  [[ $(upgrade /ws/rooms/k3x9a2b7q1zm "$EDGE") == 429 ]] && limited=$((limited + 1))
done
((limited >= 20)) && pass "$limited of 40 rapid room opens -> 429" || fail "only $limited of 40 room opens got 429"

((failures == 0)) && echo "edge proxy: all checks passed" || exit 1
