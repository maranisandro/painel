export function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      {icon}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      </div>
    </div>
  )
}
