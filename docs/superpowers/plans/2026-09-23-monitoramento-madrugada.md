# Monitoramento de Madrugada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando uma placa for detectada rodando durante a madrugada (19h-04h), passar a monitorá-la a cada 5 min (independente do sync normal de 10 min da frota inteira), e dar ao usuário uma tela de detalhe do trecho com mapa + linha de movimento real + estimativa de KM, para distinguir deslocamento de verdade de um "pós-chave" (ignição ligada sem rodar).

**Architecture:** Reaproveita ao máximo o que já existe — a detecção de "rodando à noite", a heurística de ruído de GPS, o cálculo de KM por haversine, a busca individual de placa na Omnilink, e o cron de 5 em 5 min já rodando em produção. O único código genuinamente novo é: (1) extrair a classificação "rodando/parado" por segmento pra reusar entre o número (horas/KM) e o desenho do mapa; (2) um endpoint de detalhe por placa/noite; (3) a UI de mapa; (4) o gatilho de busca extra dentro do cron existente.

**Tech Stack:** Next.js API routes, Prisma, React (client component), Google Maps JavaScript API (`google.maps.Polyline`, já carregada via `src/lib/google-maps.ts`).

**Spec:** `docs/superpowers/specs/2026-09-23-monitoramento-madrugada-design.md`

## Global Constraints

- Projeto não tem suíte de testes automatizada — verificação é sempre manual, com dado real (rodar um script one-off em `scripts/_tmp-*.ts`, conferir a saída, apagar o script depois). Cada task usa esse padrão no lugar de "rodar o teste".
- Nunca alterar o comportamento numérico já em produção de `horasRodandoGps` — o refactor da Task 1 tem que ser comportamento-preservando (mesmo resultado antes/depois para o mesmo input).
- Formato de data/hora sempre `dd/mm/yyyy` no que for exibido ao usuário (padrão já estabelecido no projeto) — usar os helpers já existentes (`fmtDataHora`, `fmtDataCurta`), nunca formatar data na mão.
- Nenhuma dependência nova (nem npm package, nem lib de mapas diferente) — tudo com o que já está instalado.

---

## Task 1: Extrair classificação de segmento GPS (refactor comportamento-preservando)

**Files:**
- Modify: `src/lib/fase1/disponibilidade.ts:52-89` (função `horasRodandoGps`)

**Interfaces:**
- Consumes: `PosicaoSimples` (já existe, `disponibilidade.ts:19-24`: `{ capturedAt: string; speedKmh: number | null; lat?: number | null; lng?: number | null }`), `haversineKm` (`@/lib/geo`).
- Produces:
  - `classificarSegmentoRodando(anterior: PosicaoSimples, atual: PosicaoSimples): boolean` — true se o trecho entre as duas posições conta como "rodando" (mesma regra de hoje: velocidade > 5 km/h em qualquer uma das duas, ou fallback por distância/tempo quando ambas vierem sem velocidade).
  - `export interface SegmentoGps { de: PosicaoSimples; para: PosicaoSimples; rodando: boolean }`
  - `segmentosRodandoGps(posicoesOrdenadas: PosicaoSimples[]): SegmentoGps[]` — um item por par consecutivo, na ordem de entrada.
  - `horasRodandoGps` continua com a mesma assinatura e mesmo comportamento — passa a ser implementada por cima de `segmentosRodandoGps` (soma os minutos dos segmentos com `rodando: true`, respeitando o mesmo filtro de gap máximo já existente).

- [ ] **Step 1: Ler o arquivo inteiro antes de mexer**

Abra `src/lib/fase1/disponibilidade.ts` e leia as linhas 1-90 por completo — a lógica atual de `horasRodandoGps` (limiar de velocidade, gap máximo, fallback por distância) precisa ser preservada byte a byte, só reorganizada.

- [ ] **Step 2: Escrever o script de verificação ANTES do refactor (captura o comportamento atual)**

Crie `scripts/_tmp-verify-segmentos.ts`:

