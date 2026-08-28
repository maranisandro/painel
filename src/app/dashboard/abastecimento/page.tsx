import { redirect } from 'next/navigation'
import { AbastecimentoDashboard } from '@/components/abastecimento/AbastecimentoDashboard'
import { getSessionUser, hasModuleAccess } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export default async function AbastecimentoPage() {
  const user = await getSessionUser()
  if (!hasModuleAccess(user, 'abastecimento')) redirect('/dashboard')

  return <AbastecimentoDashboard />
}
