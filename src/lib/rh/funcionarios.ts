/**
 * Agregações do painel de RH (rh_funcionarios / RM.ZFUNCIONARIOS).
 *
 * CATEGORIA_RH já vem calculada pela camada semântica (ComputedColumn, ver
 * seed.ts): Ativo | Férias | Transferido | Demitido | Outros/Afastado.
 * "Transferido" (CODTIPODEMISSAO=5) fica fora do quadro atual e fora das
 * métricas de desligamento — pedido do usuário 2026-08-13.
 *
 * A agregação em si (contagens, médias) acontece no cliente (RhDashboard),
 * mesmo padrão de fase1/fase3, para permitir cross-filtragem (clique num
 * gráfico filtra os demais) sem ida ao servidor a cada clique.
 */

export interface FuncionarioRow {
  CODCOLIGADA: number
  COLIGADA: string
  CODFILIAL: number
  FILIAL: string
  CHAPA: string
  NOME: string
  SITUACAO: string
  CODTIPODEMISSAO: string | null
  TIPODEMISSAO: string | null
  DATAADMISSAO: string
  DATADEMISSAO: string | null
  CODFUNCAO: string
  FUNCAO: string
  CODSECAO: string
  SECAO: string
  CODCCUSTO: string
  CCUSTO: string
  CCUSTOATIVO: string
  SEXO: string
  DTNASCIMENTO: string
  PCD: number
  MEMBROCIPA: number
  DATAESTABILIDADE: string | null
  TIPOFUNCIONARIO: string
  GERENCIAL: string
  CBO: string
  RECMODIFIEDON: string
  IDADE_ANOS: number
  TEMPO_EMPRESA_ANOS: number
  CATEGORIA_RH: 'Ativo' | 'Férias' | 'Transferido' | 'Demitido' | 'Outros/Afastado'
}

export interface NameValue {
  name: string
  value: number
}

/** DATAADMISSAO/DATADEMISSAO vêm como DATE do Oracle (sem hora), serializadas
 *  em ISO com o horário local de meia-noite — a fatia yyyy-mm-dd já é a data
 *  certa em Brasília (mesma convenção usada em fase1/fase3). */
