# Relatório do Motorista — design

Data: 2026-09-25 · Pedido do usuário (Fase 1 / Transporte) · Status: aguardando revisão

## Objetivo

Usar o rastreamento (Omnilink) e as viagens (notas do TOTVS) para encontrar
possíveis irregularidades ou práticas do motorista que não aparecem a olho nu,
para confrontar, tratar e melhorar. Pedido do usuário:

> "eu quero que a IA nos ajude a encontrar possíveis irregularidades/práticas
> que possam não ser perceptíveis entre nós a olho, para confrontarmos e
> tratarmos e melhorar"

O relatório é liberado com os dados que já estiverem no sistema. O histórico de
posições começa em 01/09/2026 (backfill em produção, commit `05c3bb9`).

## Decisões já tomadas com o usuário

| Tema | Decisão |
|---|---|
| Quem dirigia | O motorista da **última nota** emitida para a placa, até sair a próxima nota. É a regra atual de `motoristasAteFimDaNoite`/`agruparConsumoPorMotorista`. |
| Verificações | As 10 (ver seção A.2), todas com limites como parâmetros. |
| Desvio de rota | Por **caminho aprendido**: o cadastro de rotas ganha a opção "aprender caminho"; depois de N viagens o sistema propõe o caminho e ele só passa a valer depois de **aprovação manual** no mapa. A tolerância é de 1 km (parâmetro). |
| Login do motorista | **CPF + senha**. |
| PDF | Botão que gera o PDF do relatório para enviar ao motorista. |
| Retenção | A limpeza de 60 dias não apaga as posições ligadas a ocorrências. As ocorrências (incluindo desvios) são mantidas sem prazo. Já em produção para alerta de velocidade (±30 min). |
| Escopo | Todas as partes A–E aprovadas. |

## Entrega em partes

Cada parte é entregue e publicada separadamente, nesta ordem:
**A → B → C → D → E**. A parte A não depende das demais.
A B substitui a checagem de desvio simples da A. A C e a D consomem a A.
A E consome a A.

---

## A. Motor de ocorrências + aba "Motorista"

### A.1 Ocorrências gravadas

O relatório precisa sustentar um confronto, e a limpeza de 60 dias precisa
saber o que preservar. Por isso as ocorrências são **gravadas**, e não
calculadas só na hora de abrir a tela.

Tabela nova `driver_occurrences` (schema do app, com `holding_id`,
`company_id` e `branch_id` nullable, conforme a diretiva 0009):

| Coluna | Uso |
|---|---|
| `id` | uuid |
| `type` | enum `DriverOccurrenceType` (ver A.2) |
| `placa` | placa do veículo |
| `motorista_nome` | nome normalizado da nota (regra "última nota"); null quando não houver nota anterior |
| `driver_id` | FK para `drivers` (parte D), nullable até a D existir |
| `started_at` / `ended_at` | intervalo do fato |
| `latitude` / `longitude` | ponto representativo (para o mapa) |
| `location_id` | local cadastrado envolvido, quando houver |
| `metrics` | Json com os números do fato (minutos, km, velocidade máxima, % de consumo...) |
| `review_status` | enum `PENDENTE` / `CONFIRMADA` / `JUSTIFICADA` |
| `review_note`, `reviewed_by_id`, `reviewed_at` | tratativa do gestor |
| `created_at`, `updated_at` | |

Chave de idempotência: `@@unique([type, placa, started_at])`. O detector pode
rodar de novo sobre o mesmo período sem duplicar nada, e o upsert **não
sobrescreve** `review_*`.

**Detector** (`src/lib/fase1/ocorrencias/`, um arquivo por verificação, cada
um uma função pura `(posições, viagens, locais, parâmetros) → Ocorrencia[]`):

- **Cron:** chamado pelo `/api/cron/sync` uma vez por hora, sobre as últimas
  26 h, no tempo que sobrar da execução, depois do backfill.
- **Carga inicial:** um script único roda o detector de 01/09 até hoje.
- A atribuição a motorista (`motorista_nome`) é feita no próprio detector.

**Retenção:** `purgeOldVehiclePositions` passa a preservar também as posições
de `placa` dentro de `[started_at - 30 min, ended_at + 30 min]` de qualquer
`driver_occurrences`. Nada em `driver_occurrences` é apagado.

