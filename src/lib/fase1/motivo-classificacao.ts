/**
 * Consolidação de motivos digitados livremente (manutenção e justificativa
 * de atraso) em categorias objetivas — pedido do usuário 2026-08-20: "No
 * painel estrategico preciso entender quais os meus principais motivos de
 * falta de disponibilidade mecanica e eficiencia. Como os motivos são
 * digitação aberta tentar consolidar os descritivos com motivos mais
 * objetivos". Classificação por palavra-chave (heurística, não é NLP) — a
 * primeira regra cuja palavra-chave aparece no texto vence; texto que não
 * bate com nenhuma regra cai em "Outros / não classificado" (revisável
 * depois, sem perder o texto original).
 */

interface RegraClassificacao {
  categoria: string
  palavras: string[]
}

const OUTROS = 'Outros / não classificado'

function bateComRegra(textoNormalizado: string, palavras: string[]): boolean {
  return palavras.some((p) => textoNormalizado.includes(p))
}

function classificar(texto: string, regras: RegraClassificacao[]): string {
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
  for (const regra of regras) {
    if (bateComRegra(t, regra.palavras)) return regra.categoria
  }
  return OUTROS
}

// Motivos de MANUTENÇÃO (afetam Disponibilidade Mecânica) — ordem importa:
// regras mais específicas primeiro (ex.: "pneu" antes de "revisão").
const REGRAS_MANUTENCAO: RegraClassificacao[] = [
  { categoria: 'Pneu', palavras: ['pneu', 'borracharia', 'rodagem'] },
  { categoria: 'Elétrica', palavras: ['eletric', 'bateria', 'chicote', 'sensor', 'fusivel', 'fusível'] },
  { categoria: 'Motor/Câmbio', palavras: ['motor', 'cambio', 'câmbio', 'embreagem', 'transmiss'] },
  { categoria: 'Freio/Suspensão', palavras: ['freio', 'suspens', 'amortecedor', 'mola'] },
  { categoria: 'Acidente/Batida', palavras: ['acidente', 'batida', 'colis', 'capot', 'tombou', 'tombamento'] },
  { categoria: 'Vistoria/Documentação', palavras: ['vistoria', 'inmetro', 'licenciamento', 'documenta', 'crlv'] },
  { categoria: 'Manutenção preventiva/revisão', palavras: ['preventiv', 'revisao', 'revisão', 'troca de oleo', 'troca de óleo'] },
  { categoria: 'Manutenção corretiva', palavras: ['corretiv', 'quebr', 'defeito', 'problema mecanico', 'problema mecânico'] },
  { categoria: 'Transferência de composição', palavras: ['tritrem', 'transporte de lenha', 'transporte interno', 'mudando para'] },
]

// Motivos de ATRASO (afetam Eficiência Operacional) — a justificativa de
// atraso é digitada pelo operador ao registrar o motivo da viagem em atraso.
const REGRAS_ATRASO: RegraClassificacao[] = [
  // Achado real 2026-08-20: a maioria dos motivos digitados é sobre
  // carga/descarga no cliente (forno, fábrica, carregamento) — vocabulário
  // amplo de propósito porque é assim que o operador descreve no dia a dia,
  // raramente usando a palavra "fila" ou "demora" propriamente.
  {
    categoria: 'Fila/demora no cliente (carga ou descarga)',
    palavras: [
      'fila', 'demora no cliente', 'aguardando descarga', 'descarga previst', 'aguardando carga',
      'descarreg', 'carregament', 'descarga', 'carregando', 'forno desligou', 'forno', 'na fabrica',
      'na fábrica', 'carregou em',
    ],
  },
  { categoria: 'Quebra mecânica na estrada', palavras: ['quebr', 'pane', 'defeito na estrada', 'problema mecanico', 'problema mecânico'] },
  { categoria: 'Manutenção', palavras: ['manutencao', 'manutenção', 'oficina', 'revisao', 'revisão'] },
  { categoria: 'Nota fiscal/documentação', palavras: ['nota fiscal', 'nf ', 'documenta', 'canhoto'] },
  { categoria: 'Transferência de composição', palavras: ['tritrem', 'transporte de lenha', 'transporte interno', 'mudando para', 'cavalinho'] },
  { categoria: 'Trânsito/estrada', palavras: ['transito', 'trânsito', 'estrada', 'chuva', 'alagamento', 'buraco'] },
  { categoria: 'Motorista', palavras: ['motorista', 'atestado', 'ferias', 'férias', 'folga'] },
  { categoria: 'Vistoria/Inmetro', palavras: ['vistoria', 'inmetro'] },
]

export function classificarMotivoManutencao(texto: string): string {
  return classificar(texto ?? '', REGRAS_MANUTENCAO)
}

export function classificarMotivoAtraso(texto: string): string {
  return classificar(texto ?? '', REGRAS_ATRASO)
}

export const CATEGORIA_OUTROS = OUTROS
