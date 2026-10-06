# pnpm 12 verifies TLS through the platform verifier, which on macOS refuses
# mitm-cache's per-build certificates, and its tarball client ignores
# strict-ssl. Over plain HTTP the request goes through mitm-cache's proxy with
# no TLS at all; every tarball it serves is a fixed-output fetch keyed by the
# lockfile integrity, and pnpm checks that integrity again. pnpm 11 runs on
# Node, which trusts mitm-cache's CA, and keeps the https path.
''
  if [ "$(pnpm --version | cut -d. -f1)" -ge 12 ]; then
    export pnpm_config_registry=http://registry.npmjs.org/
  fi
''
