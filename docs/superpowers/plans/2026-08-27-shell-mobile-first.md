# Design system + shell mobile-first Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernizar o shell do painel (tokens de tema, kit de componentes reutilizável, navegação mobile) sem tocar nos dashboards de módulo.

**Architecture:** Tokens de cor/raio/sombra em `@theme` (Tailwind v4, CSS puro); um pequeno kit de primitivos React sem estado complexo em `src/components/shared/ui/`; a navegação mobile atual (hambúrguer) é substituída por uma tab bar fixa na base do layout flex (mesma técnica do header fixo já existente), com um drawer de overflow para os links que não cabem.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4 (config CSS-first, sem `tailwind.config.*`), TypeScript. Sem novas dependências.

**Spec:** `docs/superpowers/specs/2026-08-27-shell-mobile-first-design.md`

## Global Constraints

- Sem nova dependência (ícones em SVG inline; nada de Radix/lucide/headless-ui).
- Layout persistente (header, tab bar) via flexbox puro (`shrink-0`/`flex-1`), sem `position: fixed/sticky` — mesma técnica já usada em `layout.tsx`. Um drawer/overlay temporário (aberto por clique) pode usar `fixed inset-0` normalmente — isso é um modal, não faz parte do layout persistente de rolagem.
- Verde continua cor de marca; a escala `--color-brand-*` reaproveita os valores exatos do emerald padrão do Tailwind (mesmos tons já usados em `emerald-*` pelo resto do app) — evita duas paletas visualmente diferentes coexistindo enquanto os módulos ainda não foram retrofitados.
- Sem dark mode manual nesta rodada.
- Sem painel de alertas cross-módulo na home.
- **Fora de escopo:** qualquer arquivo dentro de `src/components/fase1|fase3|fase5|rh|abastecimento/` ou `src/app/dashboard/fase1|fase3|fase5|rh|abastecimento/`. Não tocar.
- Sem migration/mudança de schema Prisma — puramente visual/estrutural.
- **Este projeto não tem test runner configurado** (sem Jest/Vitest, `package.json` só tem `lint`/`build`). A verificação de cada task usa `npx tsc --noEmit` (typecheck) e, quando a task altera algo visível, uma checagem manual no navegador com passos explícitos — não "adicionar teste depois".

---

### Task 1: Tokens de tema

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: utilitários Tailwind `bg-brand-{50..900}`, `text-brand-*`, `border-brand-*` (mesma escala do `emerald-*` padrão), `bg-neutral-{50..900}` etc. (mesma escala do `slate-*` padrão), `rounded-(--radius-sm|md|lg)` via variáveis, `shadow-*` via variáveis. Usados pelas tasks 3, 5 e 6.

- [ ] **Step 1: Adicionar a escala de tokens no `@theme inline` de `globals.css`**

Abrir `src/app/globals.css` e substituir o bloco `@theme inline { ... }` (linhas 6-11 atualmente) por:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  --color-brand-50: #ecfdf5;
  --color-brand-100: #d1fae5;
  --color-brand-200: #a7f3d0;
  --color-brand-300: #6ee7b7;
  --color-brand-400: #34d399;
  --color-brand-500: #10b981;
  --color-brand-600: #059669;
  --color-brand-700: #047857;
  --color-brand-800: #065f46;
  --color-brand-900: #064e3b;

  --color-neutral-50: #f8fafc;
  --color-neutral-100: #f1f5f9;
  --color-neutral-200: #e2e8f0;
  --color-neutral-300: #cbd5e1;
  --color-neutral-400: #94a3b8;
  --color-neutral-500: #64748b;
  --color-neutral-600: #475569;
  --color-neutral-700: #334155;
  --color-neutral-800: #1e293b;
  --color-neutral-900: #0f172a;

  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;

  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
}
```

Não mexer no restante do arquivo (`:root`, dark mode media query, regra de impressão).

- [ ] **Step 2: Verificar que o build reconhece os novos tokens**

Run: `npm run build`
Expected: build termina sem erro (o Tailwind v4 valida a sintaxe do `@theme` no build; como nenhuma classe `brand-*`/`neutral-*` é usada ainda, o build só precisa compilar sem falhar).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: adiciona tokens de tema brand/neutral/radius/shadow"
```

---

### Task 2: Kit de ícones inline

**Files:**
- Create: `src/components/shared/ui/icons.tsx`

