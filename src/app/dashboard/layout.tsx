import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, isAdmin, canEditModule, hasModuleAccess } from '@/lib/authz'
import { LogoutButton } from '@/components/LogoutButton'
import { MobileNav, type NavLink } from '@/components/dashboard/MobileNav'

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
  // Acesso granular por tela de Cadastro (pedido do usuário 2026-08-14) — o
  // link "Cadastros" aparece se o usuário tem pelo menos UM recurso
  // concedido (ou fase3, que ainda usa o gate de módulo inteiro pra Cotas
  // de venda) ou é admin; cada card individual em /dashboard/admin decide a
  // própria visibilidade por AdminResource.
  const canSeeCadastros = admin || user.resourceCodes.length > 0 || canEditModule(user, 'fase3')

  const links: NavLink[] = [
    { href: '/dashboard', label: 'Início' },
    ...(canSeeFase1 ? [{ href: '/dashboard/fase1', label: 'Transporte Rodoviário' }] : []),
    ...(canSeeFase1 ? [{ href: '/dashboard/fase1/mapa', label: 'Rastreamento' }] : []),
    ...(canSeeFase3 ? [{ href: '/dashboard/fase3', label: 'Venda Madeira Tratada' }] : []),
    ...(canSeeFase5 ? [{ href: '/dashboard/fase5', label: 'Transporte de Madeira' }] : []),
    ...(canSeeRh ? [{ href: '/dashboard/rh', label: 'Recursos Humanos' }] : []),
    ...(canSeeAbastecimento ? [{ href: '/dashboard/abastecimento', label: 'Abastecimento' }] : []),
    ...(admin ? [{ href: '/dashboard/datasets', label: 'Fontes de Dados' }] : []),
    ...(canSeeCadastros ? [{ href: '/dashboard/admin', label: 'Cadastros' }] : []),
  ]

  return (
    <div className="flex h-screen flex-col">
      <header className="relative shrink-0 border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/dashboard" className="shrink-0 text-lg font-semibold text-emerald-800">
              Painel de Informações
            </Link>
            <MobileNav links={links} />
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline">{user.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-none flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">{children}</main>
    </div>
  )
}
