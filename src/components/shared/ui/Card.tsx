import type { HTMLAttributes } from 'react'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-(--radius-lg) border border-neutral-200 bg-white shadow-(--shadow-sm) ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  )
}
