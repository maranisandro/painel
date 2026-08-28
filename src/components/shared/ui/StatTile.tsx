import type { IconComponent } from './icons'

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: IconComponent
}) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <Icon className="h-8 w-8 shrink-0 text-brand-600" />}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
    </div>
  )
}