```ts
import 'dotenv/config'
import { horasRodandoGps, type PosicaoSimples } from '../src/lib/fase1/disponibilidade'

// Caso real citado no comentário de disponibilidade.ts (achado 2026-08-26,
// placa TAK5C12) + um caso sintético de "parado com ruído de GPS" (menos
// de 5 km/h, não deve contar como rodando) — cobre os 3 ramos da heurística:
// velocidade normal, fallback por distância (speedKmh null), e ruído.
const casos: { nome: string; posicoes: PosicaoSimples[] }[] = [
  {
    nome: 'rodando normal (velocidade > 5 km/h)',
    posicoes: [
      { capturedAt: '2026-09-01T02:00:00Z', speedKmh: 40, lat: -18.5, lng: -44.0 },
      { capturedAt: '2026-09-01T02:10:00Z', speedKmh: 45, lat: -18.6, lng: -44.05 },
    ],
  },
  {
    nome: 'fallback por distância (speedKmh null, andou de verdade)',
    posicoes: [
      { capturedAt: '2026-09-01T02:00:00Z', speedKmh: null, lat: -18.5, lng: -44.0 },
      { capturedAt: '2026-09-01T02:10:00Z', speedKmh: null, lat: -18.6, lng: -44.08 }, // ~9km em 10min = ~54km/h
    ],
  },
  {
    nome: 'parado com ruído de GPS (não deve contar como rodando)',
    posicoes: [
      { capturedAt: '2026-09-01T02:00:00Z', speedKmh: 0, lat: -18.500000, lng: -44.000000 },
      { capturedAt: '2026-09-01T02:10:00Z', speedKmh: 0, lat: -18.500050, lng: -44.000050 }, // ~7m de deriva
    ],
  },
]

for (const c of casos) {
  console.log(c.nome, '->', horasRodandoGps(c.posicoes), 'horas')
}
```

Rode: `npx tsx scripts/_tmp-verify-segmentos.ts`

Anote a saída exata (os 3 números) — é o "antes" que o refactor não pode mudar.

- [ ] **Step 3: Implementar o refactor**

Substitua o conteúdo de `disponibilidade.ts:42-89` (as constantes `LIMIAR_VELOCIDADE_RODANDO_KMH`/`GAP_MAXIMO_MINUTOS`/`SALTO_GPS_MAXIMO_KM` continuam onde estão) por:

```ts
export function classificarSegmentoRodando(anterior: PosicaoSimples, atual: PosicaoSimples): boolean {
  let rodando =
    (anterior.speedKmh ?? 0) > LIMIAR_VELOCIDADE_RODANDO_KMH || (atual.speedKmh ?? 0) > LIMIAR_VELOCIDADE_RODANDO_KMH

  // Achado real 2026-08-26 (placa TAK5C12, madrugada 24→25/08): o
  // rastreador Omnilink às vezes manda velocidade "-" (sem leitura
  // instantânea) mesmo com a placa realmente em deslocamento — sem este
  // fallback, o trecho inteiro "some" de qualquer cálculo baseado em
  // velocidade, mesmo com posições reais mostrando o caminhão mudando de
  // lugar. Só entra quando NENHUMA das duas leituras tem velocidade (não
  // sobrescreve um "0 km/h" real, que continua contando como parado);
  // mesma técnica de distância haversine já usada em `critica.ts`
  // (`kmPercorridoGps`), descartando saltos de GPS implausíveis.
  const deltaMin = (Date.parse(atual.capturedAt) - Date.parse(anterior.capturedAt)) / 60_000
  if (
    !rodando &&
    anterior.speedKmh == null &&
    atual.speedKmh == null &&
    anterior.lat != null &&
    anterior.lng != null &&
    atual.lat != null &&
    atual.lng != null &&
    deltaMin > 0
  ) {
    const distKm = haversineKm({ lat: anterior.lat, lng: anterior.lng }, { lat: atual.lat, lng: atual.lng })
    if (distKm <= SALTO_GPS_MAXIMO_KM) {
      const velEstimadaKmh = distKm / (deltaMin / 60)
      rodando = velEstimadaKmh > LIMIAR_VELOCIDADE_RODANDO_KMH
    }
  }
  return rodando
}

export interface SegmentoGps {
  de: PosicaoSimples
  para: PosicaoSimples
  rodando: boolean
}

/** Classifica cada par de posições consecutivas como rodando/parado — base compartilhada de `horasRodandoGps` e do desenho do trajeto no mapa (`/api/fase1/rastreamento/noite-rodando/detalhe`), pra nunca divergir entre o número mostrado e a linha desenhada. */
export function segmentosRodandoGps(posicoesOrdenadas: PosicaoSimples[]): SegmentoGps[] {
  const segmentos: SegmentoGps[] = []
  for (let i = 1; i < posicoesOrdenadas.length; i++) {
    const anterior = posicoesOrdenadas[i - 1]
    const atual = posicoesOrdenadas[i]
    const deltaMin = (Date.parse(atual.capturedAt) - Date.parse(anterior.capturedAt)) / 60_000
    const dentroDoGap = deltaMin > 0 && deltaMin <= GAP_MAXIMO_MINUTOS
    segmentos.push({ de: anterior, para: atual, rodando: dentroDoGap && classificarSegmentoRodando(anterior, atual) })
  }
  return segmentos
}

export function horasRodandoGps(posicoesOrdenadas: PosicaoSimples[]): number {
  let minutos = 0
  for (const seg of segmentosRodandoGps(posicoesOrdenadas)) {
    if (!seg.rodando) continue
    minutos += (Date.parse(seg.para.capturedAt) - Date.parse(seg.de.capturedAt)) / 60_000
  }
  return minutos / 60
}
```

