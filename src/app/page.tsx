import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/authz'

export default async function Home() {
  const user = await getSessionUser()
  redirect(user ? '/dashboard' : '/login')
}
