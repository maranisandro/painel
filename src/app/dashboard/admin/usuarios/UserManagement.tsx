'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'

interface ModuleOption {
  id: string
  code: string
  name: string
  phase: number
  active: boolean
}

/** Tela de Cadastro concedível individualmente (Locais, Rotas, Parâmetros...) — pedido do usuário 2026-08-14 */
interface ResourceOption {
  id: string
  code: string
  name: string
  position: number
}

interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  mustChangePassword: boolean
  createdAt: string
  moduleCodes: string[]
  resourceCodes: string[]
}

interface FormState {
  name: string
  email: string
  role: Role
  active: boolean
  moduleCodes: string[]
  resourceCodes: string[]
}

interface TemporaryCredential {
  name: string
  email: string
  password: string
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  role: 'VIEWER',
  active: true,
  moduleCodes: [],
  resourceCodes: [],
}

const roleLabel: Record<Role, string> = {
  ADMIN: 'Administrador',
  EDITOR: 'Editor',
  VIEWER: 'Visualizador',
}

const roleDescription: Record<Role, string> = {
  ADMIN: 'Acesso total, inclusive usuários, infraestrutura e todas as fases.',
  EDITOR: 'Consulta e altera cadastros das fases selecionadas.',
  VIEWER: 'Somente consulta os painéis das fases selecionadas.',
}

