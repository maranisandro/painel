export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <h2 className={`text-lg font-semibold text-neutral-900 ${className ?? ''}`}>{children}</h2>
}
