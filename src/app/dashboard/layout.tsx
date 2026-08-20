import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, isAdmin, canEditModule, hasModuleAccess } from '@/lib/authz'
import { LogoutButton } from '@/components/LogoutButton'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.mustChangePassword) redirect('/trocar-senha')

  const admin = isAdmin(user)
  const canSeeFase1 = hasModuleAccess(user, 'fase1')
  const canSeeFase3 = hasModuleAccess(user, 'fase3')
  const canSeeFase5 = hasModuleAccess(user, 'fase5')
  const canSeeRh = hasModuleAccess(user, 'rh')
  // Acesso granular por tela de Cadastro (pedido do usuário 2026-08-14) — o
  // link "Cadastros" aparece se o usuário tem pelo menos UM recurso
  // concedido (ou fase3, que ainda usa o gate de módulo inteiro pra Cotas
  // de venda) ou é admin; cada card individual em /dashboard/admin decide a
  // própria visibilidade por AdminResource.
  const canSeeCadastros = admin || user.resourceCodes.length > 0 || canEditModule(user, 'fase3')

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold text-emerald-800">
              Painel de Informações
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/dashboard" className="hover:text-emerald-700">Início</Link>
              {canSeeFase1 && (
                <Link href="/dashboard/fase1" className="hover:text-emerald-700">Transporte Rodoviário</Link>
              )}
              {canSeeFase1 && (
                <Link href="/dashboard/fase1/mapa" className="hover:text-emerald-700">Rastreamento</Link>
              )}
              {canSeeFase3 && (
                <Link href="/dashboard/fase3" className="hover:text-emerald-700">Venda Madeira Tratada</Link>
              )}
              {canSeeFase5 && (
                <Link href="/dashboard/fase5" className="hover:text-emerald-700">Transporte de Madeira</Link>
              )}
              {canSeeRh && (
                <Link href="/dashboard/rh" className="hover:text-emerald-700">Recursos Humanos</Link>
              )}
              {admin && (
                <Link href="/dashboard/datasets" className="hover:text-emerald-700">Fontes de Dados</Link>
              )}
              {canSeeCadastros && (
                <Link href="/dashboard/admin" className="hover:text-emerald-700">Cadastros</Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{user.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-4 py-6">{children}</main>
    </div>
  )
}
