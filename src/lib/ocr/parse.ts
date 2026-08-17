/**
 * Extração heurística de placa/peso/data de um texto OCR bruto (ticket de
 * pesagem). Best-effort: ticket físico varia muito (manuscrito, carimbo,
 * papel amassado) — quando não acha um campo com confiança, retorna null
 * para esse campo e o operador completa manualmente (fallback já esperado).
 */
export interface ParsedTicket {
  placa: string | null
  pesoAproximadoTon: number | null
  dataTicket: string | null // YYYY-MM-DD
}

// Cobre placa antiga (LLLNNNN) e Mercosul (LLLNLNN) — a 5ª posição é dígito
// numa e letra na outra, o resto é igual nas duas.
const PLACA_RE = /\b([A-Z]{3})[\s-]?(\d)([A-Z0-9])(\d{2})\b/

function parsePlaca(texto: string): string | null {
  const m = texto.toUpperCase().match(PLACA_RE)
  return m ? `${m[1]}${m[2]}${m[3]}${m[4]}` : null
}

function parseNumeroBr(raw: string): number {
  // "32.450,5" (BR) ou "32,450.5" (raro em ticket nacional) ou "32450"
  const limpo = raw.trim()
  if (/,\d{1,2}$/.test(limpo)) return Number(limpo.replace(/\./g, '').replace(',', '.'))
  return Number(limpo.replace(/[.,]/g, ''))
}

function parsePeso(texto: string): number | null {
  // Prioriza "kg" (mais comum em ticket de balança) e converte para tonelada.
  const kg = texto.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s*kg\b/i)
  if (kg) {
    const valor = parseNumeroBr(kg[1])
    if (Number.isFinite(valor) && valor > 0) return valor / 1000
  }
  const ton = texto.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,3})?)\s*(?:ton(?:elada)?s?|t)\b/i)
  if (ton) {
    const valor = parseNumeroBr(ton[1])
    if (Number.isFinite(valor) && valor > 0) return valor
  }
  return null
}

function parseData(texto: string): string | null {
  const m = texto.match(/(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const diaOk = Number(dd) >= 1 && Number(dd) <= 31
  const mesOk = Number(mm) >= 1 && Number(mm) <= 12
  return diaOk && mesOk ? `${yyyy}-${mm}-${dd}` : null
}

export function parseTicketText(texto: string): ParsedTicket {
  return {
    placa: parsePlaca(texto),
    pesoAproximadoTon: parsePeso(texto),
    dataTicket: parseData(texto),
  }
}
