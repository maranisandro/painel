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
 *
 * Bug real corrigido (2026-08-29): faltava liberar `fonts.googleapis.com`
 * (style-src) e `fonts.gstatic.com` (font-src) — o próprio Google Maps
 * carrega uma folha de estilo de fonte pra desenhar os controles/ícones
 * internos (setas de navegação, InfoWindow), e sem isso o mapa de
 * Rastreamento (`/dashboard/fase1/mapa`) ficava com o clique nos
 * marcadores quebrado (achado do usuário: "não tem mais as informações da
 * placa quando clica no ícone"). `img-src` também ampliado pra
 * `*.googleapis.com`/`*.gstatic.com` — os tiles de mapa/satélite vêm de
 * vários subdomínios (khms0-3, mts0-3 etc.), não só os dois hosts fixos.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://maps.googleapis.com https://maps.gstatic.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    img-src 'self' data: https://*.googleapis.com https://*.gstatic.com;
    connect-src 'self' https://maps.googleapis.com;
    font-src 'self' data: https://fonts.gstatic.com;
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