**Interfaces:**
- Produces: tipo `IconComponent = (props: React.SVGProps<SVGSVGElement>) => React.ReactElement`; componentes `HomeIcon`, `TruckIcon`, `PackageIcon`, `TransferIcon`, `UsersIcon`, `DropletIcon`, `DatabaseIcon`, `SettingsIcon`, `MoreIcon`, `CloseIcon`; função `moduleIcon(code: string): IconComponent`. Consumido pelas tasks 3 (tipo), 4, 5 e 6.

- [ ] **Step 1: Criar o arquivo de ícones**

```tsx
import type { SVGProps } from 'react'

export type IconComponent = (props: SVGProps<SVGSVGElement>) => React.ReactElement

function iconProps(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    ...props,
  }
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"
      />
    </svg>
  )
}

export function TruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v9M3 16h9m0 0h3m-3 0V10h4l3 3v3h-2M6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
      />
    </svg>
  )
}

export function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8 12 3 3 8m18 0-9 5m9-5v9l-9 5m0-9L3 8m9 5v9M3 8v9l9 5"
      />
    </svg>
  )
}

export function TransferIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h13m0 0-4-4m4 4-4 4M20 17H7m0 0 4 4m-4-4 4-4"
      />
    </svg>
  )
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 8v-1a4 4 0 0 0-3-3.87M15 5.13a3 3 0 0 1 0 5.75"
      />
    </svg>
  )
}

export function DropletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z"
      />
    </svg>
  )
}

export function DatabaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.5c4.142 0 7.5-1.12 7.5-2.5S16.142 1.5 12 1.5 4.5 2.62 4.5 4 7.858 6.5 12 6.5Zm7.5-2.5V19c0 1.38-3.358 2.5-7.5 2.5S4.5 20.38 4.5 19V4m15 6.5c0 1.38-3.358 2.5-7.5 2.5s-7.5-1.12-7.5-2.5"
      />
    </svg>
  )
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65 1.7 1.7 0 0 0 10.04 3.09V3a2 2 0 1 1 4 0v.09c0 .68.39 1.3 1.04 1.56.65.26 1.39.12 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.46.48-.6 1.22-.34 1.87.26.65.88 1.04 1.56 1.04H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.39-1.56 1.04Z"
      />
    </svg>
  )
}

export function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

const MODULE_ICON_MAP: Record<string, IconComponent> = {
  fase1: TruckIcon,
  fase3: PackageIcon,
  fase5: TransferIcon,
  rh: UsersIcon,
  abastecimento: DropletIcon,
  datasets: DatabaseIcon,
  admin: SettingsIcon,
}

export function moduleIcon(code: string): IconComponent {
  return MODULE_ICON_MAP[code] ?? HomeIcon
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `icons.tsx`.

- [ ] **Step 3: Verificação visual dos ícones**

Criar temporariamente uma rota de rascunho `src/app/icon-check/page.tsx`:

```tsx
import * as Icons from '@/components/shared/ui/icons'

export default function IconCheckPage() {
  const entries = Object.entries(Icons).filter(([, v]) => typeof v === 'function' && v.length <= 1)
  return (
    <div className="flex flex-wrap gap-6 p-6">
      {entries.map(([name, Icon]) => (
        <div key={name} className="flex flex-col items-center gap-1 text-xs">
          {/* @ts-expect-error - checagem visual manual, não faz parte do produto final */}
          <Icon className="h-8 w-8 text-brand-700" />
          {name}
        </div>
      ))}
    </div>
  )
}
```

Rodar `npm run dev`, abrir `http://localhost:3002/icon-check` e confirmar visualmente que os 10 ícones renderizam sem quebrar (nenhum `path` inválido, nenhum ícone em branco) e são distinguíveis um do outro. Ajustar o `d` de qualquer ícone que renderizar errado. Depois de confirmar, **apagar `src/app/icon-check/`** (rota só de verificação, não deve ir para o commit).

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/ui/icons.tsx
git commit -m "feat: adiciona kit de icones inline SVG do shell"
```

---

### Task 3: Primitivos de UI

**Files:**
- Create: `src/components/shared/ui/Card.tsx`
- Create: `src/components/shared/ui/SectionHeading.tsx`
- Create: `src/components/shared/ui/Badge.tsx`
- Create: `src/components/shared/ui/StatTile.tsx`
- Create: `src/components/shared/ui/Callout.tsx`

**Interfaces:**
- Consumes: `IconComponent` de `@/components/shared/ui/icons` (Task 2).
- Produces: `Card`, `SectionHeading`, `Badge` (prop `tone?: 'brand' | 'neutral' | 'warning' | 'danger'`), `StatTile` (props `label`, `value`, `hint?`, `icon?: IconComponent`), `Callout` (props `tone?: 'info' | 'warning' | 'danger'`, `title?`). Consumidos pela Task 6.

- [ ] **Step 1: Criar `Card.tsx`**

```tsx
import type { HTMLAttributes } from 'react'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-(--radius-lg) border border-neutral-200 bg-white shadow-(--shadow-sm) ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Criar `SectionHeading.tsx`**

