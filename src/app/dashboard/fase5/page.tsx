import { redirect } from 'next/navigation'
import { Fase5Dashboard } from '@/components/fase5/Fase5Dashboard'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function Fase5Page() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase5')) redirect('/dashboard')

  return <Fase5Dashboard />
}
