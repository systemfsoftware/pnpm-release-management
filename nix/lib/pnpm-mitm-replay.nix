# mitm-cache makes its per-build CA trusted through SSL_CERT_FILE only. pnpm 12
# reads that on Linux but verifies through the system trust store on macOS, so
# it is handed the same CA as an extra root, the one setting both pnpm 11 and
# pnpm 12 add to their trust on every platform.
''
  export NODE_EXTRA_CA_CERTS="$MITM_CACHE_CA"
''
