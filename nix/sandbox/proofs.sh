failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

alive=SANDBOX-PROOF-ALIVE

refused() {
  local name="$1"
  shift
  local out status=0
  out="$("$@" 2>/dev/null)" || status=$?
  if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -qx "$alive"; then pass "$name"; else fail "$name"; fi
}

allowed() {
  local name="$1"
  shift
  local out status=0
  out="$("$@")" || status=$?
  if [ "$status" -eq 0 ] && printf '%s\n' "$out" | grep -qx "$alive"; then pass "$name"; else fail "$name"; fi
}

rejects() {
  local name="$1"
  shift
  local status=0
  "$@" >/dev/null 2>&1 || status=$?
  if [ "$status" -eq 2 ]; then pass "$name"; else fail "$name"; fi
}

log_check() {
  local name="$1" file="$2" expected="$3"
  if SANDBOX_LOG_FILE="$file" SANDBOX_LOG_EXPECTED="$expected" node -e '
const fs = require("fs");
const recs = fs.readFileSync(process.env.SANDBOX_LOG_FILE, "utf8").trim().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
const want = JSON.parse(process.env.SANDBOX_LOG_EXPECTED);
if (recs.length !== want.length) throw new Error("expected " + want.length + " lines, got " + recs.length);
want.forEach((entry, index) => {
  for (const key of ["host", "port", "decision", "rule"]) {
    if (recs[index][key] !== entry[key]) throw new Error("line " + index + " " + key + ": " + JSON.stringify(recs[index][key]) + " != " + JSON.stringify(entry[key]));
  }
});
' 2>/dev/null; then
    pass "$name"
  else
    fail "$name"
  fi
}

scratch="$(mktemp -d "${TMPDIR:-/tmp}/sandbox-proofs.XXXXXX")"
scratch="$(cd "$scratch" && pwd -P)"
project="$scratch/project"
outside="$scratch/outside"
mkdir -p "$project" "$outside" "$HOME/.ssh" "$HOME/.config"
ssh_canary="$HOME/.ssh/sandbox-proof-canary"
config_canary="$HOME/.config/sandbox-proof-canary"
echo secret > "$ssh_canary"
echo secret > "$config_canary"
logdir="$(mktemp -d "$HOME/sandbox-proofs-log.XXXXXX")"
logdir="$(cd "$logdir" && pwd -P)"
sandbox_pid=""
cleanup() {
  [ -z "$sandbox_pid" ] || kill "$sandbox_pid" 2>/dev/null || true
  rm -rf "$scratch" "$logdir" "$ssh_canary" "$config_canary"
}
trap cleanup EXIT
git -C "$project" init -q
cd "$project"

refused "reading ~/.ssh is refused" \
  sandbox -- sh -c "echo $alive; cat '$ssh_canary'"
refused "reading ~/.config is refused" \
  sandbox -- sh -c "echo $alive; cat '$config_canary'"

refused "writing outside the project is refused" \
  sandbox -- sh -c "echo $alive; echo escaped > '$outside/written'"
if [ -e "$outside/written" ]; then fail "nothing lands outside the project"; else pass "nothing lands outside the project"; fi

tmp_canary="/tmp/sandbox-proof-$$-$(date +%s)"
case "$(uname -s)" in
  Darwin)
    refused "writing to the real /tmp is refused" \
      sandbox -- sh -c "echo $alive; echo escaped > '$tmp_canary'"
    ;;
  *)
    allowed "a write to /tmp lands in the sandbox's private tmpfs" \
      sandbox -- sh -c "echo escaped > '$tmp_canary' && echo $alive"
    ;;
esac
if [ -e "$tmp_canary" ]; then fail "nothing lands in the host /tmp"; else pass "nothing lands in the host /tmp"; fi

allowed "the project directory is writable" \
  sandbox -- sh -c "echo inside > written && echo $alive"
if [ "$(cat "$project/written" 2>/dev/null)" = inside ]; then pass "project writes reach the host"; else fail "project writes reach the host"; fi