export function dataIso(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

export function prepararFuncionarios(view: Record<string, unknown>[]): FuncionarioRow[] {
  return view as unknown as FuncionarioRow[]
}

export function media(valores: number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((s, v) => s + v, 0) / valores.length
}

/** Merge de variações de FUNCAO que representam o mesmo cargo na prática —
 *  pedido do usuário 2026-08-13: "AJUDANTE FLORESTAL I" e "AJUDANTE
 *  FLORESTAL II" devem aparecer como "AJUDANTE FLORESTAL". FUNCAO na origem
 *  às vezes vem com espaço à direita (ex.: "OPERADOR DE MOTOSSERRA "), daí o
 *  trim antes de comparar/exibir. */
const MERGE_FUNCAO: Record<string, string> = {
  'AJUDANTE FLORESTAL I': 'AJUDANTE FLORESTAL',
  'AJUDANTE FLORESTAL II': 'AJUDANTE FLORESTAL',
}

export function normalizarFuncao(funcao: string): string {
  const limpa = (funcao ?? '').trim()
  return MERGE_FUNCAO[limpa] ?? limpa
}

export function contarPor(rows: FuncionarioRow[], campo: (r: FuncionarioRow) => string): NameValue[] {
  const contagem = new Map<string, number>()
  for (const r of rows) {
    const chave = campo(r) || 'Não informado'
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
  }
  return [...contagem.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

/** Linhas que compõem o quadro atual — sempre "foto de hoje", nunca filtrado
 *  por período (Demitido/Transferido não entram aqui). */
export function linhasQuadroAtual(todasAsLinhas: FuncionarioRow[]): FuncionarioRow[] {
  return todasAsLinhas.filter((r) => r.CATEGORIA_RH !== 'Demitido' && r.CATEGORIA_RH !== 'Transferido')
}

export interface ResumoQuadro {
  total: number
  porSexo: { M: number; F: number }
  idadeMediaPorSexo: { M: number | null; F: number | null }
  tempoEmpresaMedioAnos: number | null
}

export function resumoQuadro(rows: FuncionarioRow[]): ResumoQuadro {
  const homens = rows.filter((r) => r.SEXO === 'M')
  const mulheres = rows.filter((r) => r.SEXO === 'F')
  return {
    total: rows.length,
    porSexo: { M: homens.length, F: mulheres.length },
    idadeMediaPorSexo: { M: media(homens.map((r) => r.IDADE_ANOS)), F: media(mulheres.map((r) => r.IDADE_ANOS)) },
    tempoEmpresaMedioAnos: media(rows.map((r) => r.TEMPO_EMPRESA_ANOS)),
  }
}

/**
 * Cota legal de PCD (Lei 8.213/91, art. 93) — faixas por Nº de empregados da
 * EMPRESA (CNPJ raiz). Confirmado na origem (2026-08-13): cada COLIGADA desta
 * base corresponde a exatamente 1 raiz de CNPJ (matriz+filiais sob o mesmo
 * CNPJ), então agrupar por COLIGADA já é o nível legal correto — diferente
 * do aprendiz (abaixo), que a lei calcula por ESTABELECIMENTO (cada filial).
 * Empresas com menos de 100 empregados são isentas (sem faixa nas 4 do art. 93).
 */
const FAIXAS_PCD: { min: number; max: number | null; percentual: number }[] = [
  { min: 100, max: 200, percentual: 0.02 },
  { min: 201, max: 500, percentual: 0.03 },
  { min: 501, max: 1000, percentual: 0.04 },
  { min: 1001, max: null, percentual: 0.05 },
]

export function percentualPcdLegal(totalColaboradores: number): number {
  const faixa = FAIXAS_PCD.find((f) => totalColaboradores >= f.min && (f.max === null || totalColaboradores <= f.max))
  return faixa?.percentual ?? 0
}

/** Arredondamento padrão (fração >= 0,5 sobe) — mesmo critério da Nota Técnica SIT/MTE nº 65/2011. */
export function pcdMinimoLegal(totalColaboradores: number): number {
  const percentual = percentualPcdLegal(totalColaboradores)
  return percentual === 0 ? 0 : Math.round(totalColaboradores * percentual)
}

export interface EmpresaResumo {
  coligada: string
  quantidade: number
  tempoEmpresaMedioAnos: number | null
  pcdAtual: number
  pcdPercentualLegal: number
  pcdMinimoLegal: number
}

/** Sempre sobre o quadro atual INTEIRO (nunca cross-filtrado por
 *  categoria/função/setor) — a base legal do art. 93 é o total de empregados
 *  da empresa, não um recorte de exploração do painel. Ver RhDashboard.tsx. */
export function porEmpresa(rows: FuncionarioRow[]): EmpresaResumo[] {
  const coligadas = [...new Set(rows.map((r) => r.COLIGADA))]
  return coligadas
    .map((coligada) => {
      const doGrupo = rows.filter((r) => r.COLIGADA === coligada)
      return {
        coligada,
        quantidade: doGrupo.length,
        tempoEmpresaMedioAnos: media(doGrupo.map((r) => r.TEMPO_EMPRESA_ANOS)),
        pcdAtual: doGrupo.filter((r) => Number(r.PCD) === 1).length,
        pcdPercentualLegal: percentualPcdLegal(doGrupo.length),
        pcdMinimoLegal: pcdMinimoLegal(doGrupo.length),
      }
    })
    .sort((a, b) => b.quantidade - a.quantidade)
}

/**
 * Cota legal de aprendiz (CLT art. 429 + Decreto 9.579/2018, art. 51) — 5% a
 * 15% dos trabalhadores por ESTABELECIMENTO (cada filial separadamente, ao
 * contrário do PCD acima). A base de cálculo exclui, por lei, cargos de
 * direção/gerência/confiança e funções que exigem formação técnica/superior.
 *
 * SIMPLIFICAÇÃO (sem classificação de cargo por CBO nesta base): a base usa
 * TIPOFUNCIONARIO, excluindo "Diretor" (cargo de direção, claramente fora),
 * "Estagiário" (não é empregado CLT) e o próprio "Aprendiz" (não conta na
 * base que gera a cota). Funções técnicas/de nível superior dentro de
 * "Normal" NÃO são excluídas — o número mínimo/máximo abaixo é uma
 * ESTIMATIVA, não substitui a análise de RH/jurídico cargo a cargo.
 */
const PCT_APRENDIZ_MIN = 0.05
const PCT_APRENDIZ_MAX = 0.15
const TIPOS_FORA_DA_BASE_APRENDIZ = new Set(['Diretor', 'Estagiário', 'Aprendiz'])

export interface EstabelecimentoAprendiz {
  coligada: string
  filial: string
  codFilial: number
  baseCalculo: number
  aprendizesAtual: number
  minimoLegal: number
  maximoLegal: number
}

/** Sempre sobre o quadro atual INTEIRO — mesmo motivo do porEmpresa acima. */
export function porEstabelecimentoAprendiz(rows: FuncionarioRow[]): EstabelecimentoAprendiz[] {
  const chaves = new Map<string, { coligada: string; filial: string; codFilial: number }>()
  for (const r of rows) {
    const chave = `${r.CODCOLIGADA}-${r.CODFILIAL}`
    if (!chaves.has(chave)) chaves.set(chave, { coligada: r.COLIGADA, filial: r.FILIAL, codFilial: r.CODFILIAL })
  }
  return [...chaves.entries()]
    .map(([chave, info]) => {
      const doEstabelecimento = rows.filter((r) => `${r.CODCOLIGADA}-${r.CODFILIAL}` === chave)
      const base = doEstabelecimento.filter((r) => !TIPOS_FORA_DA_BASE_APRENDIZ.has(r.TIPOFUNCIONARIO))
      return {
        ...info,
        baseCalculo: base.length,
        aprendizesAtual: doEstabelecimento.filter((r) => r.TIPOFUNCIONARIO === 'Aprendiz').length,
        minimoLegal: Math.round(base.length * PCT_APRENDIZ_MIN),
        maximoLegal: Math.round(base.length * PCT_APRENDIZ_MAX),
      }
    })
    .sort((a, b) => b.baseCalculo - a.baseCalculo)
}

/** Demitidos (CATEGORIA_RH='Demitido') com DATADEMISSAO dentro de [from,to]. */
export function linhasDesligamentosPeriodo(todasAsLinhas: FuncionarioRow[], from: string, to: string): FuncionarioRow[] {
  return todasAsLinhas.filter((r) => {
    if (r.CATEGORIA_RH !== 'Demitido') return false
    const data = dataIso(r.DATADEMISSAO)
    return data !== null && data >= from && data <= to
  })
}

/** Transferências (CATEGORIA_RH='Transferido') com DATADEMISSAO dentro de [from,to] — informativo, fora do turnover. */
export function linhasTransferenciasPeriodo(todasAsLinhas: FuncionarioRow[], from: string, to: string): FuncionarioRow[] {
  return todasAsLinhas.filter((r) => {
    if (r.CATEGORIA_RH !== 'Transferido') return false
    const data = dataIso(r.DATADEMISSAO)
    return data !== null && data >= from && data <= to
  })
}

/**
 * SST (Saúde e Segurança do Trabalho) por empresa — pedido do usuário
 * 2026-08-13, aba "SST". APENAS quadro ATUAL (descritivo): esta base não tem
 * CNAE nem grau de risco por empresa, e o dimensionamento MÍNIMO legal de
 * SESMT (NR-4) e de CIPA (NR-5, Quadro I) depende exatamente desses dois
 * dados — sem eles não dá pra calcular uma cota mínima real, só mostrar o
 * que já existe. Se o usuário informar o grau de risco de cada empresa,
 * dá pra somar o cálculo do mínimo legal depois.
 *
 * CIPA usa o campo MEMBROCIPA (flag 1/0). Achado durante a implementação:
 * TIPOAFASTAMENTO='Membro Cipa' aparece em mais linhas (65) do que
 * MEMBROCIPA=1 (15) no quadro atual — os dois campos não batem na origem.
 * Ficou com MEMBROCIPA por ser o campo nomeado especificamente para isso;
 * a divergência foi só reportada ao usuário, não "corrigida" (não há como
 * saber qual dos dois está desatualizado a partir daqui).
 *
 * Padrão exige "DO TRABALHO" explícito — correção do usuário 2026-08-13:
 * "MONITOR DE SEGURANCA" NÃO é SST (é vigilância patrimonial, não saúde/
 * segurança ocupacional), então "SEGURANCA" sozinho no nome é raso demais.
 */
const FUNCOES_SST_PADROES = [/SEGURAN[CÇ]A\s+DO\s+TRABALHO/i, /MEDIC[OA]\s+DO\s+TRABALHO/i, /ENFERMEIR[OA]\s*\(?A?\)?\s*DO\s+TRABALHO/i]

export function ehFuncaoSst(funcao: string): boolean {
  return FUNCOES_SST_PADROES.some((re) => re.test(funcao))
}

export interface SstEmpresa {
  coligada: string
  colaboradores: number
  membrosCipa: number
  funcoesSst: NameValue[]
}

/** Sempre sobre o quadro atual INTEIRO — mesmo critério de porEmpresa/porEstabelecimentoAprendiz acima. */
export function porEmpresaSst(rows: FuncionarioRow[]): SstEmpresa[] {
  const coligadas = [...new Set(rows.map((r) => r.COLIGADA))]
  return coligadas
    .map((coligada) => {
      const doGrupo = rows.filter((r) => r.COLIGADA === coligada)
      return {
        coligada,
        colaboradores: doGrupo.length,
        membrosCipa: doGrupo.filter((r) => Number(r.MEMBROCIPA) === 1).length,
        funcoesSst: contarPor(doGrupo.filter((r) => ehFuncaoSst(r.FUNCAO)), (r) => r.FUNCAO),
      }
    })
    .sort((a, b) => b.colaboradores - a.colaboradores)
}

/**
 * Membros da CIPA (MEMBROCIPA=1) com avaliação de estabilidade — pedido do
 * usuário 2026-08-13: "avaliar se está dentro da data de estabilidade".
 * DATAESTABILIDADE já vem calculada pela origem (TOTVS RM) — aqui só se
 * compara com hoje. Sem essa data registrada, não dá pra afirmar nada (nem
 * "dentro" nem "fora"), então vira uma 3ª situação em vez de assumir.
 */
export interface MembroCipa {
  chapa: string
  nome: string
  coligada: string
  funcao: string
  dataEstabilidade: string | null
  dentroDaEstabilidade: boolean | null
}

export function membrosCipaComEstabilidade(rows: FuncionarioRow[], hojeIso: string): MembroCipa[] {
  return rows
    .filter((r) => Number(r.MEMBROCIPA) === 1)
    .map((r) => {
      const dataEstabilidade = dataIso(r.DATAESTABILIDADE)
      return {
        chapa: r.CHAPA,
        nome: r.NOME,
        coligada: r.COLIGADA,
        funcao: normalizarFuncao(r.FUNCAO),
        dataEstabilidade,
        dentroDaEstabilidade: dataEstabilidade === null ? null : dataEstabilidade >= hojeIso,
      }
    })
    .sort((a, b) => a.coligada.localeCompare(b.coligada) || a.nome.localeCompare(b.nome))
}

/**
 * Turnover mensal — pedido do usuário 2026-08-13. Fórmula padrão de RH:
 * ((admissões + desligamentos) / 2) / efetivo médio do mês × 100.
 * Reconstrução de efetivo em qualquer data passada usa TODAS as linhas
 * (não só o quadro atual), pelo intervalo [DATAADMISSAO, DATADEMISSAO) de
 * cada vínculo — inclui vínculos hoje Demitido/Transferido, porque no mês em
 * questão a pessoa podia estar empregada. Desligamentos NÃO incluem
 * Transferido (mesma regra do resto do painel); admissões, por outro lado,
 * não têm como distinguir "contratação externa" de "recebido por
 * transferência de outra empresa do grupo" nesta base — toda DATAADMISSAO
 * dentro do mês conta, então o número pode incluir transferências de
 * entrada (limitação conhecida, documentada aqui e na tela).
 */
export interface TurnoverMes {
  mes: string
  admissoes: number
  desligamentos: number
  efetivoMedio: number
  turnoverPercentual: number | null
}

/**
 * ACHADO REAL (2026-08-13): 4.477 das 42.874 linhas "Demitido" (~10%) não
 * têm DATADEMISSAO preenchida na origem — RECMODIFIEDON dessas linhas é um
 * timestamp idêntico entre pessoas com admissões em anos bem diferentes
 * (2000, 2010, 2011...), ou seja, é carimbo de uma carga/limpeza em lote, não
 * a data real de saída — não dá pra usar como proxy. Contar essas linhas
 * como "sempre empregada" inflava o efetivo reconstruído de hoje para 6.766
 * (vs. 2.291 reais no quadro atual, quase exatamente as 4.475 linhas
 * problemáticas). Solução: excluir da reconstrução qualquer linha já
 * marcada Demitido/Transferido sem DATADEMISSAO — subestima o efetivo de um
 * passado bem distante (quando a saída real dela tiver sido), mas evita
 * inflar sistematicamente o efetivo/turnover dos últimos 12 meses, que é o
 * que o gráfico mostra.
 */
function efetivoEm(todasAsLinhas: FuncionarioRow[], dataReferenciaIso: string): number {
  return todasAsLinhas.filter((r) => {
    const admissao = dataIso(r.DATAADMISSAO)
    if (!admissao || admissao > dataReferenciaIso) return false
    const demissao = dataIso(r.DATADEMISSAO)
    if (demissao) return demissao > dataReferenciaIso
    return r.CATEGORIA_RH !== 'Demitido' && r.CATEGORIA_RH !== 'Transferido'
  }).length
}

export function turnoverMensal(todasAsLinhas: FuncionarioRow[], meses: number, referenciaIso: string): TurnoverMes[] {
  const ref = new Date(`${referenciaIso}T00:00:00`)
  const resultado: TurnoverMes[] = []
  for (let i = meses - 1; i >= 0; i--) {
    const inicio = new Date(ref.getFullYear(), ref.getMonth() - i, 1)
    const fim = new Date(ref.getFullYear(), ref.getMonth() - i + 1, 0)
    const inicioIso = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`
    const fimIso = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`

    const admissoes = todasAsLinhas.filter((r) => {
      const admissao = dataIso(r.DATAADMISSAO)
      return admissao !== null && admissao >= inicioIso && admissao <= fimIso
    }).length
    const desligamentos = linhasDesligamentosPeriodo(todasAsLinhas, inicioIso, fimIso).length
    const efetivoMedio = (efetivoEm(todasAsLinhas, inicioIso) + efetivoEm(todasAsLinhas, fimIso)) / 2

    resultado.push({
      mes: `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`,
      admissoes,
      desligamentos,
      efetivoMedio,
      turnoverPercentual: efetivoMedio > 0 ? ((admissoes + desligamentos) / 2 / efetivoMedio) * 100 : null,
    })
  }
  return resultado
}
