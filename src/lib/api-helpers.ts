import { NextResponse } from 'next/server'
import {
  getSessionUser,
  isAdmin,
  hasModuleAccess,
  canEditModule,
  hasResourceAccess,
  canEditResource,
  type SessionUser,
} from '@/lib/authz'

type Authorized = { user: SessionUser }
type Denied = { error: NextResponse }

function denied(user: SessionUser | null): Denied {
  if (user?.mustChangePassword) {
    return {
      error: NextResponse.json(
        { error: 'troca de senha obrigatória', code: 'PASSWORD_CHANGE_REQUIRED' },
        { status: 403 },
      ),
    }
  }

  return {
    error: NextResponse.json(
      { error: user ? 'acesso negado' : 'não autorizado' },
      { status: user ? 403 : 401 },
    ),
  }
}

export async function requireAdmin(): Promise<Authorized | Denied> {
  const user = await getSessionUser()
  return isAdmin(user) && !user!.mustChangePassword
    ? { user: user! }
    : denied(user)
}

export async function requireModuleViewer(moduleCode: string): Promise<Authorized | Denied> {
  const user = await getSessionUser()
  return hasModuleAccess(user, moduleCode) && !user!.mustChangePassword
    ? { user: user! }
    : denied(user)
}

export async function requireModuleEditor(moduleCode: string): Promise<Authorized | Denied> {
  const user = await getSessionUser()
  return canEditModule(user, moduleCode) && !user!.mustChangePassword
    ? { user: user! }
    : denied(user)
}

/**
 * Acesso granular por tela de Cadastro (pedido do usuário 2026-08-14) —
 * mesmo padrão de requireModuleViewer/Editor, mas por AdminResource (Locais,
 * Rotas, Parâmetros...) em vez de módulo/fase inteira.
 */
export async function requireResourceViewer(resourceCode: string): Promise<Authorized | Denied> {
  const user = await getSessionUser()
  return hasResourceAccess(user, resourceCode) && !user!.mustChangePassword
    ? { user: user! }
    : denied(user)
}

export async function requireResourceEditor(resourceCode: string): Promise<Authorized | Denied> {
  const user = await getSessionUser()
  return canEditResource(user, resourceCode) && !user!.mustChangePassword
    ? { user: user! }
    : denied(user)
}

/**
 * Usado só por ações do próprio painel de Fase 1 que não são telas de
 * Cadastro (ex.: justificativa de atraso, `trip-justifications`) — os
 * cadastros de verdade (Locais, Rotas, Manutenção etc.) migraram para
 * requireResourceEditor/Viewer em 2026-08-14, com acesso granular por tela.
 */
export async function requireEditor(): Promise<Authorized | Denied> {
  return requireModuleEditor('fase1')
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}