allowed "the environment is cleared to the pass-list" \
  env SSH_AUTH_SOCK=/tmp/agent.sock GPG_AGENT_INFO=/tmp/gpg PROOF_SECRET=leaked \
  sandbox -- sh -c '[ -z "${SSH_AUTH_SOCK:-}${GPG_AGENT_INFO:-}${PROOF_SECRET:-}" ] && echo '"$alive"

if command -v hello >/dev/null 2>&1; then
  fail "the outsider store path is off the sandboxed command's PATH"
else
  pass "the outsider store path is off the sandboxed command's PATH"
fi
if nix-store -qR "$(command -v node)" 2>/dev/null | grep -qx "@outsider@"; then
  fail "the outsider store path is outside the toolchain closure"
else
  pass "the outsider store path is outside the toolchain closure"
fi
refused "reading a store path outside the closure is refused" \
  sandbox -- sh -c "echo $alive; ls '@outsider@'"

refused "listing /nix/store is refused" \
  sandbox -- sh -c "echo $alive; ls /nix/store"

allowed "a tool from the closure still runs" \
  sandbox -- node -e "const fs = require('fs'); const fd = fs.openSync(process.execPath, 'r'); const buf = Buffer.alloc(4); fs.readSync(fd, buf, 0, 4, 0); console.log('$alive')"

tiny="$project/tiny-workspace"
mkdir -p "$tiny"
cp -R "@tinyWorkspace@/." "$tiny/"
chmod -R u+w "$tiny"
if [ "$(pnpm --version)" = "@pnpm12Version@" ]; then
  pass "the install proof runs pnpm @pnpm12Version@"
else
  fail "the install proof runs pnpm @pnpm12Version@"
fi
allowed "an offline pnpm install resolves from the --pnpm-store store" \
  sh -c "cd '$tiny' && sandbox --pnpm-store '@tinyStore@' -- sh -c 'pnpm install && echo $alive'"
if [ -f "$tiny/node_modules/ms/package.json" ]; then
  pass "the offline install links the store's package into node_modules"
else
  fail "the offline install links the store's package into node_modules"
fi

if [ "$(uname -s)" = Darwin ]; then
  bare="$project/tiny-workspace-bare"
  mkdir -p "$bare"
  cp -R "@tinyWorkspace@/." "$bare/"
  chmod -R u+w "$bare"
  lock_status=0
  lock_out="$(cd "$bare" && sandbox --pnpm-store '@tinyStore@' -- env -u XDG_RUNTIME_DIR pnpm install 2>&1)" || lock_status=$?
  if [ "$lock_status" -ne 0 ] && printf '%s\n' "$lock_out" | grep -q ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK; then
    pass "without the private XDG_RUNTIME_DIR the install fails on the /tmp store lock"
  else
    printf '%s\n' "$lock_out" | tail -5
    fail "without the private XDG_RUNTIME_DIR the install fails on the /tmp store lock"
  fi
fi

rejects "a malformed --publish is refused" \
  sandbox --publish 70000:1 -- sh -c "echo $alive"
rejects "a malformed --listen is refused" \
  sandbox --listen 0 -- sh -c "echo $alive"
rejects "an --egress-log path inside the project is refused" \
  sandbox --egress-log "$project/egress.jsonl" -- sh -c "echo $alive"

egress_log="$logdir/mixed.jsonl"
status=0
out="$(sandbox --egress-log "$egress_log" --allow-host example.com -- sh -c "echo $alive; curl -sS --max-time 15 -o /dev/null https://example.com; curl -ksS --max-time 15 -o /dev/null https://github.com")" || status=$?
if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -qx "$alive"; then
  log_check "egress-log records the allowed and refused decisions" "$egress_log" \
    '[{"host":"example.com","port":443,"decision":"allowed","rule":"example.com"},{"host":"github.com","port":443,"decision":"refused","rule":null}]'
else
  fail "egress-log records the allowed and refused decisions"
fi

egress_log="$logdir/refused.jsonl"
status=0
out="$(sandbox --egress-log "$egress_log" -- sh -c "echo $alive; curl -ksS --max-time 15 -o /dev/null https://example.com")" || status=$?
if [ "$status" -ne 0 ] && printf '%s\n' "$out" | grep -qx "$alive"; then
  log_check "egress-log records refusals without --allow-host" "$egress_log" \
    '[{"host":"example.com","port":443,"decision":"refused","rule":null}]'
