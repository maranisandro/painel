/** progress = 0-100, quando o provider souber informar (pedido do usuário 2026-08-03: "% de conclusão"). */
export type OcrLogFn = (msg: string, progress?: number) => void
