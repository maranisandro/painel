import { redirect } from 'next/navigation'
import { RhDashboard } from '@/components/rh/RhDashboard'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function RhPage() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'rh')) redirect('/dashboard')

  return <RhDashboard />
}
