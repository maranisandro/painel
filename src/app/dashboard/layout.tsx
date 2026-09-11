import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, isAdmin, canEditModule, hasModuleAccess } from '@/lib/authz'
import { LogoutButton } from '@/components/LogoutButton'
import { MobileTabBar, type NavLink } from '@/components/dashboard/MobileTabBar'
import { UsageTracker } from '@/components/dashboard/UsageTracker'
import { HomeIcon, moduleIcon, type IconComponent } from '@/components/shared/ui/icons'

// Ícones são renderizados aqui (Server Component) e o resultado (um elemento
// já pronto) é o que entra em `links`/`NavLink.icon` — passar a referência de
// função crua para o MobileTabBar ('use client') quebra a serialização RSC.
function icon(Icon: IconComponent) {
  return <Icon className="h-5 w-5" />
}

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
  // Acesso granular por tela de Cadastro (pedido do usuário 2026-08-14) — o link
  // "Cadastros" aparece se o usuário tem pelo menos UM recurso concedido (ou fase3,
  // que ainda usa o gate de módulo inteiro pra Cotas de venda) ou é admin; cada card
  // individual em /dashboard/admin decide a própria visibilidade por AdminResource.
  const canSeeCadastros = admin || user.resourceCodes.length > 0 || canEditModule(user, 'fase3')

  const links: NavLink[] = [
    { href: '/dashboard', label: 'Início', icon: icon(HomeIcon) },
    ...(canSeeFase1
      ? [{ href: '/dashboard/fase1', label: 'Transporte Rodoviário', icon: icon(moduleIcon('fase1')) }]
      : []),
    ...(canSeeFase1
      ? [{ href: '/dashboard/fase1/mapa', label: 'Rastreamento', icon: icon(moduleIcon('fase1')) }]
      : []),
    ...(canSeeFase3
      ? [{ href: '/dashboard/fase3', label: 'Venda Madeira Tratada', icon: icon(moduleIcon('fase3')) }]
      : []),
    ...(canSeeFase5
      ? [{ href: '/dashboard/fase5', label: 'Transporte de Madeira', icon: icon(moduleIcon('fase5')) }]
      : []),
    ...(canSeeRh ? [{ href: '/dashboard/rh', label: 'Recursos Humanos', icon: icon(moduleIcon('rh')) }] : []),
    ...(canSeeAbastecimento
      ? [{ href: '/dashboard/abastecimento', label: 'Abastecimento', icon: icon(moduleIcon('abastecimento')) }]
      : []),
    ...(admin ? [{ href: '/dashboard/datasets', label: 'Fontes de Dados', icon: icon(moduleIcon('datasets')) }] : []),
    ...(canSeeCadastros ? [{ href: '/dashboard/admin', label: 'Cadastros', icon: icon(moduleIcon('admin')) }] : []),
  ]

  return (
    <div className="flex h-dvh flex-col">
      <UsageTracker />
      <header className="shrink-0 border-b border-neutral-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/dashboard" className="shrink-0 text-lg font-semibold text-brand-800">
              Painel de Informações
            </Link>
            <nav className="hidden min-w-0 flex-nowrap gap-4 overflow-x-auto text-sm text-neutral-600 md:flex">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="flex shrink-0 items-center gap-1.5 hover:text-brand-700"
                >
                  {l.icon}
                  {l.label}
                </Link>
              ))}
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
