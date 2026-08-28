export type CalloutTone = 'info' | 'warning' | 'danger' | 'neutral'

const TONE_CLASSES: Record<CalloutTone, string> = {
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
  neutral: 'border-neutral-200 bg-neutral-50 text-neutral-700',
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: CalloutTone
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-(--radius-ui-md) border p-3 text-sm ${TONE_CLASSES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  )
}
