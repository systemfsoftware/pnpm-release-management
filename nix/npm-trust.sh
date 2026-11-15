set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: npm-trust <owner/repo> [<owner/repo>...]" >&2
  exit 2
fi

npm_cli() { npx --yes npm@^11.15.0 "$@"; }

if ! npm_cli whoami >/dev/null 2>&1; then
  echo "npm-trust: no npm session; run: npx npm@^11.15.0 login" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=()

registry_status() {
  curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/${1/\//%2f}"
}

# npm accepts a trusted publisher only for a package that already exists.
reserve() {
  local name=$1 repo=$2 dir="$work/reserve"
  rm -rf "$dir" && mkdir -p "$dir"
  jq -n --arg name "$name" --arg repo "$repo" '{
    name: $name,
    version: "0.0.0-bootstrap.0",
    description: "Reserved for trusted publishing from github.com/\($repo).",
    repository: { type: "git", url: "git+https://github.com/\($repo).git" },
    license: "Apache-2.0"
  }' > "$dir/package.json"
  printf '# %s\n\nPublished from https://github.com/%s.\n' "$name" "$repo" > "$dir/README.md"
  (cd "$dir" && npm_cli publish --access public --tag bootstrap)
}

for repo in "$@"; do
  checkout="$work/${repo//\//_}"
  git clone -q --depth 1 "https://github.com/$repo" "$checkout"

  caller=$(grep -l 'pnpm-release-management/.github/workflows/release.yml' \
    "$checkout"/.github/workflows/*.yml "$checkout"/.github/workflows/*.yaml 2>/dev/null | head -n 1 || true)
  file=$(basename "${caller:-release.yml}")

  names=$(cd "$checkout" && git ls-files '*package.json' ':!:**/node_modules/**' ':!:repos/**' \
    | grep -v -E '(^|/)(__fixtures__|fixtures)/' \
    | while read -r manifest; do
        jq -r --arg scope "@${repo%%/*}/" \
          'select(.private != true and (.name // "" | startswith($scope))) | .name' "$manifest" 2>/dev/null
      done | sort -u)

  for name in $names; do
    case "$(registry_status "$name")" in
      200) ;;
      404)
        echo "$name: reserving the name"
        reserve "$name" "$repo" || { failed+=("$name (reserve)"); continue; }
        ;;
      *)
        failed+=("$name (registry lookup)")
        continue
        ;;
    esac

    if npm_cli trust list "$name" --json 2>/dev/null |
      jq -e --arg repo "$repo" --arg file "$file" \
        '[.. | objects | select(.repository? == $repo and .file? == $file)] | length > 0' >/dev/null; then
      echo "$name: trusts $repo already"
    else
      echo "$name: trusting $repo $file"
      npm_cli trust github "$name" --repo "$repo" --file "$file" --allow-publish --yes \
        || failed+=("$name (trust)")
      sleep 2
    fi
  done
done

if [ "${#failed[@]}" -gt 0 ]; then
  printf 'npm-trust: not done: %s\n' "${failed[@]}" >&2
  exit 1
fi
