export type BadgeTone = 'brand' | 'neutral' | 'warning' | 'danger'

const TONE_CLASSES: Record<BadgeTone, string> = {
  brand: 'bg-brand-100 text-brand-800',
  neutral: 'bg-neutral-100 text-neutral-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}
