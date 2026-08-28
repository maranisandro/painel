import type { SVGProps } from 'react'

export type IconComponent = (props: SVGProps<SVGSVGElement>) => React.ReactElement

function iconProps(props: SVGProps<SVGSVGElement>) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    ...props,
  }
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"
      />
    </svg>
  )
}

export function TruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16V7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v9M3 16h9m0 0h3m-3 0V10h4l3 3v3h-2M6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
      />
    </svg>
  )
}

export function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 8 12 3 3 8m18 0-9 5m9-5v9l-9 5m0-9L3 8m9 5v9M3 8v9l9 5"
      />
    </svg>
  )
}

export function TransferIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h13m0 0-4-4m4 4-4 4M20 17H7m0 0 4 4m-4-4 4-4"
      />
    </svg>
  )
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 8v-1a4 4 0 0 0-3-3.87M15 5.13a3 3 0 0 1 0 5.75"
      />
    </svg>
  )
}

export function DropletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z"
      />
    </svg>
  )
}

export function DatabaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.5c4.142 0 7.5-1.12 7.5-2.5S16.142 1.5 12 1.5 4.5 2.62 4.5 4 7.858 6.5 12 6.5Zm7.5-2.5V19c0 1.38-3.358 2.5-7.5 2.5S4.5 20.38 4.5 19V4m15 6.5c0 1.38-3.358 2.5-7.5 2.5s-7.5-1.12-7.5-2.5"
      />
    </svg>
  )
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65 1.7 1.7 0 0 0 10.04 3.09V3a2 2 0 1 1 4 0v.09c0 .68.39 1.3 1.04 1.56.65.26 1.39.12 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.46.48-.6 1.22-.34 1.87.26.65.88 1.04 1.56 1.04H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.39-1.56 1.04Z"
      />
    </svg>
  )
}

export function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

const MODULE_ICON_MAP: Record<string, IconComponent> = {
  fase1: TruckIcon,
  fase3: PackageIcon,
  fase5: TransferIcon,
  rh: UsersIcon,
  abastecimento: DropletIcon,
  datasets: DatabaseIcon,
  admin: SettingsIcon,
}

export function moduleIcon(code: string): IconComponent {
  return MODULE_ICON_MAP[code] ?? HomeIcon
}
