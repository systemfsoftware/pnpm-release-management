usage() {
  cat >&2 <<'EOF'
usage: sandbox [--allow-host HOST[:PORT]]... [--egress-log PATH] [--publish HOST_PORT:SANDBOX_PORT]... [--listen PORT]... [--pass-env NAME]... [--pnpm-store DIR] [--] COMMAND [ARG]...

Runs COMMAND with the project directory read-write, an empty $HOME, a cleared
environment and only the invoking closure's /nix/store paths readable. Each
--allow-host opens HTTPS egress to that host (default port 443; "*.example.com"
matches subdomains) through an allow-list proxy; nothing else leaves.
--egress-log appends one JSONL line per proxy decision to PATH, which must live
outside the project, the sandbox $HOME and its /tmp. --publish HOST_PORT:SANDBOX_PORT
makes the sandbox port reachable as 127.0.0.1:HOST_PORT on the host; --listen
declares a sandbox port the stack may bind without publishing it. --pnpm-store
(default $SANDBOX_PNPM_STORE) resolves pnpm offline from that read-only store,
so pnpm needs no registry.
EOF
  exit 2
}

valid_port() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
  esac
  local n=$((10#$1))
  [ "$n" -ge 1 ] && [ "$n" -le 65535 ]
}

hosts=()
publishes=()
listens=()
egress_log=""
pnpm_store="${SANDBOX_PNPM_STORE:-}"
pass=(PATH TERM LANG LC_ALL TZ CI NO_COLOR FORCE_COLOR COLORTERM)
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-host)
      [ $# -ge 2 ] || usage
      hosts+=("$2")
      shift 2
      ;;
    --egress-log)
      [ $# -ge 2 ] || usage
      egress_log="$2"
      shift 2
      ;;
    --publish)
      [ $# -ge 2 ] || usage
      case "$2" in
        *:*) h="${2%%:*}" p="${2##*:}" ;;
        *) usage ;;
      esac
      { valid_port "$h" && valid_port "$p"; } || usage
      publishes+=("$h:$p")
      shift 2
      ;;
    --listen)
      [ $# -ge 2 ] || usage
      valid_port "$2" || usage
      listens+=("$2")
      shift 2
      ;;
    --pass-env)
      [ $# -ge 2 ] || usage
      pass+=("$2")
      shift 2
      ;;
    --pnpm-store)
      [ $# -ge 2 ] || usage
      pnpm_store="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || usage

project="${SANDBOX_PROJECT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)}"
project="$(cd "$project" && pwd -P)"
cwd="$(pwd -P)"
case "$cwd/" in "$project"/*) ;; *) cwd="$project" ;; esac

pnpm_root=""
dir="$cwd"
while :; do
  if [ -f "$dir/pnpm-workspace.yaml" ]; then pnpm_root="$dir"; break; fi
  if [ -z "$pnpm_root" ] && [ -f "$dir/package.json" ]; then pnpm_root="$dir"; fi
  [ "$dir" = "$project" ] || [ "$dir" = / ] && break
  dir="$(dirname "$dir")"
done
if [ -n "$pnpm_root" ] && command -v pnpm >/dev/null 2>&1; then
  pinned="$("@node@" -e 'const m = /^pnpm@(\d+\.\d+)\./.exec(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).packageManager ?? ""); process.stdout.write(m ? m[1] : "")' "$pnpm_root/package.json")"
  provided="$(cd / && pnpm_config_manage_package_manager_versions=false pnpm --version)"
  provided_minor="${provided%.*}"
  if [ -n "$pinned" ] && [ "$pinned" != "$provided_minor" ]; then
    echo "sandbox: $pnpm_root/package.json pins pnpm $pinned.x but the pnpm on PATH is $provided; pin the pnpm the sandbox provides (packageManager \"pnpm@$provided\")" >&2
    exit 2
  fi
fi

git_rw=()
git_ro=()
git_dir="$(git -C "$project" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
if [ -n "$git_dir" ]; then
  git_dir="$(cd "$git_dir" && pwd -P)"
  case "$git_dir/" in
    "$project"/*) ;;
    *)
      git_common="$(git -C "$project" rev-parse --path-format=absolute --git-common-dir)"
      git_common="$(cd "$git_common" && pwd -P)"
      git_rw+=("$git_dir")
      for entry in objects refs logs modules; do
        if [ -e "$git_common/$entry" ]; then git_rw+=("$git_common/$entry"); fi
      done
      for entry in config packed-refs info shallow; do
        if [ -e "$git_common/$entry" ]; then git_ro+=("$git_common/$entry"); fi
      done
      ;;
  esac
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/sandbox.XXXXXX")"
work="$(cd "$work" && pwd -P)"
proxy_pid=""
forwards=()
group=""
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  [ -z "$group" ] || kill -KILL -- "-$group" 2>/dev/null || true
  [ -z "$proxy_pid" ] || kill "$proxy_pid" 2>/dev/null || true
  if [ "${#forwards[@]}" -gt 0 ]; then
    for pid in "${forwards[@]}"; do kill "$pid" 2>/dev/null || true; done
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

system="$(uname -s)"
if [ "$system" = Darwin ]; then
  sandbox_home="$work/home"
  sandbox_tmp="$work/tmp"
else
  sandbox_home="/home/sandbox"
  sandbox_tmp="/tmp"
fi

if [ -n "$egress_log" ]; then
  egress_log="$(realpath -m "$egress_log")"
  for root in "$project" "$sandbox_home" "$sandbox_tmp" "$work"; do
    realroot="$(realpath -m "$root")"
    case "$egress_log/" in
      "$realroot"/*)
        echo "sandbox: --egress-log $egress_log resolves inside the sandbox's writable tree ($realroot)" >&2
        exit 2
        ;;
    esac
  done
  mkdir -p "$(dirname "$egress_log")" 2>/dev/null || true
  touch "$egress_log" 2>/dev/null || {
    echo "sandbox: --egress-log $egress_log is not writable" >&2
    exit 2
  }
fi

start_proxy() {
  if [ -n "$egress_log" ]; then
    SANDBOX_EGRESS_LOG="$egress_log" "@node@" "@egressProxy@" "$1" "$work/proxy.addr" "${hosts[@]}" &
  else
    "@node@" "@egressProxy@" "$1" "$work/proxy.addr" "${hosts[@]}" &
  fi
  proxy_pid=$!
  for _ in $(seq 1 100); do
    [ -s "$work/proxy.addr" ] && return 0
    kill -0 "$proxy_pid" 2>/dev/null || break
    sleep 0.05
  done
  echo "sandbox: egress proxy failed to start" >&2
  exit 1
}

roots=()
add_root() {
  case "$1" in
    /nix/store/*)
      local rest="${1#/nix/store/}"
      roots+=("/nix/store/${rest%%/*}")
      ;;
  esac
}

IFS=: read -r -a path_dirs <<<"$PATH"
for dir in "${path_dirs[@]}"; do add_root "$dir"; done
command_path="$(command -v -- "$1" 2>/dev/null || true)"
[ -z "$command_path" ] || add_root "$(realpath -m "$command_path")"
add_root "$(realpath -m "$1")"
add_root "$pnpm_store"
add_root "@caBundle@"
add_root "@sh@"
add_root "@socat@"
add_root "@sleep@"

if [ "${#roots[@]}" -eq 0 ]; then
  echo "sandbox: could not resolve any /nix/store roots for the invocation" >&2
  exit 1
fi
mapfile -t closure < <("@nixStore@" --query --requisites "${roots[@]}" | sort -u)
if [ "${#closure[@]}" -eq 0 ]; then
  echo "sandbox: nix-store --query --requisites resolved an empty closure" >&2
  exit 1
fi

envs=(
  HOME=/home/sandbox
  TMPDIR=/tmp
  SSL_CERT_FILE="@caBundle@"
  NIX_SSL_CERT_FILE="@caBundle@"
  NODE_EXTRA_CA_CERTS="@caBundle@"
  SANDBOX=1
  XDG_CACHE_HOME="$project/.cache"
  pnpm_config_manage_package_manager_versions=false
)
for name in "${pass[@]}"; do
  if [ -n "${!name+x}" ]; then envs+=("$name=${!name}"); fi
done
if [ -n "$pnpm_store" ]; then
  store_view="$work/tmp/pnpm-store"
  for layout in "$pnpm_store"/v*; do
    [ -d "$layout" ] || continue
    mkdir -p "$store_view/${layout##*/}"
    for entry in "$layout"/*; do
      if [ "${entry##*/}" = index.db ]; then
        cp "$entry" "$store_view/${layout##*/}/index.db"
        chmod u+w "$store_view/${layout##*/}/index.db"
      else
        ln -s "$entry" "$store_view/${layout##*/}/${entry##*/}"
      fi
    done
  done
  envs+=(
    pnpm_config_store_dir="$store_view"
    pnpm_config_offline=true
    pnpm_config_frozen_lockfile=true
    pnpm_config_trust_lockfile=true
    pnpm_config_ignore_scripts=true
    pnpm_config_package_import_method=clone-or-copy
  )
