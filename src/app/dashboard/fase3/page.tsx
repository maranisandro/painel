import { redirect } from 'next/navigation'
import { Fase3Dashboard } from '@/components/fase3/Fase3Dashboard'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function Fase3Page() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'fase3')) redirect('/dashboard')

  return <Fase3Dashboard />
}
