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
  const canSeeCadastros = admin || canEditModule(user, 'fase1')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
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
                <Link href="/dashboard/fase1/mapa" className="hover:text-emerald-700">Mapa</Link>
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
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}