- [ ] **Step 4: Rodar o script de verificação de novo e comparar**

Rode: `npx tsx scripts/_tmp-verify-segmentos.ts`

Expected: os 3 números idênticos ao Step 2 (refactor não muda resultado nenhum).

- [ ] **Step 5: Apagar o script temporário e checar tipos**

```bash
rm scripts/_tmp-verify-segmentos.ts
npx tsc --noEmit -p tsconfig.json
```

Expected: sem erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fase1/disponibilidade.ts
git commit -m "refactor: extrai classificarSegmentoRodando/segmentosRodandoGps de horasRodandoGps"
```

---

## Task 2: Expor `kmEstimado` na rota noite-rodando

**Files:**
- Modify: `src/app/api/fase1/rastreamento/noite-rodando/route.ts`

**Interfaces:**
- Consumes: `kmPercorridoGps` (já existe, `src/lib/fase1/critica.ts:344`, assinatura `(posicoes: PosicaoGps[], saltoMaximoKm?: number) => number`).
- Produces: cada item de `rodandoNoite` no JSON de resposta ganha `kmEstimado: number`.

**Nota de tipo:** `kmPercorridoGps` espera `PosicaoGps[]` (`{ placa, capturedAt, latitude, longitude }`), mas o `grupo` desta rota usa `lat`/`lng` (não `latitude`/`longitude`) — precisa mapear os campos, não passar `grupo` direto.

- [ ] **Step 1: Escrever o script de verificação com dado real local**

Crie `scripts/_tmp-verify-km-madrugada.ts`:

```ts
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

