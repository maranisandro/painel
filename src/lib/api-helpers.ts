import { NextResponse } from 'next/server'
import {
  getSessionUser,
  isAdmin,
  hasModuleAccess,
  canEditModule,
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
 * Compatibilidade com os cadastros atuais, todos pertencentes à Fase 1.
 * Novas fases devem chamar requireModuleEditor com o próprio código.
 */
export async function requireEditor(): Promise<Authorized | Denied> {
  return requireModuleEditor('fase1')
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}