### A.2 As 10 verificações

A ignição vem de `vehicle_positions.ignicao_ligada`, gravada desde
2026-09-25. As posições antigas ficam com null até o backfill buscá-las de
novo. Parado = velocidade 0 ou deslocamento < 50 m entre posições
consecutivas.

| # | `type` | Regra | Parâmetros (padrão) |
|---|---|---|---|
| 1 | `MARCHA_LENTA` | Parado com ignição ligada de forma contínua por ≥ X min | `OCOR_MARCHA_LENTA_MIN` (15) |
| 2 | `RODANDO_MADRUGADA` | Tempo em movimento dentro da janela noturna, por noite e por placa. O tempo parado com ignição ligada vai em `metrics` como item separado e não entra em "rodando" (dúvida do usuário). Reaproveita `segmentosRodandoGps`/`kmPercorridoGps`. | `MADRUGADA_INICIO_H` (19), `MADRUGADA_FIM_H` (4), `OCOR_MADRUGADA_MIN_MIN` (15) |
| 3 | `PERNOITE` | Parado entre as horas da janela de pernoite, dentro de um raio. Registra o local cadastrado (se houver) ou o endereço da Omnilink. O relatório agrupa por local e mostra quantas vezes. | `PERNOITE_INICIO_H` (21), `PERNOITE_FIM_H` (5), `PERNOITE_RAIO_M` (300) |
| 4 | `DESVIO_ROTA` | **Até a parte B:** km do GPS contra o km da rota, com diferença ≥ X% (lógica atual de `achadosDesvioRotaGps`). **Depois da B:** trecho a mais de Y km do caminho aprovado (ver B.3). | `OCOR_DESVIO_KM_PCT` (30), `DESVIO_ROTA_KM` (1) |
| 5 | `EXCESSO_VELOCIDADE` | Espelha cada `speed_alerts` como ocorrência. Frequência por 1.000 km no relatório. | `VELOCIDADE_MAXIMA_KMH` (existente, 100) |
| 6 | `PARADA_NAO_PREVISTA` | Durante a viagem, parado ≥ X min fora de local cadastrado (base, cliente, posto, residência) | `OCOR_PARADA_LONGA_MIN` (30) |
| 7 | `RODANDO_SEM_VIAGEM` | Deslocamento ≥ X km fora de viagem (ver "viagem" abaixo) | `OCOR_SEM_VIAGEM_KM` (5) |
| 8 | `SEM_SINAL_VIAGEM` | Intervalo sem posição ≥ X min durante a viagem, com o veículo em lugar diferente quando o sinal volta (distância > 1 km) | `OCOR_SEM_SINAL_MIN` (30) |
| 9 | `PORTA_FORA_LOCAL` | Evento "Abertura de Porta" (em `status`) fora do raio de um local cadastrado | — (usa o raio do `Location`) |
| 10 | `CONSUMO_ANORMAL` | Km/l do abastecimento abaixo da média da placa (ou da frota, se a placa tiver poucos dados) em ≥ X% | `OCOR_CONSUMO_DESVIO_PCT` (20) |

Os parâmetros ficam em `parameters` (tela de Parâmetros existente). O
detector usa o padrão quando o parâmetro ainda não foi cadastrado, igual a
`getLimiteVelocidade`.

**Viagem** (itens 4, 6, 7 e 8): começa na `DATASAIDA` da nota, que é
dia sem hora. A partir da primeira posição daquele dia fora do geofence de
origem, a viagem termina na primeira chegada de volta à origem
(`LocationVisit`) ou na nota seguinte da placa, o que vier primeiro, com
teto de `RETORNO_PREVISTO` + 1 dia.

### A.3 Aba "Motorista" no Transporte

Nova aba `motorista-relatorio` em `Fase1Dashboard.tsx` (o mesmo padrão de
aba por `useState`).

- **Filtros:** motorista (nomes normalizados das notas; na parte D, os
  cadastrados) e período (padrão: últimos 30 dias).
- **Cards:**
  - viagens;
  - km (GPS);
  - horas rodando de madrugada (total e média por noite);
  - marcha lenta (total);
  - pernoites;
  - excessos de velocidade (quantidade e frequência por 1.000 km);
  - desvios;
  - demais ocorrências.