fi
proxy_url="http://127.0.0.1:3128"
if [ "${#hosts[@]}" -gt 0 ] || [ -n "$egress_log" ]; then
  envs+=(
    HTTPS_PROXY="$proxy_url" https_proxy="$proxy_url"
    HTTP_PROXY="$proxy_url" http_proxy="$proxy_url"
    "NO_PROXY=localhost,127.0.0.1" "no_proxy=localhost,127.0.0.1"
    NODE_USE_ENV_PROXY=1
  )
fi

case "$system" in
  Linux)
    args=(
      --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv
      --proc /proc --dev /dev --tmpfs /tmp
      --tmpfs /home --dir /home/sandbox
      --perms 0111 --tmpfs /nix/store
    )
    for entry in "${closure[@]}"; do args+=(--ro-bind "$entry" "$entry"); done
    for path in /usr /bin /lib /lib64 /sbin /run/current-system/sw \
      /etc/passwd /etc/group /etc/hosts /etc/nsswitch.conf /etc/localtime; do
      args+=(--ro-bind-try "$path" "$path")
    done
    args+=(--bind "$project" "$project" --chdir "$cwd")
    for entry in "${git_rw[@]}"; do args+=(--bind "$entry" "$entry"); done
    for entry in "${git_ro[@]}"; do args+=(--ro-bind "$entry" "$entry"); done
    if [ -n "${store_view:-}" ]; then args+=(--bind "$store_view" "$store_view"); fi

    pubdir=""
    if [ "${#publishes[@]}" -gt 0 ]; then
      pubdir="$work/pub"
      mkdir -p "$pubdir"
      args+=(--bind "$pubdir" "$pubdir")
    fi

    wrapper=""
    if [ "${#hosts[@]}" -gt 0 ] || [ -n "$egress_log" ]; then
      start_proxy "$work/egress.sock"
      args+=(--ro-bind "$work/egress.sock" /run/egress.sock)
      wrapper+="@socat@ TCP-LISTEN:3128,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:/run/egress.sock 2>/dev/null &"$'\n'
      # shellcheck disable=SC2016
      wrapper+='i=0
