export function SectionHeading({
  children,
  className,
  as: Tag = 'h2',
}: {
  children: React.ReactNode
  className?: string
  as?: 'h1' | 'h2' | 'h3'
}) {
  return <Tag className={`text-lg font-semibold text-neutral-900 ${className ?? ''}`}>{children}</Tag>
}