- **Seções:** uma por tipo, com tabela `SortableTable` (data, placa, local,
  métricas, status da tratativa). Uma linha expandida mostra o trecho no mapa,
  reaproveitando `TrechoMadrugadaMapa` para trechos. A seção de pernoite
  agrupa por local (quantas vezes e se é o local mais frequente).
- **Tratativa:** o gestor (quem pode editar a fase1) marca a ocorrência como
  confirmada ou justificada, com observação.
- **API:** `GET /api/fase1/motorista/relatorio?motorista=&de=&ate=`, que
  agrega as ocorrências e as viagens, e
  `PATCH /api/fase1/motorista/ocorrencias/[id]` para a tratativa
  (allow-list: `reviewStatus`, `reviewNote`).
- **Permissão:** `requireModuleViewer('fase1')`, e editor para a tratativa.

## B. Aprendizado de rotas

### B.1 Dados

- `routes.learn_path` (Boolean, padrão false): opção "aprender caminho" no
  cadastro de rotas.
- Tabela nova `route_paths`:

  | Coluna | Uso |
  |---|---|
  | `route_id` | rota |
  | `status` | `PROPOSTO` / `APROVADO` / `REJEITADO` |
  | `cells` | Json com a lista de células do corredor, `{lat, lng, freq}` |
  | `trips_used` | quantidade de viagens usadas |
  | `approved_by_id`, `approved_at` | aprovação |
  | `created_at`, `updated_at` | |

  Só um `APROVADO` por rota vale. Aprovar um novo arquiva o anterior
  (`REJEITADO`).

- Tabela nova `route_path_trips`: `route_id`, `trip_key`, `excluded`
  (Boolean). É a lista de viagens usadas no aprendizado; o administrador pode
  excluir uma viagem atípica e reprocessar.

### B.2 Aprendizado

1. Para cada rota com `learn_path`, pega as viagens concluídas dessa
   origem→destino e o trecho de GPS entre sair do geofence de origem e entrar
   no de destino.
2. Discretiza cada trecho em células de ~200 m e conta em quantas viagens cada
   célula aparece.
3. O corredor são as células presentes em ≥ `ROTA_CORREDOR_FREQ_PCT` (50%) das
   viagens. Mais de uma estrada frequente entra no corredor.
4. Com ≥ `ROTA_APRENDIZADO_MIN_VIAGENS` (5) viagens, gera ou atualiza um
   `PROPOSTO`. Roda no cron, 1x/dia.

### B.3 Aprovação e desvio

- Tela da rota com mapa (Google Maps, como o resto da fase1): o corredor
  proposto sobre o aprovado atual e a lista de viagens usadas (excluir e
  reprocessar). Botões para aprovar ou rejeitar. Só administrador.
- **Desvio:** com o caminho aprovado, cada posição da viagem daquela rota é
  medida até a célula mais próxima do corredor. Duas ou mais posições
  consecutivas a mais de `DESVIO_ROTA_KM` (1) geram `DESVIO_ROTA`, com o
  trecho fora do corredor em `metrics` (km fora e duração).
