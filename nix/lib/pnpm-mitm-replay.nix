# mitm-cache makes its per-build CA trusted through SSL_CERT_FILE. pnpm is also
# handed the same CA as an extra root, the one setting pnpm 11 and pnpm 12 both
# add to their trust, so the replayed registry stays https.
''
  export NODE_EXTRA_CA_CERTS="$MITM_CACHE_CA"
''
