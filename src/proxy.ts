import { NextRequest, NextResponse } from 'next/server'

/**
 * CSP com nonce por request (S10, revisão de segurança 2026-07-25) —
 * padrão oficial do Next.js App Router: https://nextjs.org/docs/app/guides/content-security-policy
 * `strict-dynamic` permite que um script já validado pelo nonce (o próprio
 * bootstrap do Next.js) injete outros scripts dinamicamente sem precisar
 * listar cada origem — é assim que `src/lib/google-maps.ts` (injeta
 * `<script src="https://maps.googleapis.com/...">` via `document.createElement`
 * a partir de um componente cliente) continua funcionando. Os demais
 * headers de segurança (X-Frame-Options etc.) ficam em `next.config.ts`,
 * que não precisa de nonce por request.
 *
 * Renomeado de `middleware.ts` para `proxy.ts` (Next.js 16 depreciou o
 * convention `middleware`, ver aviso de build "The middleware file
 * convention is deprecated. Please use proxy instead").
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://maps.googleapis.com https://maps.gstatic.com;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https://maps.gstatic.com https://maps.googleapis.com;
    connect-src 'self' https://maps.googleapis.com;
    font-src 'self' data:;
    frame-ancestors 'none';
    object-src 'none';
    base-uri 'self';
  `
    .replace(/\s{2,}/g, ' ')
    .trim()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', cspHeader)

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })
  response.headers.set('Content-Security-Policy', cspHeader)

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