until "@socat@" -u /dev/null TCP:127.0.0.1:3128 2>/dev/null || [ "$i" -ge 100 ]; do
  i=$((i + 1))
  "@sleep@" 0.05
done
'
    fi
    if [ -n "$pubdir" ]; then
      for spec in "${publishes[@]}"; do
        wrapper+="@socat@ UNIX-LISTEN:$pubdir/pub-${spec##*:}.sock,fork,reuseaddr TCP:127.0.0.1:${spec##*:} 2>/dev/null &"$'\n'
      done
    fi

    for entry in "${envs[@]}"; do args+=(--setenv "${entry%%=*}" "${entry#*=}"); done

    status=0
    if [ -n "$wrapper" ]; then
      wrapper+='exec "$@"'
      if [ -n "$pubdir" ]; then
        "@bwrap@" "${args[@]}" -- "@sh@" -c "$wrapper" sandbox "$@" &
        bwrap_pid=$!
        for spec in "${publishes[@]}"; do
          i=0
          while [ ! -S "$pubdir/pub-${spec##*:}.sock" ] && [ "$i" -lt 200 ]; do
            i=$((i + 1))
            "@sleep@" 0.05
          done
        done
        for spec in "${publishes[@]}"; do
          "@socat@" TCP-LISTEN:"${spec%%:*}",bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:"$pubdir/pub-${spec##*:}.sock" 2>/dev/null &
          forwards+=("$!")
        done
        wait "$bwrap_pid" || status=$?
      else
        "@bwrap@" "${args[@]}" -- "@sh@" -c "$wrapper" sandbox "$@" || status=$?
      fi
    else
      "@bwrap@" "${args[@]}" -- "$@" || status=$?
    fi
    exit "$status"
    ;;
  Darwin)
    home="$work/home"
    tmp="$work/tmp"
    runtime="$tmp/runtime"
    mkdir -p "$home" "$tmp" "$runtime"
    chmod 0700 "$runtime"

    closure_read=""
    closure_exec=""
    for entry in "${closure[@]}"; do
      closure_read+="(subpath \"$entry\") "
      closure_exec+="(subpath \"$entry\") "
    done
    bind_ports=""
    for spec in "${publishes[@]}"; do bind_ports+="(local ip \"localhost:${spec##*:}\") "; done
    for port in "${listens[@]}"; do bind_ports+="(local ip \"localhost:$port\") "; done
    git_read_write=""
    git_read=""
    git_ancestors=""
    for entry in "${git_rw[@]}"; do
      git_read_write+="(subpath \"$entry\") "
      git_ancestors+="(path-ancestors \"$entry\") "
    done
    for entry in "${git_ro[@]}"; do
      git_read+="(subpath \"$entry\") "
      git_ancestors+="(path-ancestors \"$entry\") "
    done

    profile="$work/profile.sb"
    while IFS= read -r line; do
      case "$line" in
        ';;CLOSURE_READ;;') printf '(allow file-read* %s)\n' "$closure_read" ;;
        ';;CLOSURE_EXEC;;') printf '(allow file-map-executable %s)\n' "$closure_exec" ;;
        ';;BIND;;')
          if [ -n "$bind_ports" ]; then printf '(allow network-bind %s)\n' "$bind_ports"; fi
          ;;
        ';;GIT;;')
          if [ -n "$git_read_write" ]; then printf '(allow file-read* file-write* %s)\n' "$git_read_write"; fi
          if [ -n "$git_read" ]; then printf '(allow file-read* %s)\n' "$git_read"; fi
          if [ -n "$git_ancestors" ]; then printf '(allow file-read-metadata %s)\n' "$git_ancestors"; fi
          ;;
        *) printf '%s\n' "$line" ;;
      esac
    done <"@darwinProfile@" >"$profile"

    darwin_envs=()
    runtime_env=0
    for entry in "${envs[@]}"; do
      case "$entry" in
        HOME=*) darwin_envs+=("HOME=$home") ;;
        TMPDIR=*) darwin_envs+=("TMPDIR=$tmp") ;;
        XDG_RUNTIME_DIR=*)
          darwin_envs+=("XDG_RUNTIME_DIR=$runtime")
          runtime_env=1
          ;;
        *) darwin_envs+=("$entry") ;;
      esac
    done
    if [ "$runtime_env" -eq 0 ]; then darwin_envs+=("XDG_RUNTIME_DIR=$runtime"); fi
    if [ "${#hosts[@]}" -gt 0 ] || [ -n "$egress_log" ]; then
      start_proxy tcp
      url="http://$(cat "$work/proxy.addr")"
      for index in "${!darwin_envs[@]}"; do
        darwin_envs[index]="${darwin_envs[index]//$proxy_url/$url}"
      done
    fi

    cd "$cwd"
    set -m
    (
      for spec in "${publishes[@]}"; do
        h="${spec%%:*}"
        p="${spec##*:}"
        if [ "$h" != "$p" ]; then
          "@socat@" TCP-LISTEN:"$h",bind=127.0.0.1,fork,reuseaddr TCP:127.0.0.1:"$p" 2>/dev/null &
        fi
      done
      /usr/bin/sandbox-exec -f "$profile" \
        -D PROJECT="$project" -D HOME="$home" -D TMP="$tmp" \
        /usr/bin/env -i "${darwin_envs[@]}" "$@"
    ) &
    group=$!
    status=0
    if [ -t 0 ]; then
      fg %% >/dev/null || status=$?
    else
      wait "$group" || status=$?
    fi
    exit "$status"
    ;;
  *)
    echo "sandbox: unsupported system $system" >&2
    exit 1
    ;;
esac
