'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface NavLink {
  href: string
  label: string
}

/**
 * Nav principal — pedido do usuário 2026-08-21 ("montar o layout mobile"):
 * antes era um `<nav className="flex gap-4">` sem wrap nem menu, então em
 * telas estreitas (ex.: 375px) a lista de links simplesmente vazava pra fora
 * do header em vez de virar um menu. Acima de `md` continua exatamente igual
 * (nav horizontal simples); abaixo disso vira um botão hambúrguer que abre a
 * mesma lista de links empilhada.
 */
export function MobileNav({ links }: { links: NavLink[] }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <nav className="hidden gap-4 text-sm text-slate-600 md:flex">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-emerald-700">
            {l.label}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={aberto}
        className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 md:hidden"
      >
        {aberto ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>
      {aberto && (
        <nav className="absolute left-0 right-0 top-full flex flex-col gap-1 border-b border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setAberto(false)} className="rounded px-2 py-2 hover:bg-slate-100 hover:text-emerald-700">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  )
}
