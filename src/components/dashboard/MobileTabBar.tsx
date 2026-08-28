'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { CloseIcon, MoreIcon, type IconComponent } from '@/components/shared/ui/icons'

export interface NavLink {
  href: string
  label: string
  icon: IconComponent
}

const MAX_TABS = 4

export function MobileTabBar({ links }: { links: NavLink[] }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const primary = links.slice(0, MAX_TABS)
  const overflow = links.slice(MAX_TABS)

  return (
    <>
      <nav
        className="flex shrink-0 border-t border-neutral-200 bg-white md:hidden"
        aria-label="Navegação principal"
      >
        {primary.map((l) => {
          const active = pathname === l.href
          const Icon = l.icon
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? 'text-brand-700' : 'text-neutral-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate px-1">{l.label}</span>
            </Link>
          )
        })}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Mais opções"
            aria-expanded={drawerOpen}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-neutral-500"
          >
            <MoreIcon className="h-5 w-5" />
            <span>Mais</span>
          </button>
        )}
      </nav>
      {drawerOpen && overflow.length > 0 && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end bg-black/30 md:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="rounded-t-(--radius-lg) border-t border-neutral-200 bg-white p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 py-2">
              <span className="text-sm font-semibold text-neutral-700">Mais opções</span>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Fechar">
                <CloseIcon className="h-5 w-5 text-neutral-500" />
              </button>
            </div>
            <nav className="flex flex-col gap-1 pb-2">
              {overflow.map((l) => {
                const Icon = l.icon
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 rounded-(--radius-md) px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <Icon className="h-5 w-5 text-neutral-500" />
                    {l.label}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
