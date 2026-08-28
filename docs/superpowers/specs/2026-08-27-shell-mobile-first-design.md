# Design system + shell mobile-first — Sub-projeto 1

Data: 2026-08-27
Escopo: shell do painel (header, navegação, home `/dashboard`) e um kit
mínimo de componentes reutilizáveis. **Não inclui** retrofit dos
dashboards de módulo (Fase 1, Fase 3, Fase 5, RH, Abastecimento) —
cada um vira uma spec própria depois, reaproveitando o que é definido
aqui.

## Contexto e motivação

O painel (`C:\local\paineis`, Next.js 16 + Tailwind v4) substitui
gradualmente o Power BI para o Grupo Plantar. O shell atual
(`src/app/dashboard/layout.tsx` + `MobileNav.tsx`) já segue o padrão de
layout do grupo (header fixo + conteúdo rolável via flexbox puro, sem
`position: fixed/sticky` — ver `layout-pagina` no vault de padrões) e
já tem um menu hambúrguer mobile (adicionado 2026-08-21). Visualmente,
porém, é genérico: sem tokens de tema definidos (`globals.css` só tem
`--background`/`--foreground`), cores emerald/slate padrão do Tailwind,
sem kit de componentes compartilhado — cada tela reimplementa card,
badge, etc.

**Quem usa e como:** uso mobile é de **gestor consultando rapidamente**
(checar números entre uma reunião e outra), não uso operacional
extenso — formulários e cadastro pesado continuam sendo trabalho de
desktop. Um app separado para motorista, com visualizações próprias,
está previsto para depois e fica fora deste escopo.

**Decisões já tomadas com o usuário:**
- Verde continua como cor de marca (Grupo Plantar); refinar tons e
  contraste, não trocar de paleta.
- Sem toggle manual de dark mode nesta rodada (mantém só
  `prefers-color-scheme`).
- A home (`/dashboard`) permanece deliberadamente leve — sem painel de
  alertas cross-módulo. Destaque de "principais problemas/agressores
  aos indicadores" é responsabilidade de cada módulo, nos retrofits
  seguintes (usando o componente `Callout` definido aqui).

## Componentes do design

### 1. Tokens de tema (`src/app/globals.css`)

Substituir os dois tokens soltos por uma escala em `@theme`:
- `--color-brand-{50,100,200,300,400,500,600,700,800,900}` — derivada
  do verde emerald atual, com contraste revisado (mínimo AA para texto
  sobre fundo claro/escuro).
- `--color-neutral-{50..900}` — substitui o uso solto de `slate-*`
  espalhado pelo código por uma escala nomeada, mesma progressão de
  tons do slate atual (não muda o visual de imediato, só nomeia).
- `--radius-sm/md/lg` e `--shadow-sm/md` — padroniza o que hoje é
  `rounded-xl`/sombra ad-hoc espalhados pelas telas.

Sem nova dependência — Tailwind v4 puro, mesmo mecanismo que já existe
em `globals.css`.

### 2. Kit de componentes (`src/components/shared/ui/`)

Primitivos sem estado complexo, cada um função pura + props tipadas:

| Componente | Uso |
|---|---|
| `Card` | Container base (substitui o `div` com classes repetidas em `page.tsx`/dashboards) |
| `SectionHeading` | Título de seção com hierarquia consistente |
| `StatTile` | Número + rótulo + variação opcional (ex. "▲ 4% vs mês anterior") |
| `Badge` | Status/fase (ex. "Ativo", "Não iniciado") |
| `Callout` | Info/aviso/erro — mesmo componente que os módulos vão reusar depois para destacar "agressores" |

Não inclui nada de Radix/headless-ui — sem formulário complexo ou
interação (dropdown, modal) neste escopo, então uma dependência nova
seria over-engineering.

### 3. Navegação

- **Desktop (`md:` e acima):** mantém a estrutura horizontal atual no
  header, só com os novos tokens/ícones (um ícone simples por módulo,
  inline SVG — `package.json` não tem biblioteca de ícones hoje, e uma
  dependência nova só para isso seria over-engineering).
- **Mobile (abaixo de `md`):** `MobileNav` (hambúrguer) é substituído
  por uma **tab bar fixa inferior**: até 4 módulos que o usuário tem
  acesso + um item "Mais" que abre um drawer com o restante (Cadastros,
  Fontes de Dados, Admin). Implementada como `shrink-0` na base de um
  flex column (mesma técnica do header fixo hoje — sem
  `position:fixed`), preservando o padrão de layout do grupo.
- Critério de quais 4 módulos aparecem na tab bar: os módulos aos
  quais o usuário logado tem acesso, na mesma ordem de prioridade que
  já existe em `links` no `layout.tsx` hoje (Início sempre primeiro).

### 4. Home (`/dashboard`)

`page.tsx` passa a montar os cards de módulo com `Card` + `StatTile`
(ícone por módulo, mantendo o link para o painel); banners de
ambiente/versão e as duas seções de admin (Fontes de dados, Últimas
sincronizações) usam os mesmos primitivos. Nenhuma mudança de dado ou
query — é reorganização visual da mesma informação que já existe.

## Fora de escopo (explicitamente)

- Retrofit de qualquer dashboard de módulo (Fase 1/3/5, RH,
  Abastecimento, Admin) — specs futuras.
- Dark mode manual.
- Painel de alertas/agressores cross-módulo na home.
- Qualquer visualização voltada ao futuro app do motorista.

## Testes / validação

Sem mudança de schema ou dado — validação é visual: `npm run dev`,
conferir header/tab-bar/home em viewport mobile real (375px) e
desktop, com um usuário ADMIN (vê todos os links) e um usuário com
acesso parcial (vê subconjunto), confirmando que a tab bar respeita o
mesmo controle de acesso que `layout.tsx` já aplica hoje.
