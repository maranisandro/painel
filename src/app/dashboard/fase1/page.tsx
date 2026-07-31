import { redirect } from 'next/navigation'
import { Fase1Dashboard } from '@/components/fase1/Fase1Dashboard'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function Fase1Page() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase1')) redirect('/dashboard')

  return <Fase1Dashboard />
}