export function UserManagement({
  users,
  modules,
  resources,
  currentUserId,
}: {
  users: UserRow[]
  modules: ModuleOption[]
  resources: ResourceOption[]
  currentUserId: string
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [editing, setEditing] = useState<UserRow | 'NEW' | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [credential, setCredential] = useState<TemporaryCredential | null>(null)

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return users.filter((user) => {
      if (roleFilter !== 'ALL' && user.role !== roleFilter) return false
      if (statusFilter === 'ACTIVE' && !user.active) return false
      if (statusFilter === 'INACTIVE' && user.active) return false
      if (!term) return true
      return [user.name, user.email, roleLabel[user.role], ...user.moduleCodes, ...user.resourceCodes]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(term)
    })
  }, [users, search, roleFilter, statusFilter])

  function openCreate() {
    setEditing('NEW')
    setForm(EMPTY_FORM)
    setError('')
  }

  function openEdit(user: UserRow) {
    setEditing(user)
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      moduleCodes: user.moduleCodes,
      resourceCodes: user.resourceCodes,
    })
    setError('')
  }

  function toggleModule(code: string) {
    setForm((current) => ({
      ...current,
      moduleCodes: current.moduleCodes.includes(code)
        ? current.moduleCodes.filter((item) => item !== code)
        : [...current.moduleCodes, code],
    }))
  }

  function toggleResource(code: string) {
    setForm((current) => ({
      ...current,
      resourceCodes: current.resourceCodes.includes(code)
        ? current.resourceCodes.filter((item) => item !== code)
        : [...current.resourceCodes, code],
    }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')

    const isNew = editing === 'NEW'
    const res = await fetch(isNew ? '/api/admin/users' : `/api/admin/users/${(editing as UserRow).id}`, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        moduleCodes: form.role === 'ADMIN' ? [] : form.moduleCodes,
        resourceCodes: form.role === 'ADMIN' ? [] : form.resourceCodes,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) {
      setError(body.error ?? 'Não foi possível salvar o usuário')
      return
    }

    if (isNew) {
      setCredential({
        name: body.user.name,
        email: body.user.email,
        password: body.temporaryPassword,
      })
    }
    setEditing(null)
    router.refresh()
  }

  async function resetPassword(user: UserRow) {
    if (!confirm(`Gerar uma nova senha temporária para ${user.name}? As sessões atuais serão encerradas.`)) {
      return
    }
    setError('')
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(body.error ?? 'Não foi possível redefinir a senha')
      return
    }
    setCredential({
      name: body.user.name,
      email: body.user.email,
      password: body.temporaryPassword,
    })
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Usuários e acessos</h1>
          <p className="text-sm text-slate-500">
            Perfis globais e acesso separado para cada fase e cada tela de Cadastro do Painel de Informações.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Novo usuário
        </button>
      </div>

      {credential && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium text-amber-950">Senha temporária — copie agora</h2>
              <p className="mt-1 text-sm text-amber-800">
                Esta senha é exibida somente nesta tela. {credential.name} deverá trocá-la no primeiro acesso.
              </p>
              <p className="mt-3 text-sm text-slate-700">{credential.email}</p>
              <code className="mt-1 inline-block rounded bg-white px-3 py-2 text-base font-semibold text-slate-900">
                {credential.password}
              </code>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(credential.password)}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm hover:bg-amber-100"
              >
                Copiar senha
              </button>
              <button
                onClick={() => setCredential(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-white"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar nome, e-mail ou fase…"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value as 'ALL' | Role)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">Todos os perfis</option>
          <option value="ADMIN">Administradores</option>
          <option value="EDITOR">Editores</option>
          <option value="VIEWER">Visualizadores</option>
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">Ativos e inativos</option>
          <option value="ACTIVE">Somente ativos</option>
          <option value="INACTIVE">Somente inativos</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Acesso às fases</th>
              <th className="px-4 py-3">Acesso aos cadastros</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3">Senha</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </td>
                <td className="px-4 py-3">{roleLabel[user.role]}</td>
                <td className="px-4 py-3">
                  {user.role === 'ADMIN' ? (
                    <span className="text-emerald-700">Todas as fases</span>
                  ) : user.moduleCodes.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {user.moduleCodes.map((code) => {
                        const assignedModule = modules.find((item) => item.code === code)
                        return (
                          <span key={code} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                            {code.startsWith('fase') ? `Fase ${assignedModule?.phase ?? code}` : (assignedModule?.name ?? code)}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-amber-700">Nenhuma fase</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {user.role === 'ADMIN' ? (
                    <span className="text-emerald-700">Todos os cadastros</span>
                  ) : user.resourceCodes.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {user.resourceCodes.map((code) => {
                        const assignedResource = resources.find((item) => item.code === code)
                        return (
                          <span key={code} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                            {assignedResource?.name ?? code}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-slate-400">Nenhum</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={user.active ? 'text-emerald-700' : 'text-slate-400'}>
                    {user.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {user.mustChangePassword ? (
                    <span className="text-amber-700">Troca pendente</span>
                  ) : (
                    <span className="text-slate-500">Definida</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(user)} className="text-emerald-700 hover:underline">
                    Editar
                  </button>
                  {user.id !== currentUserId && (
                    <button
                      onClick={() => resetPassword(user)}
                      className="ml-3 text-amber-700 hover:underline"
                    >
                      Redefinir senha
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={save} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {editing === 'NEW' ? 'Novo usuário' : `Editar ${editing.name}`}
                </h2>
                <p className="text-sm text-slate-500">
                  {editing === 'NEW'
                    ? 'O sistema gerará uma senha temporária e exigirá a troca no primeiro acesso.'
                    : 'Alterações de perfil e situação encerram as sessões atuais do usuário.'}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-900">
                ✕
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Nome</label>
                <input
                  required
                  minLength={2}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">E-mail</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Perfil global</label>
                <select
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="VIEWER">Visualizador</option>
                  <option value="EDITOR">Editor</option>
                  <option value="ADMIN">Administrador</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">{roleDescription[form.role]}</p>
              </div>
              {editing !== 'NEW' && (
                <label className="flex items-center gap-2 self-start pt-7 text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    disabled={editing.id === currentUserId}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  Usuário ativo
                </label>
              )}
            </div>

            <div className="mt-5">
              <p className="text-sm font-medium">Acesso aos módulos</p>
              <p className="text-xs text-slate-500">
                Fases não iniciadas podem ser liberadas agora e aparecerão quando forem ativadas.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {modules.map((module) => (
                  <label
                    key={module.code}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      form.role === 'ADMIN' ? 'border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={form.role === 'ADMIN'}
                      checked={form.role === 'ADMIN' || form.moduleCodes.includes(module.code)}
                      onChange={() => toggleModule(module.code)}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {module.code.startsWith('fase') ? `Fase ${module.phase} — ${module.name}` : module.name}
                      </span>
                      <span className="text-xs">
                        {module.active ? 'Módulo ativo' : 'Ainda não iniciado'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="text-sm font-medium">Acesso aos cadastros</p>
              <p className="text-xs text-slate-500">
                Cada tela de Cadastro (Locais, Rotas, Parâmetros...) pode ser liberada separadamente — não depende de
                ter acesso à fase inteira.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {resources.map((resource) => (
                  <label
                    key={resource.code}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      form.role === 'ADMIN' ? 'border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={form.role === 'ADMIN'}
                      checked={form.role === 'ADMIN' || form.resourceCodes.includes(resource.code)}
                      onChange={() => toggleResource(resource.code)}
                    />
                    <span className="block text-sm font-medium">{resource.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