else
  fail "egress-log records refusals without --allow-host"
fi

refused "an undeclared outbound connection is refused" \
  sandbox -- sh -c "echo $alive; curl -ksS --max-time 15 -o /dev/null https://example.com"

allowed "a declared host is reachable" \
  sandbox --allow-host example.com -- sh -c "curl -sS --max-time 15 -o /dev/null https://example.com && echo $alive"

refused "a declared allow-list refuses every other host" \
  sandbox --allow-host example.com -- sh -c "echo $alive; curl -ksS --max-time 15 -o /dev/null https://github.com"

allowed "loopback serves a local dev server" \
  sandbox --listen 4321 -- sh -c 'node -e "require(\"node:http\").createServer((q, s) => s.end(\"'"$alive"'\")).listen(4321, \"127.0.0.1\")" & sleep 1; curl -sS --max-time 5 http://127.0.0.1:4321; echo; kill $!'

case "$(uname -s)" in
  Linux)
    sandbox --publish 18080:4321 -- sh -c \
      "node -e \"require('node:http').createServer((q, s) => s.end('$alive')).listen(4321, '127.0.0.1')\" & node -e \"require('node:http').createServer((q, s) => s.end('$alive')).listen(4322, '127.0.0.1')\" & sleep 30" &
    sandbox_pid=$!
    i=0
    until curl -sS --max-time 2 http://127.0.0.1:18080 2>/dev/null | grep -q "$alive" || [ "$i" -ge 100 ]; do
      i=$((i + 1))
      sleep 0.1
    done
    if curl -sS --max-time 3 http://127.0.0.1:18080 2>/dev/null | grep -q "$alive"; then
      pass "a published port answers from the host"
    else
      fail "a published port answers from the host"
    fi
    if curl -sS --max-time 2 -o /dev/null http://127.0.0.1:4322 2>/dev/null; then
      fail "an unpublished port does not answer from the host"
    else
      pass "an unpublished port does not answer from the host"
    fi
    kill "$sandbox_pid" 2>/dev/null || true
    wait "$sandbox_pid" 2>/dev/null || true
    sandbox_pid=""
    ;;
  Darwin)
    bind_err="$logdir/bind-err.txt"
    bind_status=0
    out="$(sandbox -- sh -c "echo $alive; node -e \"require('node:http').createServer().listen(4322, '127.0.0.1')\"" 2>"$bind_err")" || bind_status=$?
    if [ "$bind_status" -ne 0 ] && printf '%s\n' "$out" | grep -qx "$alive" && grep -q -- '--listen' "$bind_err"; then
      pass "an undeclared macOS bind is refused and names --listen"
    else
      fail "an undeclared macOS bind is refused and names --listen"
    fi
    allowed "a --listen port binds on macOS" \
      sandbox --listen 4321 -- sh -c "node -e \"require('node:http').createServer((q, s) => s.end('$alive')).listen(4321, '127.0.0.1')\" & sleep 1; curl -sS --max-time 5 http://127.0.0.1:4321; echo; kill \$!"
    sandbox --publish 18080:4321 -- sh -c \
      "node -e \"require('node:http').createServer((q, s) => s.end('$alive')).listen(4321, '127.0.0.1')\" & sleep 30" &
    sandbox_pid=$!
    i=0
    until curl -sS --max-time 2 http://127.0.0.1:18080 2>/dev/null | grep -q "$alive" || [ "$i" -ge 100 ]; do
      i=$((i + 1))
      sleep 0.1
    done
    if curl -sS --max-time 3 http://127.0.0.1:18080 2>/dev/null | grep -q "$alive"; then
      pass "a --publish port answers from the host on macOS"
    else
      fail "a --publish port answers from the host on macOS"
    fi
    kill "$sandbox_pid" 2>/dev/null || true
    wait "$sandbox_pid" 2>/dev/null || true
    sandbox_pid=""
    ;;
esac

if [ "$failures" -gt 0 ]; then
  echo "$failures sandbox proof(s) failed" >&2
  exit 1
fi