```tsx
export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <h2 className={`text-lg font-semibold text-neutral-900 ${className ?? ''}`}>{children}</h2>
}
```

- [ ] **Step 3: Criar `Badge.tsx`**

```tsx
export type BadgeTone = 'brand' | 'neutral' | 'warning' | 'danger'

const TONE_CLASSES: Record<BadgeTone, string> = {
  brand: 'bg-brand-100 text-brand-800',
  neutral: 'bg-neutral-100 text-neutral-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}
```

- [ ] **Step 4: Criar `StatTile.tsx`**

```tsx
import type { IconComponent } from './icons'

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: IconComponent
}) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <Icon className="h-8 w-8 shrink-0 text-brand-600" />}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Criar `Callout.tsx`**

```tsx
export type CalloutTone = 'info' | 'warning' | 'danger'

const TONE_CLASSES: Record<CalloutTone, string> = {
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: CalloutTone
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-(--radius-md) border p-3 text-sm ${TONE_CLASSES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros nos 5 arquivos novos.

- [ ] **Step 7: Commit**

```bash
git add src/components/shared/ui/Card.tsx src/components/shared/ui/SectionHeading.tsx src/components/shared/ui/Badge.tsx src/components/shared/ui/StatTile.tsx src/components/shared/ui/Callout.tsx
git commit -m "feat: adiciona kit de primitivos de UI (Card, Badge, StatTile, Callout, SectionHeading)"
```

---

### Task 4: Tab bar mobile

**Files:**
- Create: `src/components/dashboard/MobileTabBar.tsx`

**Interfaces:**
- Consumes: `MoreIcon`, `CloseIcon`, `IconComponent` de `@/components/shared/ui/icons` (Task 2).
- Produces: `export interface NavLink { href: string; label: string; icon: IconComponent }`; `export function MobileTabBar({ links }: { links: NavLink[] })`. Consumido pela Task 5 (substitui `MobileNav`).

- [ ] **Step 1: Criar o componente**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { CloseIcon, MoreIcon, type IconComponent } from '@/components/shared/ui/icons'

export interface NavLink {
  href: string
  label: string
  icon: IconComponent
}

const MAX_TABS = 4

export function MobileTabBar({ links }: { links: NavLink[] }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const primary = links.slice(0, MAX_TABS)
  const overflow = links.slice(MAX_TABS)

  return (
    <>
      <nav
        className="flex shrink-0 border-t border-neutral-200 bg-white md:hidden"
        aria-label="Navegação principal"
      >
        {primary.map((l) => {
          const active = pathname === l.href
          const Icon = l.icon
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? 'text-brand-700' : 'text-neutral-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate px-1">{l.label}</span>
            </Link>
          )
        })}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Mais opções"
            aria-expanded={drawerOpen}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-neutral-500"
          >
            <MoreIcon className="h-5 w-5" />
            <span>Mais</span>
          </button>
        )}
      </nav>
      {drawerOpen && overflow.length > 0 && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end bg-black/30 md:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="rounded-t-(--radius-lg) border-t border-neutral-200 bg-white p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 py-2">
              <span className="text-sm font-semibold text-neutral-700">Mais opções</span>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Fechar">
                <CloseIcon className="h-5 w-5 text-neutral-500" />
              </button>
            </div>
            <nav className="flex flex-col gap-1 pb-2">
              {overflow.map((l) => {
                const Icon = l.icon
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 rounded-(--radius-md) px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <Icon className="h-5 w-5 text-neutral-500" />
                    {l.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em `MobileTabBar.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/MobileTabBar.tsx
git commit -m "feat: adiciona tab bar mobile fixa com drawer de overflow"
```

---

### Task 5: Atualizar o shell (`layout.tsx`), remover `MobileNav`

**Files:**
- Modify: `src/app/dashboard/layout.tsx`
- Delete: `src/components/dashboard/MobileNav.tsx`

**Interfaces:**
- Consumes: `moduleIcon`, `HomeIcon`, `IconComponent` (Task 2); `MobileTabBar`, `NavLink` (Task 4).

- [ ] **Step 1: Reescrever `layout.tsx`**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, isAdmin, canEditModule, hasModuleAccess } from '@/lib/authz'
import { LogoutButton } from '@/components/LogoutButton'
import { MobileTabBar, type NavLink } from '@/components/dashboard/MobileTabBar'
import { HomeIcon, moduleIcon } from '@/components/shared/ui/icons'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.mustChangePassword) redirect('/trocar-senha')

  const admin = isAdmin(user)
  const canSeeFase1 = hasModuleAccess(user, 'fase1')
  const canSeeFase3 = hasModuleAccess(user, 'fase3')
  const canSeeFase5 = hasModuleAccess(user, 'fase5')
  const canSeeRh = hasModuleAccess(user, 'rh')
  const canSeeAbastecimento = hasModuleAccess(user, 'abastecimento')
  const canSeeCadastros = admin || user.resourceCodes.length > 0 || canEditModule(user, 'fase3')

  const links: NavLink[] = [
    { href: '/dashboard', label: 'Início', icon: HomeIcon },
    ...(canSeeFase1 ? [{ href: '/dashboard/fase1', label: 'Transporte Rodoviário', icon: moduleIcon('fase1') }] : []),
    ...(canSeeFase1 ? [{ href: '/dashboard/fase1/mapa', label: 'Rastreamento', icon: moduleIcon('fase1') }] : []),
    ...(canSeeFase3 ? [{ href: '/dashboard/fase3', label: 'Venda Madeira Tratada', icon: moduleIcon('fase3') }] : []),
    ...(canSeeFase5 ? [{ href: '/dashboard/fase5', label: 'Transporte de Madeira', icon: moduleIcon('fase5') }] : []),
    ...(canSeeRh ? [{ href: '/dashboard/rh', label: 'Recursos Humanos', icon: moduleIcon('rh') }] : []),
    ...(canSeeAbastecimento
      ? [{ href: '/dashboard/abastecimento', label: 'Abastecimento', icon: moduleIcon('abastecimento') }]
      : []),
    ...(admin ? [{ href: '/dashboard/datasets', label: 'Fontes de Dados', icon: moduleIcon('datasets') }] : []),
    ...(canSeeCadastros ? [{ href: '/dashboard/admin', label: 'Cadastros', icon: moduleIcon('admin') }] : []),
  ]

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-neutral-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/dashboard" className="shrink-0 text-lg font-semibold text-brand-800">
              Painel de Informações
            </Link>
            <nav className="hidden gap-4 text-sm text-neutral-600 md:flex">
              {links.map((l) => {
                const Icon = l.icon
                return (
                  <Link key={l.href} href={l.href} className="flex items-center gap-1.5 hover:text-brand-700">
                    <Icon className="h-4 w-4" />
                    {l.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-neutral-600">
            <span className="hidden sm:inline">{user.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-none flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">{children}</main>
      <MobileTabBar links={links} />
    </div>
  )
}
```

- [ ] **Step 2: Apagar o componente antigo**

```bash
rm src/components/dashboard/MobileNav.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (confirma que nada mais importa `MobileNav`).

- [ ] **Step 4: Verificação visual**

Rodar `npm run dev`, logar em `http://localhost:3002/dashboard`.
- Redimensionar para 375px (ou DevTools → device toolbar): confirmar que o menu hambúrguer antigo sumiu, que uma tab bar aparece fixa na base da tela com ícone + rótulo por item, que clicar em cada tab navega para a rota certa, e que — se o usuário tiver mais de 4 links — o último slot é "Mais" e abre um painel na base com o restante dos links, fechando ao clicar fora ou no X.
- Alargar para ≥768px: confirmar que a tab bar some e a navegação horizontal do header aparece com ícone + rótulo ao lado de cada link.
- Confirmar no console do navegador que não há erro.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/layout.tsx
git rm src/components/dashboard/MobileNav.tsx
git commit -m "refactor: shell usa MobileTabBar + icones, remove MobileNav"
```

---

### Task 6: Atualizar a home (`page.tsx`)

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `Card`, `StatTile`, `Badge`, `SectionHeading`, `Callout` (Task 3); `moduleIcon` (Task 2).

- [ ] **Step 1: Reescrever `page.tsx`**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSessionUser, isAdmin } from '@/lib/authz'
import { Card } from '@/components/shared/ui/Card'
import { SectionHeading } from '@/components/shared/ui/SectionHeading'
import { StatTile } from '@/components/shared/ui/StatTile'
import { Badge } from '@/components/shared/ui/Badge'
import { Callout } from '@/components/shared/ui/Callout'
import { moduleIcon } from '@/components/shared/ui/icons'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = isAdmin(user)

  const [modules, datasets, lastRuns] = await Promise.all([
    prisma.module.findMany({
      where: admin ? undefined : { userAccesses: { some: { userId: user.id } } },
      orderBy: { phase: 'asc' },
      include: { panels: true },
    }),
    admin ? prisma.dataset.count({ where: { active: true } }) : Promise.resolve(0),
    admin
      ? prisma.syncRun.findMany({
          orderBy: { startedAt: 'desc' },
          take: 5,
          include: { dataset: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ])

  const producao = process.env.NEXT_PUBLIC_APP_ENV === 'producao'

  return (
    <div className="space-y-8">
      <Callout tone={producao ? 'danger' : 'info'} title={producao ? 'PRODUÇÃO' : 'DEV'}>
        <span className="font-mono opacity-80">{process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'sem versão'}</span>
      </Callout>

      <section>
        <SectionHeading>Negócios</SectionHeading>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const Icon = moduleIcon(m.code)
            const card = (
              <Card
                className={`p-4 ${m.active ? 'hover:border-brand-500' : 'opacity-70'}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="h-6 w-6 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">
                      {m.code.startsWith('fase') ? `Fase ${m.phase}` : 'Módulo'}
                    </p>
                    <h3 className="mt-1 font-medium text-neutral-900">{m.name}</h3>
                    <p className="mt-2 text-sm text-neutral-500">{m.active ? 'Abrir painel →' : 'Não iniciado'}</p>
                  </div>
                </div>
              </Card>
            )
            return m.active ? (
              <Link key={m.id} href={`/dashboard/${m.code}`}>
                {card}
              </Link>
            ) : (
              <div key={m.id}>{card}</div>
            )
          })}
          {modules.length === 0 && (
            <Callout tone="warning">Nenhum módulo foi liberado para o seu usuário. Procure um administrador.</Callout>
          )}
        </div>
      </section>

      {admin && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <StatTile label="Fontes de dados" value={datasets} hint="datasets ativos" />
            <Link href="/dashboard/datasets" className="mt-3 inline-block text-sm text-brand-700 hover:underline">
              Gerenciar →
            </Link>
          </Card>
          <Card className="p-4">
            <SectionHeading className="text-base">Últimas sincronizações</SectionHeading>
            {lastRuns.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">Nenhuma sincronização executada ainda.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {lastRuns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <span>{r.dataset.name}</span>
                    <Badge tone={r.status === 'SUCCESS' ? 'brand' : r.status === 'ERROR' ? 'danger' : 'warning'}>
                      {r.status === 'SUCCESS' ? `${r.rowsUpserted} linhas` : r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em `page.tsx`.

- [ ] **Step 3: Verificação visual**

Com `npm run dev` rodando, abrir `/dashboard`:
- Em 375px: cards de módulo mostram ícone + nome + status, o Callout de ambiente aparece no topo, tudo empilhado em 1 coluna.
- Em desktop (≥1024px): grid de 3 colunas para os cards de módulo; se logado como ADMIN, as duas seções (Fontes de dados / Últimas sincronizações) aparecem lado a lado com o `StatTile` e os `Badge` de status coloridos corretamente (verde=SUCCESS, vermelho=ERROR, âmbar=demais status).
- Sem erro no console do navegador.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "refactor: home usa kit de primitivos (Card, StatTile, Badge, Callout)"
```

---

## Self-Review

**Cobertura da spec:**
- Tokens de tema → Task 1.
- Kit de componentes (`Card`, `SectionHeading`, `StatTile`, `Badge`, `Callout`) → Task 3.
- Navegação desktop (visual refinado) e mobile (tab bar + drawer "Mais") → Tasks 4-5.
- Home com cards modernizados, sem alertas cross-módulo → Task 6 (nenhum painel de alertas agregado foi adicionado).
- Fora de escopo (dark mode manual, retrofit de módulo, alertas cross-módulo) → nenhuma task toca nesses itens.

**Placeholders:** nenhum "TBD"/"similar à Task N" — todo step tem código completo.

**Consistência de tipos:** `IconComponent` definido na Task 2 é reusado literalmente (mesmo nome) nas Tasks 3, 4 e 5. `NavLink` definido na Task 4 é o mesmo tipo usado na Task 5. `moduleIcon(code: string): IconComponent` tem a mesma assinatura em todos os usos (Tasks 5 e 6).