async function main() {
  const r = await fetch('http://localhost:3002/api/fase1/rastreamento/noite-rodando?from=2026-09-01&to=2026-09-23', {
    headers: { cookie: process.env.DEV_SESSION_COOKIE ?? '' },
  })
  console.log(await r.json())
}
main().finally(() => prisma.$disconnect())
```

(Esse script serve só de lembrete do formato de teste manual — na prática, rode o dev server (`npm run dev`) e chame a rota logado no navegador via `fetch` no console, ou pelo Playwright já usado nesta sessão, porque a rota exige sessão autenticada. Confirme ANTES da mudança: escolha uma placa/noite qualquer do resultado atual e anote `horasRodando` e o intervalo `primeiraHora`/`ultimaHora` dela — vai comparar depois que o `kmEstimado` aparecer, pra checar se o número faz sentido (poucos km num intervalo longo = suspeita de pós-chave; km compatível com a velocidade média do trecho = deslocamento real).)

- [ ] **Step 2: Implementar**

Em `noite-rodando/route.ts`, adicione o import no topo:

```ts
import { kmPercorridoGps } from '@/lib/fase1/critica'
```

Dentro do loop `for (const grupo of porGrupo.values())` (linha ~147-162), calcule o KM e inclua no objeto empurrado pra `rodandoNoite`:

```ts
for (const grupo of porGrupo.values()) {
  if (grupo.length < 2) continue
  const horasRodando = horasRodandoGps(grupo)
  if (horasRodando < HORAS_MINIMAS_RODANDO) continue
  const kmEstimado = kmPercorridoGps(
    grupo.map((p) => ({ placa: p.placa, capturedAt: p.capturedAt, latitude: p.lat, longitude: p.lng })),
  )
  rodandoNoite.push({
    placa: grupo[0].placa,
    noite: grupo[0].noite,
    horasRodando,
    kmEstimado,
    nPosicoes: grupo.length,
    primeiraHora: grupo[0].capturedAt,
    ultimaHora: grupo[grupo.length - 1].capturedAt,
    localizacaoInicio: grupo[0].localizacao,
    localizacaoFim: grupo[grupo.length - 1].localizacao,
    motoristas: motoristasAteFimDaNoite(grupo[0].placa, grupo[0].noite),
  })
}
```

E adicione `kmEstimado: number` na declaração de tipo do array `rodandoNoite` (linha ~136-146), logo depois de `horasRodando: number`.

- [ ] **Step 3: Verificar com o dev server rodando**

```bash
npm run dev
```

Numa aba logada do navegador (via Playwright ou manualmente), rode no console:

```js
fetch('/api/fase1/rastreamento/noite-rodando?from=2026-09-01&to=2026-09-23').then(r => r.json()).then(j => console.log(j.rodandoNoite.slice(0, 5)))
```

Expected: cada item tem `kmEstimado` numérico (não `undefined`, não `NaN`). Confira pelo menos uma linha manualmente: `kmEstimado` deve ser plausível pro intervalo `primeiraHora`→`ultimaHora` e `horasRodando` (ex.: 2h rodando a uma média de 40-60km/h dá algo entre 80-120km — se vier 0.3km em 2h rodando, ou é bug ou é exatamente o caso "pós-chave" que a feature quer capturar).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/fase1/rastreamento/noite-rodando/route.ts
git commit -m "feat: expoe kmEstimado na rota noite-rodando"
```

---

## Task 3: Endpoint de detalhe por placa/noite (para o mapa)

**Files:**
- Create: `src/app/api/fase1/rastreamento/noite-rodando/detalhe/route.ts`

**Interfaces:**
- Consumes: `segmentosRodandoGps` (Task 1), `diaBrasilDe`/`horaBrasilDe`/`diaAnteriorStr` (`@/lib/horario-brasil`, já usados no arquivo irmão `noite-rodando/route.ts`).
- Produces: `GET /api/fase1/rastreamento/noite-rodando/detalhe?placa=X&noite=YYYY-MM-DD` devolve:
  ```ts
  { pontos: { lat: number; lng: number; capturedAt: string; speedKmh: number | null; rodando: boolean }[] }
  ```
  `rodando` no primeiro ponto é sempre `false` (não existe segmento anterior a ele). Nos demais, reflete se o segmento que TERMINA naquele ponto (vindo do ponto anterior) foi classificado como rodando.

- [ ] **Step 1: Escrever o arquivo**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { diaBrasilDe, horaBrasilDe, diaAnteriorStr } from '@/lib/horario-brasil'
import { segmentosRodandoGps, type PosicaoSimples } from '@/lib/fase1/disponibilidade'

const JANELA_INICIO_HORA = 19
const JANELA_FIM_HORA = 4

function classificarNoite(dia: string, hora: number): string | null {
  if (hora >= JANELA_INICIO_HORA) return dia
  if (hora < JANELA_FIM_HORA) return diaAnteriorStr(dia)
  return null
}

