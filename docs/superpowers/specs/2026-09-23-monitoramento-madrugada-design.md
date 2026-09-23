# Monitoramento de madrugada com cadência dinâmica + detalhe com mapa — Design

Data: 2026-09-23
Escopo: sub-projeto 1 de 3 pedidos de rastreamento (Fase 1 — Transporte
Rodoviário). Os outros dois ("forçar busca na Omnilink" na tela de mapa, e
API externa placa→modelo de equipamento) são sub-projetos separados, cada
um com seu próprio ciclo depois deste.

## Contexto e motivação

Pedido do usuário: quando o sistema identificar uma placa em movimento
durante a madrugada, passar a monitorar essa placa a cada 5 minutos
(cadência maior que o sync normal da frota). No painel, precisa de uma
opção de detalhar o trecho rodado com um mapa mostrando uma linha entre as
posições que demonstrem movimento real — avaliando se o veículo não está
parado e a diferença é só imprecisão de GPS. Além de horas rodando,
adicionar uma estimativa de KM entre início e fim, para identificar se não
foi apenas um "pós-chave" (ignição ligada sem rodar de verdade).

**O que já existe (investigado antes deste design):**
- Detecção de "rodando à noite" já implementada: `src/app/api/fase1/rastreamento/noite-rodando/route.ts`
  — agrupa `VehiclePosition` por placa×noite (janela 19h-04h Brasília) e
  calcula `horasRodandoGps()` (`src/lib/fase1/disponibilidade.ts:52`).
- Heurística de ruído de GPS já pronta dentro de `horasRodandoGps`:
  limiar de velocidade 5 km/h (`LIMIAR_VELOCIDADE_RODANDO_KMH`), gap
  máximo de 30 min entre posições consecutivas para contar como
  "rodando contínuo" (`GAP_MAXIMO_MINUTOS`), fallback por distância
  haversine quando a velocidade vem `null` do rastreador, descartando
  saltos de GPS implausíveis acima de 5 km (`SALTO_GPS_MAXIMO_KM`).
  **Mas ela só devolve o total de horas — não expõe QUAIS segmentos
  (pares de posições consecutivas) foram classificados como
  "rodando"**, que é o que o mapa precisa para desenhar a linha certa.
- Estimativa de KM já existe pronta: `kmPercorridoGps()`
  (`src/lib/fase1/critica.ts:344`) — soma haversine entre posições
  consecutivas, descartando saltos > `saltoMaximoKm`. Não usa o limiar
  de velocidade (soma qualquer deslocamento plausível), o que é
  aceitável para uma *estimativa* de "andou ou não andou de verdade" —
  mesmo padrão já usado em outro achado do sistema.
- Busca sob demanda de UMA placa já existe e é reutilizável:
  `buscarPosicaoIndividual(placa)` (`src/lib/sync/omnilink-manual.ts`) —
  busca janela de 6h na Omnilink, grava em `VehiclePosition` via
  `processOmnilinkPosicoes`, registra em `OmnilinkSyncPlaca`. Já é o que
  o botão manual da aba "sem-comunicação" usa hoje.
- Cron de produção: `/api/cron/sync` roda a cada 5 min (confirmado no
  crontab do servidor), chama `runDueSchedules()` — cada dataset só
  sincroniza quando seu próprio `nextRunAt` vence (frota inteira do
  Omnilink hoje a cada 10 min). **Não existe nenhum mecanismo de
  cadência por placa individual** — seria um mecanismo novo.
- Sem nenhum desenho de polyline/trajeto no projeto hoje (só polígono
  de área em `LocationShapeMap.tsx`) — mas `loadGoogleMaps()`
  (`MapaFrota.tsx`) já carrega a API do Google Maps, e
  `google.maps.Polyline` é nativo dela.

**Decisões já tomadas com o usuário:**
- Monitoramento de 5 min vale só para a placa detectada em movimento
  (não muda o intervalo da frota inteira).
- Encerra sozinho quando a placa parar de se mover de novo — sem flag
  persistente, recalculado a cada execução do cron a partir da posição
  mais recente.
- Mecanismo: piggyback no `/api/cron/sync` já existente (mesmo padrão
  já usado ali para a limpeza de `UsageEvent` às 3h) — fora da janela
  de madrugada, o custo extra é zero (sai antes de fazer qualquer
  query).
- Mapa do trecho: acessado expandindo a linha da tabela "Rodando à
  noite" (mesmo padrão de outras tabelas do sistema,
  `SortableTable`/`renderExpanded`).
- A linha no mapa mostra só os segmentos já classificados como
  "movimento real" pela heurística existente (não os pontos brutos) —
  mesmo cálculo que já gera o número de horas/KM da tabela, sem
  divergência entre o que a tabela diz e o que o mapa desenha.

## Parte A — expor os segmentos classificados (refactor pequeno)

**Achado:** `horasRodandoGps` (disponibilidade.ts:52) já classifica cada
par de posições consecutivas como "rodando" ou não, mas descarta essa
informação por segmento — só acumula o total em minutos. Duplicar a
lógica de classificação numa segunda função para o mapa arriscaria as
duas divergirem com o tempo (ex.: alguém ajusta o limiar num lugar e
esquece do outro).

**Fix:** extrair a classificação de UM segmento para uma função pura
nova, `classificarSegmentoRodando(anterior, atual): boolean`, e fazer
`horasRodandoGps` chamá-la internamente (mesmo comportamento, zero
mudança de resultado). Adicionar `segmentosRodandoGps(posicoesOrdenadas)`,
que percorre os mesmos pares e devolve:

