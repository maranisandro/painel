import type { HTMLAttributes } from 'react'

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-(--radius-ui-lg) border border-neutral-200 bg-white shadow-(--shadow-ui-sm) ${className ?? ''}`}
      {...rest}
    >
      {children}
    </div>
  )
}