- Rota sem caminho aprovado continua na regra de % de km (A.2 #4).

## C. PDF do relatório

- Página `/dashboard/fase1/motorista/imprimir?motorista=&de=&ate=`,
  preparada para impressão: cabeçalho com o logo, o motorista, o período e a
  data de emissão; os mesmos cards e seções da aba; e o resumo da IA se
  houver (parte E).
- Botão "Gerar PDF" na aba, que abre a página e chama `window.print()`
  ("Salvar como PDF"). É o mesmo padrão de `RelatorioDiaTab` (Fase 3). Não
  entra biblioteca nova.
- Estilo `@media print` / classes `print:` do Tailwind: A4 retrato, quebra de
  página por seção. Mapas viram imagem estática (Google Static Maps) na
  impressão.

## D. Cadastro de motorista + login por CPF

### D.1 Cadastro

- Tabela nova `drivers`:

  | Coluna | Uso |
  |---|---|
  | `id` | uuid |
  | `name` | nome |
  | `cpf` | único, só dígitos |
  | `chapa`, `cod_coligada` | vínculo com `rh_funcionarios`, opcional |
  | `invoice_names` | `String[]`: os nomes como aparecem nas notas, normalizados; um motorista pode ter grafias diferentes |
  | `active` | ativo |
  | `holding_id`, `company_id`, `branch_id` | multi-tenant |
  | `created_at`, `updated_at` | |

- Tela de cadastro, um `AdminResource` novo, "Motoristas":
  - Sugere os funcionários do RH cuja função contém "MOTORISTA" e os nomes
    das notas ainda sem vínculo.
  - O administrador informa o CPF.
  - O CPF **não** vem do RH: o dataset `rh_funcionarios` não traz CPF, e
    trazer o de 50 mil funcionários para o painel não se justifica (LGPD).
- O CPF aparece mascarado nas listagens e nas respostas de API
  (`***.***.***-12`).
- Com a D, o filtro da aba A.3 passa a listar os motoristas cadastrados.
  `driver_occurrences.driver_id` é preenchido pelo vínculo `invoice_names`.

### D.2 Usuário do motorista

- `users.driver_id` (único, nullable). Um usuário com `driver_id` é um
  **usuário motorista**.
- **Login:** o campo de login aceita e-mail ou CPF. Se a entrada tiver 11
  dígitos, o `authorize` busca o `driver` pelo CPF e o `user` ligado a ele. O
  rate-limit e a auditoria são os mesmos de hoje.
- O administrador cria o acesso a partir do cadastro do motorista, com senha
  inicial e `must_change_password = true`.
- **Escopo:** o usuário motorista só acessa `/motorista` (o próprio relatório,
  somente leitura, com as mesmas seções, o botão de PDF e as próprias viagens).
  As APIs de relatório forçam `motorista = driver da sessão`, ignorando o
  parâmetro. O proxy e a navegação redirecionam qualquer outra rota. Sem
  acesso a módulo nenhum (`UserModuleAccess` vazio).
- A tratativa do gestor (`review_note`) **não** aparece para o motorista. Ele
  vê o fato e o status.

## E. Resumo por IA

- Botão "Analisar com IA" na aba A.3. O servidor monta um JSON agregado das
  ocorrências do período: tipos, quantidades, horários, locais recorrentes e
  a comparação com a média da frota.
- **Não** envia CPF. O nome do motorista é trocado por "o motorista".
- Chama a API da Anthropic, reaproveitando a configuração de
  `src/lib/ocr/anthropic.ts` (chave e modelo), com o pedido de apontar
  padrões e sugerir pontos para conversar, sem acusar.
- O resultado fica em `driver_ai_summaries` (`motorista`, `de`, `ate`,
  `text`, `model`, `created_at`) para não gerar de novo a cada vez. Entra no
  PDF se existir.

## Erros e casos de borda

- **Placa sem nota antes do fato:** a ocorrência é gravada com
  `motorista_nome = null` e aparece numa seção "sem motorista identificado"
  da visão por placa. Não é atribuída a ninguém.
- **Posição sem ignição (null):** marcha lenta e madrugada caem na regra
  atual (velocidade/deslocamento). Esses casos são marcados como "sem dado de
  ignição" em `metrics`.
- **Lacuna de dado da Omnilink** (backfill incompleto ou `janelas_com_erro`):
  o relatório mostra um aviso de cobertura no período ("X% das horas com
  posição").
- **Motorista em férias** (`driver_vacations`): uma ocorrência atribuída a
  ele nesse período recebe a marca "motorista em férias — conferir
  atribuição".

## Testes

- Detectores (A.2) e aprendizado (B.2) são funções puras, testadas com
  cenários fixos. Casos cobertos: parado com ignição ligada em 14 e 16 min;
  noite com e sem movimento; pernoite em local cadastrado e não cadastrado;
  lacuna de sinal com e sem deslocamento; corredor com duas estradas.
- Validação com dado real no banco de dev para uma placa e uma semana,
  comparando com o mapa.
- Playwright: a aba abre, o filtro funciona, a página de impressão
  renderiza, e o login do motorista por CPF só enxerga `/motorista`.
- Antes de cada entrega: lint, `tsc --noEmit` e build.

## Fora do escopo desta versão

- O motorista escrever justificativa no sistema: ele só lê; o gestor trata.
- Envio automático do PDF (e-mail ou WhatsApp): o gestor baixa e envia.
- App mobile específico do motorista: a página `/motorista` é responsiva.