```ts
export interface SegmentoGps {
  de: PosicaoSimples
  para: PosicaoSimples
  rodando: boolean
}
export function segmentosRodandoGps(posicoesOrdenadas: PosicaoSimples[]): SegmentoGps[]
```

Ambas as funções (`horasRodandoGps` e `segmentosRodandoGps`) usam a
mesma `classificarSegmentoRodando` por baixo — garante que a tabela
("X horas rodando") e o mapa (linha desenhada) nunca divirjam.

## Parte B — KM estimado na tabela + endpoint de detalhe

**`noite-rodando/route.ts`:** adicionar `kmEstimado: number` em cada
item de `rodandoNoite`, calculado com `kmPercorridoGps(grupo)` sobre as
mesmas posições já buscadas nesse request (sem query nova, sem custo
extra relevante).

**Novo endpoint** `GET /api/fase1/rastreamento/noite-rodando/detalhe?placa=X&noite=Y`:
- Mesmo critério de janela (`classificarNoite`, 19h-04h) já usado na
  rota principal, mas restrito a uma placa/noite específica.
- Busca as `VehiclePosition` da janela, roda `segmentosRodandoGps`, e
  converte a lista de segmentos (pares `de`/`para`) para uma lista
  "achatada" de pontos, onde cada ponto carrega se o segmento que
  TERMINA nele foi classificado como rodando (o primeiro ponto da
  madrugada não tem segmento anterior, então `rodando: false` por
  padrão — não desenha nada sozinho, só marca o início de uma linha
  quando o próximo ponto vier com `rodando: true`):
```ts
{
  pontos: { lat: number; lng: number; capturedAt: string; speedKmh: number | null; rodando: boolean }[]
}
```
Front desenha uma nova `Polyline` toda vez que `rodando` muda de
`true` para `false` ou vice-versa (cada trecho contínuo de `rodando:
true`, incluindo o ponto imediatamente anterior a ele, vira uma linha).

## Parte C — tabela + mapa no front (`RastreamentoFrota.tsx`)

- Coluna nova "KM estimado" na tabela "Rodando à noite", ao lado de
  "Horas rodando".
- Linha expansível (`renderExpanded`, mesmo padrão do resto do
  sistema): ao expandir pela primeira vez, busca
  `/noite-rodando/detalhe` (lazy — só quando o usuário realmente abre
  aquela linha, não teria sentido carregar posições de toda madrugada
  de toda placa de cara).
- Dentro do expandido: um mapa (Google Maps via `loadGoogleMaps()`,
  mesmo padrão de `MapaFrota.tsx`) desenhando uma ou mais
  `google.maps.Polyline` — uma linha nova a cada trecho contínuo
  classificado como `rodando: true` (se o caminhão parou no meio e
  voltou a andar, aparecem 2+ linhas separadas — é o comportamento
  correto, não uma falha).
- Estado de carregamento/erro simples (mesmo padrão de `erroAtualizacao`
  já usado na aba "sem-comunicação").

## Parte D — monitoramento de 5 min (`/api/cron/sync`)

Dentro do handler existente, ANTES ou DEPOIS de `runDueSchedules()`
(ordem não importa, são independentes):

1. Calcular a hora atual em Brasília (`horaBrasilDe`, já usado em
   `noite-rodando`) — se estiver fora de 19h-04h, pular todo o resto
   (nenhuma query extra fora da janela).
2. Buscar a posição mais recente de cada placa conhecida (uma query:
   `VehiclePosition` agrupado por placa, `capturedAt` mais recente —
   ou reaproveitar uma consulta parecida se já existir um helper assim
   em `src/lib/fase1/`).
3. Para cada placa, pegar as 2 posições mais recentes e aplicar
   `classificarSegmentoRodando` (Parte A) — se `rodando === true`,
   chamar `buscarPosicaoIndividual(placa)` (já existe, já grava tudo
   sozinho: `VehiclePosition` + `OmnilinkSyncPlaca`).
4. Incluir um resumo no retorno do endpoint (ex.
   `monitoramentoMadrugada: { placasMonitoradas: string[] }`) — mesmo
   espírito do `ran`/`results` que o endpoint já devolve para o sync
   normal, útil para depuração via `cron.log`.

**Nota de custo:** cada placa "rodando" nessa janela dispara uma chamada
real à API da Omnilink a cada tick do cron (5 min) — mesmo padrão de
custo que o botão manual já existente, só que automático. Não há
dado hoje sobre quantas placas tipicamente rodam de madrugada
simultaneamente; se isso crescer a ponto de preocupar (rate limit da
Omnilink), é um ajuste futuro (ex. um teto de placas monitoradas por
tick), não um risco conhecido agora.

## Testes

Projeto não tem suíte automatizada (verificação sempre manual com dado
real, ver convenção do resto do código). Validar:
- `classificarSegmentoRodando`/`segmentosRodandoGps` contra um caso real
  já visto no sistema (ex. a placa TAK5C12 citada no comentário de
  `disponibilidade.ts`, ou outra madrugada real do ambiente local).
- Endpoint de detalhe retornando segmentos coerentes com o
  `horasRodando`/`kmEstimado` já mostrados na tabela.
- Mapa renderizando a(s) linha(s) esperada(s) para pelo menos uma
  placa/noite real, visualmente conferido no navegador.
- Monitoramento de 5 min: forçar o relógio/hora de teste (ou testar
  numa madrugada real) e conferir no `cron.log`/`OmnilinkSyncPlaca` que
  a chamada extra realmente disparou só para a placa em movimento.
