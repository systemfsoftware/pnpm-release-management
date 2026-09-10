const ROUTES: Readonly<Record<string, string>> = {
  'api.github.com': 'http://127.0.0.1:4000',
  'registry.npmjs.org': 'http://127.0.0.1:4873',
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

const upstreamFor = (request: Request): string | null => {
  const url = new URL(request.url)
  const base = ROUTES[url.hostname]
  return base === undefined ? null : `${base}${url.pathname}${url.search}`
}

const forward = async (request: Request): Promise<Response> => {
  const upstream = upstreamFor(request)
  if (upstream === null) {
    return new Response(JSON.stringify({ message: 'no upstream for this host' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value)
  }

  const method = request.method
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body

  try {
    return await fetch(upstream, { method, headers, body, redirect: 'manual' })
  } catch (error) {
    return new Response(
      JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }
}

Deno.serve(
  {
    hostname: '0.0.0.0',
    port: 443,
    cert: Deno.readTextFileSync('/e2e/server.crt'),
    key: Deno.readTextFileSync('/e2e/server.key'),
  },
  forward,
)