/**
 * Detalhe do trajeto de UMA placa numa madrugada específica — pedido do
 * usuário 2026-09-23: "opção de detalhe com um mapa mostrando uma linha
 * entre as posições de rastreio que demonstrem movimento". Mesmo critério
 * de janela (19h-04h) da rota `noite-rodando`, restrito a uma placa/noite.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })

  const placa = req.nextUrl.searchParams.get('placa')?.trim().toUpperCase()
  const noite = req.nextUrl.searchParams.get('noite')?.trim()
  if (!placa || !noite || !/^\d{4}-\d{2}-\d{2}$/.test(noite)) {
    return NextResponse.json({ error: 'placa e noite (YYYY-MM-DD) são obrigatórios' }, { status: 400 })
  }

  // Mesma janela de tempo real da "noite" (19h do dia `noite` até 04h do dia seguinte).
  const inicio = new Date(`${noite}T16:00:00-03:00`) // margem de 3h antes das 19h, cobre qualquer diferença de fuso na query
  const fim = new Date(`${noite}T04:00:00-03:00`)
  fim.setDate(fim.getDate() + 1)
  fim.setHours(fim.getHours() + 3) // margem de 3h depois das 04h

  const posicoes = await prisma.vehiclePosition.findMany({
    where: { placa, capturedAt: { gte: inicio, lte: fim } },
    select: { latitude: true, longitude: true, capturedAt: true, speedKmh: true },
    orderBy: { capturedAt: 'asc' },
  })

  const filtradas = posicoes.filter((p) => {
    const dia = diaBrasilDe(p.capturedAt)
    const hora = horaBrasilDe(p.capturedAt)
    return classificarNoite(dia, hora) === noite
  })

  const posicoesSimples: PosicaoSimples[] = filtradas.map((p) => ({
    capturedAt: p.capturedAt.toISOString(),
    speedKmh: p.speedKmh,
    lat: p.latitude,
    lng: p.longitude,
  }))

  const segmentos = segmentosRodandoGps(posicoesSimples)
  const pontos = filtradas.map((p, i) => ({
    lat: p.latitude,
    lng: p.longitude,
    capturedAt: p.capturedAt.toISOString(),
    speedKmh: p.speedKmh,
    rodando: i === 0 ? false : segmentos[i - 1].rodando,
  }))

  return NextResponse.json({ pontos })
}
```

- [ ] **Step 2: Checar tipos**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: sem erro.

- [ ] **Step 3: Verificar com dado real (dev server rodando)**

Pegue uma placa/noite real do resultado da Task 2 (ex. a mesma que você anotou lá) e chame no console do navegador (logado):

```js
fetch('/api/fase1/rastreamento/noite-rodando/detalhe?placa=PLACA_REAL&noite=2026-09-XX').then(r => r.json()).then(console.log)
```

Expected: `pontos` não vazio, primeiro item com `rodando: false`, e pelo menos alguns itens com `rodando: true` (senão a placa não devia ter aparecido na lista de "rodando à noite" pra começo de conversa — se isso acontecer, é sinal de bug, investigue antes de prosseguir).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/fase1/rastreamento/noite-rodando/detalhe/route.ts
git commit -m "feat: endpoint de detalhe do trajeto (placa/noite) para o mapa de madrugada"
```

---

## Task 4: UI — coluna de KM + linha expansível com mapa

**Files:**
- Create: `src/components/fase1/TrechoMadrugadaMapa.tsx`
- Modify: `src/components/fase1/RastreamentoFrota.tsx`

**Interfaces:**
- Consumes: endpoint da Task 3 (`GET /api/fase1/rastreamento/noite-rodando/detalhe`), `loadGoogleMaps` (`@/lib/google-maps`), `NoiteRodandoInfo` (interface local já existente em `RastreamentoFrota.tsx:111-122`, ganha `kmEstimado: number`).
- Produces: `TrechoMadrugadaMapa({ placa, noite }: { placa: string; noite: string })` — componente client que busca o detalhe sozinho (no `useEffect`, ao montar) e desenha o(s) polyline(s); usado dentro do `renderExpanded` da tabela "Rodando à noite".

- [ ] **Step 1: Criar o componente de mapa**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/google-maps'

interface Ponto {
  lat: number
  lng: number
  capturedAt: string
  speedKmh: number | null
  rodando: boolean
}

/**
 * Mapa do trecho rodado de madrugada — pedido do usuário 2026-09-23: "mapa
 * mostrando uma linha entre as posições de rastreio que demonstrem
 * movimento". Desenha uma Polyline por trecho CONTÍNUO de `rodando: true`
 * (inclui o ponto imediatamente anterior, que fecha a ponta da linha) — se
 * o caminhão parou no meio e voltou a andar, aparecem 2+ linhas separadas,
 * de propósito (é o comportamento correto, não uma falha).
 */
