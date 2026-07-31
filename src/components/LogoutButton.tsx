'use client'

import { signOut } from 'next-auth/react'

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
    >
      Sair
    </button>
  )
}