export function TrechoMadrugadaMapa({ placa, noite }: { placa: string; noite: string }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [pontos, setPontos] = useState<Ponto[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch(`/api/fase1/rastreamento/noite-rodando/detalhe?placa=${encodeURIComponent(placa)}&noite=${noite}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelado) return
        if (body.error) setErro(body.error)
        else setPontos(body.pontos)
      })
      .catch(() => {
        if (!cancelado) setErro('Falha ao buscar o trajeto.')
      })
    return () => {
      cancelado = true
    }
  }, [placa, noite])

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!apiKey || !mapRef.current || !pontos || pontos.length === 0) return
    let cancelado = false

    loadGoogleMaps(apiKey).then(() => {
      if (cancelado || !mapRef.current || !window.google) return
      const { maps } = window.google
      const bounds = new maps.LatLngBounds()
      for (const p of pontos) bounds.extend({ lat: p.lat, lng: p.lng })

      const map = new maps.Map(mapRef.current, { center: bounds.getCenter(), zoom: 12, mapTypeId: 'roadmap' })
      map.fitBounds(bounds)

      // Agrupa em trechos contínuos de `rodando: true` — cada trecho vira
      // uma Polyline própria (inclui o ponto anterior ao primeiro `true`
      // do grupo, pra linha não começar "no ar").
      let trechoAtual: Ponto[] = []
      const trechos: Ponto[][] = []
      for (let i = 0; i < pontos.length; i++) {
        if (pontos[i].rodando) {
          if (trechoAtual.length === 0) trechoAtual.push(pontos[i - 1])
          trechoAtual.push(pontos[i])
        } else if (trechoAtual.length > 0) {
          trechos.push(trechoAtual)
          trechoAtual = []
        }
      }
      if (trechoAtual.length > 0) trechos.push(trechoAtual)

      for (const trecho of trechos) {
        new maps.Polyline({
          path: trecho.map((p) => ({ lat: p.lat, lng: p.lng })),
          map,
          strokeColor: '#047857',
          strokeWeight: 4,
          strokeOpacity: 0.8,
        })
      }

      if (trechos.length === 0) {
        // Nenhum segmento passou no filtro de "rodando" (não deveria
        // acontecer pra uma placa que já apareceu na lista, mas cobre o
        // caso defensivamente) — mostra os pontos como marcadores simples.
        for (const p of pontos) new maps.Marker({ position: { lat: p.lat, lng: p.lng }, map })
      }
    })
    return () => {
      cancelado = true
    }
  }, [pontos])

  if (erro) return <p className="p-3 text-xs text-red-700">{erro}</p>
  if (!pontos) return <p className="p-3 text-xs text-slate-500">Carregando trajeto…</p>
  if (pontos.length === 0) return <p className="p-3 text-xs text-slate-500">Sem posições de GPS para este trecho.</p>
  return <div ref={mapRef} className="h-80 w-full rounded-lg border border-slate-200" />
}
```

- [ ] **Step 2: Adicionar `kmEstimado` na interface local**

Em `RastreamentoFrota.tsx:111-122`, adicione `kmEstimado: number` logo abaixo de `horasRodando: number` na interface `NoiteRodandoInfo`.

- [ ] **Step 3: Importar o novo componente**

No topo de `RastreamentoFrota.tsx`, junto dos outros imports de componentes locais (perto da linha 5, `import { MapaFrota } from './MapaFrota'`):

```ts
import { TrechoMadrugadaMapa } from './TrechoMadrugadaMapa'
```

- [ ] **Step 4: Adicionar a coluna "KM estimado" e o `renderExpanded`**

Em `RastreamentoFrota.tsx`, dentro do `<SortableTable>` da aba `noite-rodando` (linhas ~1092-1117), adicione a coluna logo depois de `horasRodando` (linha 1111):

```tsx
{ key: 'kmEstimado', label: 'KM estimado', align: 'right', sortValue: (r) => r.kmEstimado, render: (r) => `${r.kmEstimado.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` },
```

E adicione a prop `renderExpanded` no `<SortableTable>` (depois de `columns={[...]}`, antes do `/>` de fechamento):

```tsx
renderExpanded={(r) => <TrechoMadrugadaMapa placa={r.placa} noite={r.noite} />}
```

- [ ] **Step 5: Checar tipos**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: sem erro.

- [ ] **Step 6: Verificar no navegador**

Com o dev server rodando, logado, abra `/dashboard/fase1/mapa` (ou a rota correta da aba Rastreamento), vá na aba "Rodando à noite", confirme a coluna "KM estimado" aparece, clique pra expandir uma linha real e confirme que o mapa carrega e desenha uma linha verde sobre uma rota plausível (compare visualmente com o Google Maps normal se a rota faz sentido geograficamente).

- [ ] **Step 7: Commit**

```bash
git add src/components/fase1/TrechoMadrugadaMapa.tsx src/components/fase1/RastreamentoFrota.tsx
git commit -m "feat: mapa do trecho rodado de madrugada + coluna KM estimado"
```

---

## Task 5: Monitoramento de 5 min dentro do cron existente

**Files:**
- Modify: `src/app/api/cron/sync/route.ts`
- Create: `src/lib/fase1/monitoramento-madrugada.ts`

**Interfaces:**
- Consumes: `classificarSegmentoRodando` (Task 1), `buscarPosicaoIndividual` (`@/lib/sync/omnilink-manual`, já existe), `horaBrasil` (`@/lib/horario-brasil`, já existe — versão sem argumento, hora atual).
- Produces: `monitorarMadrugada(): Promise<{ dentroDaJanela: boolean; placasMonitoradas: string[] }>` — chamada pelo cron a cada execução.

- [ ] **Step 1: Escrever o arquivo `monitoramento-madrugada.ts`**

```ts
import { prisma } from '@/lib/prisma'
import { horaBrasil } from '@/lib/horario-brasil'
import { classificarSegmentoRodando } from './disponibilidade'
import { buscarPosicaoIndividual } from '@/lib/sync/omnilink-manual'

const JANELA_INICIO_HORA = 19
const JANELA_FIM_HORA = 4

function dentroDaJanelaDeMadrugada(hora: number): boolean {
  return hora >= JANELA_INICIO_HORA || hora < JANELA_FIM_HORA
}

/**
 * Monitoramento de madrugada — pedido do usuário 2026-09-23: "quando o
 * sistema identificar movimento durante a madrugada deve passar a
 * monitorar a cada 5 minutos". Piggyback no cron de 5 em 5 min já
 * existente (`/api/cron/sync`) — fora da janela 19h-04h (horário de
 * Brasília), sai antes de fazer qualquer query (custo zero durante o dia).
 * Sem flag persistente: a cada execução, recalcula do zero quem está
 * rodando AGORA a partir das 2 posições mais recentes de cada placa — se
 * uma placa parou, ela simplesmente não entra na lista naquele ciclo,
 * sem precisar de nenhuma limpeza de estado.
 */
export async function monitorarMadrugada(): Promise<{ dentroDaJanela: boolean; placasMonitoradas: string[] }> {
  const hora = horaBrasil()
  if (!dentroDaJanelaDeMadrugada(hora)) return { dentroDaJanela: false, placasMonitoradas: [] }

  const umaHoraAtras = new Date(Date.now() - 60 * 60_000)
  const posicoesRecentes = await prisma.vehiclePosition.findMany({
    where: { capturedAt: { gte: umaHoraAtras } },
    select: { placa: true, capturedAt: true, speedKmh: true, latitude: true, longitude: true },
    orderBy: { capturedAt: 'asc' },
  })

  const porPlaca = new Map<string, typeof posicoesRecentes>()
  for (const p of posicoesRecentes) {
    const lista = porPlaca.get(p.placa) ?? []
    lista.push(p)
    porPlaca.set(p.placa, lista)
  }

  const placasRodandoAgora: string[] = []
  for (const [placa, lista] of porPlaca.entries()) {
    if (lista.length < 2) continue
    const anterior = lista[lista.length - 2]
    const atual = lista[lista.length - 1]
    const rodando = classificarSegmentoRodando(
      { capturedAt: anterior.capturedAt.toISOString(), speedKmh: anterior.speedKmh, lat: anterior.latitude, lng: anterior.longitude },
      { capturedAt: atual.capturedAt.toISOString(), speedKmh: atual.speedKmh, lat: atual.latitude, lng: atual.longitude },
    )
    if (rodando) placasRodandoAgora.push(placa)
  }

  for (const placa of placasRodandoAgora) {
    try {
      await buscarPosicaoIndividual(placa)
    } catch (err) {
      console.error(`[monitoramento-madrugada] falha ao buscar posição extra de ${placa}`, err)
    }
  }

  return { dentroDaJanela: true, placasMonitoradas: placasRodandoAgora }
}
```

- [ ] **Step 2: Integrar no cron**

Em `src/app/api/cron/sync/route.ts`, adicione o import:

```ts
import { monitorarMadrugada } from '@/lib/fase1/monitoramento-madrugada'
```

E dentro do `GET`, depois de `const results = await runDueSchedules()`:

```ts
const madrugada = await monitorarMadrugada()
```

E inclua no `return` final:

```ts
return NextResponse.json({ ran: results.length, results, usageEventsApagados, madrugada })
```

- [ ] **Step 3: Checar tipos**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: sem erro.

- [ ] **Step 4: Verificar a função isoladamente com dado real local**

Crie `scripts/_tmp-verify-monitoramento.ts`:

```ts
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { monitorarMadrugada } from '../src/lib/fase1/monitoramento-madrugada'

async function main() {
  const resultado = await monitorarMadrugada()
  console.log(resultado)
}
main().finally(() => prisma.$disconnect())
```

Rode: `npx tsx scripts/_tmp-verify-monitoramento.ts`

Expected: se rodar durante o dia (fora de 19h-04h no horário de Brasília), `{ dentroDaJanela: false, placasMonitoradas: [] }`. Se rodar durante a madrugada de verdade (ou você ajustar `JANELA_INICIO_HORA`/`JANELA_FIM_HORA` temporariamente pra testar, revertendo depois), confira no log do terminal que `buscarPosicaoIndividual` foi chamada só pras placas que já apareciam como "rodando" na tabela da Task 2/3 pro dia/hora atual.

Apague o script depois: `rm scripts/_tmp-verify-monitoramento.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/fase1/monitoramento-madrugada.ts src/app/api/cron/sync/route.ts
git commit -m "feat: monitoramento de 5 min para placas rodando durante a madrugada"
```

---

## Deploy

Depois de todas as tasks: build local (`docker build`), transferir via SSH (`docker save | ssh ... docker load`, chave `~/.ssh/paineis_migracao`, host `operador@10.10.2.60`), `docker compose up -d app`, `docker compose run --rm migrate npx prisma migrate deploy` (não deve haver migration nova nesta feature — sem mudança de schema), verificar disco (`df -h /`, seguro abaixo de ~90%) antes do `docker load`. Mesmo runbook já seguido nesta sessão.
