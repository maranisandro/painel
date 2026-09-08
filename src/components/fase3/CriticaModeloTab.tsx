'use client'

import { useEffect, useState } from 'react'
import { DateRangeInputs, fmtDateBR } from '@/components/shared/DateRangeInputs'
import { SortableTable, type SortableColumn } from '@/components/shared/SortableTable'

interface RegistroAlterado {
  data: string
  distribuidor: string
  cliente: string
  produto: string
  tipoMovimento: string
  quantidade: number
  valorBruto: number
  recModificadoEm: string
}

interface CriticaData {
  period: { from: string; to: string }
  achado1PlanepBonificacaoIndevida: {
    transacoes: number
    valorNominal: number
    top3Clientes: { cliente: string; n: number; valor: number }[]
  }
  achado2AssimetriaMetaDestino: {
    metaDestinoAssimetrico: number | null
    precoPonderadoSimetrico: number | null
    diferenca: number | null
  }
  achado3BonificacaoNominalVsTabela4: {
    bonifNominal: number
    bonifDiferencaTabela4: number
    diferenca: number
  }
  achado4ProdutosSemM3: { produto: string; linhas: number; m3Total: number; faturamento: number }[]
  achado5RegistrosAlteradosAposFechamento: {
    total: number
    valorTotal: number
    registros: RegistroAlterado[]
  }
  achado7PorDistribuidor: { chave: string; faturamentoLiquido: number; m3Total: number }[]
  achado10FlagBonificacaoSemCodtmv: {
    transacoes: number
    valorComPrecoVendido: number
    valorComPrecoBase: number
    diferenca: number
    exemplos: {
      data: string
      distribuidor: string
      cliente: string
      produto: string
      quantidade: number
      precoVendido: number
      precoMedioTabela4: number
    }[]
  }
  achado11CotasVsMetaVolume: {
    mes: string
    temCadastro: boolean
    metaVolumeM3: number
    somaM3ProdutosCadastrados: number
    produtosSemFatorM3: number
    produtosCadastrados: number
    diferencaVolumePct: number | null
    somaIcmsPct: number | null
  }
  achado12NotaVendaAposTritrem: {
    transacoes: number
    valorTotal: number
    porPlaca: { placa: string; n: number; primeira: string; ultima: string; valor: number }[]
  }
}

function fmtMoeda(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
function fmt(n: number, digits = 0): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
function fmtDataHoraBR(iso: string): string {
  if (!iso) return '—'
  const [data, hora] = iso.split('T')
  return `${fmtDateBR(data)}${hora ? ' ' + hora : ''}`
}
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function Achado({
  numero,
  titulo,
  status,
  children,
}: {
  numero: number
  titulo: string
  status: 'corrigido' | 'em-aberto' | 'nota'
  children: React.ReactNode
}) {
  const estilo =
    status === 'corrigido'
      ? 'border-emerald-200 bg-emerald-50'
      : status === 'em-aberto'
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-white'
  const badge =
    status === 'corrigido'
      ? { label: 'corrigido', cls: 'bg-emerald-100 text-emerald-800' }
      : status === 'em-aberto'
        ? { label: 'decisão pendente', cls: 'bg-amber-100 text-amber-800' }
        : { label: 'nota técnica', cls: 'bg-slate-100 text-slate-600' }

  return (
    <div className={`rounded-xl border p-4 ${estilo}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">
          Achado {numero} — {titulo}
        </h3>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
      </div>
      <div className="space-y-2 text-sm text-slate-700">{children}</div>
    </div>
  )
}

/**
 * Crítica ao modelo — pedido do usuário 2026-08-04: "critique o modelo
 * sobre os cálculos em uma aba específica trazendo exemplos para análises
 * e avaliarmos possíveis erros conceituais no modelo". Traz, com números
 * reais do período selecionado, os achados conceituais encontrados
 * investigando a Fase 3 nesta sessão.
 */
export function CriticaModeloTab() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<CriticaData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/fase3/critica?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [from, to])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DateRangeInputs from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {loading && <span className="text-xs text-slate-500">carregando…</span>}
        {data?.period && (
          <span className="text-xs text-slate-500">
            Período: {fmtDateBR(data.period.from)} a {fmtDateBR(data.period.to)}
          </span>
        )}
      </div>

      <p className="text-sm text-slate-500">
        Cada achado abaixo é recalculado ao vivo com dados reais do período selecionado acima — não é
        um relatório estático, é um jeito de auditar o modelo a qualquer momento.
      </p>

      <Achado numero={1} titulo="Bonificação da Planep contraria a regra de negócio — monitorado, não escondido" status="em-aberto">
        <p>
          O usuário confirmou (2026-08-05): o conceito de bonificação é <strong>o mesmo para todos os
          distribuidores</strong>, sem exceção — a Planep não deveria ter bonificação, mas se acontece,
          precisa ser <strong>controlado</strong>, não escondido reclassificando como venda. Corrigido:
          essas transações agora entram como Bonificações igual a qualquer outro distribuidor (contam na
          aba Bonificações, não entram no faturamento/m³ de vendas) — este achado existe para MONITORAR
          que isso não deveria estar acontecendo. No período selecionado, o Oracle tem{' '}
          <strong>{data?.achado1PlanepBonificacaoIndevida.transacoes ?? 0} transações</strong> reais
          marcadas <code>CODTMV=2.2.48</code> (bonificação) para esse distribuidor, valor nominal{' '}
          <strong>{fmtMoeda(data?.achado1PlanepBonificacaoIndevida.valorNominal ?? 0)}</strong>.
        </p>
        <p>Top 3 clientes destino:</p>
        <ul className="list-inside list-disc">
          {(data?.achado1PlanepBonificacaoIndevida.top3Clientes ?? []).map((c) => (
            <li key={c.cliente}>
              {c.cliente} — {c.n} transações, {fmtMoeda(c.valor)}
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">
          Pergunta em aberto: por que a Planep recebe bonificação no ERP se a regra diz que não deveria?
          Vale investigar na origem (TOTVS) se é erro de lançamento ou se a regra mudou e ninguém atualizou o cadastro.
        </p>
      </Achado>

      <Achado numero={2} titulo="Duas versões de 'preço mínimo' com tratamento assimétrico de Devolução" status="nota">
        <p>
          O painel Power BI original tem <code>.Meta Destino</code> e <code>.Preço Ponderado</code> — ambos
          dividem a soma do <code>preco_ponderado</code> pelo mesmo <code>.Total m³ vendido</code> (que já
          desconta devolução), mas só <code>.Preço Ponderado</code> também exclui devolução do numerador.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Meta Destino (assimétrico)</p>
            <p className="font-semibold">{fmtMoeda(data?.achado2AssimetriaMetaDestino.metaDestinoAssimetrico ?? null)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Preço Ponderado (simétrico — o que usamos)</p>
            <p className="font-semibold">{fmtMoeda(data?.achado2AssimetriaMetaDestino.precoPonderadoSimetrico ?? null)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Diferença</p>
            <p className="font-semibold">{fmtMoeda(data?.achado2AssimetriaMetaDestino.diferenca ?? null)}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Usamos a versão simétrica (Preço Ponderado) em todo o painel novo — mais defensável, mas vale
          confirmar com quem acompanha metas se "Meta Destino" tinha um motivo específico para incluir a
          devolução do jeito que inclui.
        </p>
      </Achado>

      <Achado numero={3} titulo="Bonificação: valor nominal x diferença de tabela preço base" status="em-aberto">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Nominal (QUANTIDADE × PRECO_VENDIDO) — em uso hoje</p>
            <p className="font-semibold">{fmtMoeda(data?.achado3BonificacaoNominalVsTabela4.bonifNominal ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Diferença vs tabela preço base</p>
            <p className="font-semibold">{fmtMoeda(data?.achado3BonificacaoNominalVsTabela4.bonifDiferencaTabela4 ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Diferença entre as duas</p>
            <p className="font-semibold">{fmtMoeda(data?.achado3BonificacaoNominalVsTabela4.diferenca ?? 0)}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Pedido do usuário em 2026-08-04, revertido no mesmo dia para "seguir a lógica do painel antigo até
          ajustarmos" — ambos os números ficam disponíveis aqui para decidir com calma.
        </p>
      </Achado>

      <Achado numero={4} titulo="Produtos com faturamento mas M3_TOTAL = 0" status="nota">
        <p>
          Pendência de dado já conhecida (mesmo problema documentado na Fase 1): quando{' '}
          <code>TPRDCOMPL.M3</code> (fator de conversão) não está cadastrado, o produto gera faturamento
          mas não conta m³ — distorce "R$/m³ vendido" para baixo (mais faturamento, mesmo m³).
        </p>
        {(data?.achado4ProdutosSemM3.length ?? 0) > 0 ? (
          <ul className="list-inside list-disc">
            {(data?.achado4ProdutosSemM3 ?? []).map((p) => (
              <li key={p.produto}>
                {p.produto} — {p.linhas} linhas, {fmtMoeda(p.faturamento)} faturados, 0 m³
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">Nenhum produto com essa inconsistência no período selecionado.</p>
        )}
      </Achado>

      <Achado numero={5} titulo="Diferença residual de ~1,75% no m³ vendido vs Power BI antigo" status="nota">
        <p>
          Ao comparar julho/2026 (categoria Agronegócio) contra o print do painel antigo: Faturamento
          Líquido bateu quase exato (R$ 6.152.823,93 vs R$ 6.153.094,20), mas o m³ vendido líquido de
          devolução (4.967,72) ficou <strong>~88,58 m³ (1,75%) abaixo</strong> do "Total m³ vendido" de
          referência (5.056,30). A fórmula de subtração de devolução foi conferida e bate com a medida DAX
          real — o usuário confirmou que atualizou o Power BI antes do print e mesmo assim a meta não bateu
          em julho, o que motivou esta investigação. Ver Achado 6 abaixo para os registros concretos
          alterados após o fechamento que podem explicar essa diferença.
        </p>
      </Achado>

      <Achado numero={6} titulo="Registros do período alterados no Oracle após o fechamento" status="nota">
        <p>
          Pedido do usuário 2026-08-04: "demonstrar quais os registros foram alterados agora, no detalhe,
          que possam estar impactando a diferença [com o BI]". Lista abaixo toda linha cuja data de venda
          cai no período selecionado acima, mas que foi criada/editada no Oracle <strong>depois</strong> da
          data final do período (<code>{data?.period?.to ? fmtDateBR(data.period.to) : '—'}</code>) —
          candidatas a explicar divergência com um relatório externo gerado antes dessas correções tardias.
          Não é um histórico de mudanças (não temos o valor antigo), só a foto atual do Oracle com a data da
          última edição.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Registros alterados após o fechamento</p>
            <p className="font-semibold">{fmt(data?.achado5RegistrosAlteradosAposFechamento.total ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Valor bruto envolvido</p>
            <p className="font-semibold">{fmtMoeda(data?.achado5RegistrosAlteradosAposFechamento.valorTotal ?? 0)}</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <SortableTable
            columns={
              [
                { key: 'recModificadoEm', label: 'Alterado em', sortValue: (r) => r.recModificadoEm, render: (r) => fmtDataHoraBR(r.recModificadoEm) },
                { key: 'data', label: 'Data da venda', sortValue: (r) => r.data, render: (r) => fmtDateBR(r.data) },
                { key: 'distribuidor', label: 'Distribuidor', sortValue: (r) => r.distribuidor, render: (r) => r.distribuidor },
                { key: 'cliente', label: 'Cliente', sortValue: (r) => r.cliente, render: (r) => r.cliente },
                { key: 'produto', label: 'Produto', sortValue: (r) => r.produto, render: (r) => <span className="text-xs">{r.produto}</span> },
                { key: 'tipoMovimento', label: 'Tipo', sortValue: (r) => r.tipoMovimento, render: (r) => r.tipoMovimento },
                { key: 'quantidade', label: 'Qtd', align: 'right', sortValue: (r) => r.quantidade, render: (r) => fmt(r.quantidade, 2) },
                { key: 'valorBruto', label: 'Valor bruto', align: 'right', sortValue: (r) => r.valorBruto, render: (r) => fmtMoeda(r.valorBruto) },
              ] as SortableColumn<RegistroAlterado>[]
            }
            rows={data?.achado5RegistrosAlteradosAposFechamento.registros ?? []}
            rowKey={(r, i) => `${r.data}-${r.cliente}-${r.produto}-${i}`}
            defaultSortKey="recModificadoEm"
            emptyMessage="Nenhum registro do período foi alterado após o fechamento."
          />
        </div>
        {(data?.achado5RegistrosAlteradosAposFechamento.total ?? 0) > 200 && (
          <p className="text-xs text-slate-500">
            Mostrando os 200 mais recentes de {fmt(data!.achado5RegistrosAlteradosAposFechamento.total)}.
          </p>
        )}
      </Achado>

      <Achado numero={7} titulo='Distribuidor "TOP TOP" caía silenciosamente em "SEM DISTRIBUIDOR"' status="corrigido">
        <p>
          O usuário reportou "não vi os ajustes pois temos venda da TOP TOP em julho". Causa: o Oracle grava{' '}
          <code>DISTRIBUIDOR = "C00003154 - TOP TOP MADEIRAS TRATADAS - EIRELI - ME"</code> (com espaço entre
          TOP e TOP), mas a regra <code>ABREV_DISTRIBUIDOR</code> comparava contra <code>"TOPTOP"</code> (sem
          espaço, copiado literal do texto do PowerQuery original) — nunca batia. O PowerQuery original só
          funciona porque tem um passo ANTES que remove todos os espaços do campo antes de comparar, passo
          nunca replicado aqui. ~5.045 vendas da TOP TOP desde 2022 (R$22,6 milhões) caíam em "SEM
          DISTRIBUIDOR" em toda tela por distribuidor da Fase 3. Corrigido — abaixo, o distribuidor no
          período selecionado, ao vivo, prova que TOP TOP aparece corretamente agora:
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-2 py-1">Distribuidor</th>
                <th className="px-2 py-1 text-right">Faturamento líquido</th>
                <th className="px-2 py-1 text-right">m³</th>
              </tr>
            </thead>
            <tbody>
              {(data?.achado7PorDistribuidor ?? []).map((d) => (
                <tr
                  key={d.chave}
                  className={`border-t border-slate-100 ${d.chave === 'TOP TOP' || d.chave === 'SEM DISTRIBUIDOR' ? 'bg-emerald-50 font-medium' : ''}`}
                >
                  <td className="px-2 py-1">{d.chave}</td>
                  <td className="px-2 py-1 text-right">{fmtMoeda(d.faturamentoLiquido)}</td>
                  <td className="px-2 py-1 text-right">{fmt(d.m3Total, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Achado>

      <Achado numero={8} titulo='Linhas duplicadas perdidas no sync — chave primária incompleta ("NSEQITMMOV")' status="corrigido">
        <p>
          Comparando um export real de julho do Power BI (fornecido pelo usuário) produto a produto, 9
          produtos MOURÃO apareciam com m³ menor no painel do que no BI, somando exatamente os ~88,58 m³ que
          faltavam no total do mês. Rodando a mesma consulta direto no Oracle (fora do cache), o valor já
          batia com o BI — o problema era o CACHE incompleto, não a lógica da consulta.
        </p>
        <p>
          Causa: <code>RM.TITMMOV.NSEQITMMOV</code> (sequência do item dentro da NF) nunca foi trazido.
          Quando o MESMO produto aparece 2x na MESMA NF com preço/quantidade diferentes — exemplo real
          encontrado, NF <code>0000085280</code>, produto "2,80 X 14 - 16 - MOURÃO (ESTICADOR)...":
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="px-2 py-1">NSEQITMMOV</th>
                <th className="px-2 py-1 text-right">Quantidade</th>
                <th className="px-2 py-1 text-right">Preço unitário</th>
                <th className="px-2 py-1 text-right">Valor líquido</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="px-2 py-1">2</td>
                <td className="px-2 py-1 text-right">10</td>
                <td className="px-2 py-1 text-right">{fmtMoeda(61.41)}</td>
                <td className="px-2 py-1 text-right">{fmtMoeda(614.1)}</td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="px-2 py-1">3</td>
                <td className="px-2 py-1 text-right">19</td>
                <td className="px-2 py-1 text-right">{fmtMoeda(85.2)}</td>
                <td className="px-2 py-1 text-right">{fmtMoeda(1618.8)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Nossa chave primária (<code>CODCOLIGADA,CODFILIAL,IDMOV,CODIGOPRD</code>) não diferenciava as duas
          linhas — o upsert do sync descartava uma. Em julho: 24 de 1.143 linhas perdidas (2,1%), a mesma
          escala da divergência. <strong>Corrigido</strong>: <code>NSEQITMMOV</code> adicionado à consulta e
          à chave primária, watermark resetado, resync completo (52.238 linhas, +628 recuperadas em todo o
          histórico desde 2022, não só julho). Conferido de novo: 0 de 70 produtos divergentes.
        </p>
      </Achado>

      <Achado numero={9} titulo='Coluna "NFs" da aba Melhor Carga contava itens de produto, não notas fiscais' status="corrigido">
        <p>
          O usuário viu uma carga com "NFs: 10" e 10 produtos diferentes no detalhe e estranhou ("não cabe
          na carga todos estes produtos"). Exemplo real: placa <code>BWT1B07</code>, 22/07/2026 — essa carga
          é <strong>1 única NF</strong> (nota 0000085280) com 10 linhas de produtos diferentes, perfeitamente
          normal para uma NF de Mourão com vários diâmetros/tamanhos. O campo <code>numLinhas</code> sempre
          contou LINHAS/ITENS de produto (só "certo" por coincidência quando cada NF tem 1 produto só), não o
          número de NFs distintas — isso também inflava o card "Cargas com 2+ notas (RodoTrem/Rodocaçamba)":
          mostrava 212 cargas em julho, quando na verdade só 27 têm 2 NFs de verdade (distribuição real:
          265×1 NF / 27×2 NFs, nenhuma com 3+). <strong>Corrigido</strong>: novo campo <code>Carga.notas</code>{' '}
          (agrupado por NF real), coluna "NFs" mostra a contagem certa, nova coluna "Itens" para o que antes
          era chamado (errado) de NFs, e o detalhe expansível agora agrupa os produtos por NF individual.
        </p>
      </Achado>

      <Achado numero={10} titulo='PRECO_BASE usava a classificação por CODTMV em vez do flag bruto BONIFICACAO' status="corrigido">
        <p>
          Depois do Achado 8, sobrou uma diferença menor (~2%, R$123 mil em julho) só na receita — o m³ já
          batia exato. Causa: a fórmula original de <code>preco_base</code> (colada na nota Fase 3) usa o
          flag BRUTO <code>[BONIFICACAO]</code> (de <code>TMOVCOMPL</code>), não o <code>TipoMovimento</code>/
          CODTMV que o painel usava em tudo: <em>se BONIFICACAO="NAO" então PRECO_VENDIDO, senão
          PRECO_MEDIO_TABELA4</em>. No período selecionado, ao vivo:
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Linhas com desconto embutido</p>
            <p className="font-semibold">{fmt(data?.achado10FlagBonificacaoSemCodtmv.transacoes ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Com preço vendido (antigo, errado)</p>
            <p className="font-semibold">{fmtMoeda(data?.achado10FlagBonificacaoSemCodtmv.valorComPrecoVendido ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Com preço base (corrigido)</p>
            <p className="font-semibold">{fmtMoeda(data?.achado10FlagBonificacaoSemCodtmv.valorComPrecoBase ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-700">Diferença que estava inflando o faturamento</p>
            <p className="font-semibold text-red-800">{fmtMoeda(data?.achado10FlagBonificacaoSemCodtmv.diferenca ?? 0)}</p>
          </div>
        </div>
        {(data?.achado10FlagBonificacaoSemCodtmv.exemplos.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1">Data</th>
                  <th className="px-2 py-1">Distribuidor</th>
                  <th className="px-2 py-1">Cliente</th>
                  <th className="px-2 py-1">Produto</th>
                  <th className="px-2 py-1 text-right">Preço vendido</th>
                  <th className="px-2 py-1 text-right">Tabela preço base</th>
                </tr>
              </thead>
              <tbody>
                {data!.achado10FlagBonificacaoSemCodtmv.exemplos.map((e, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1">{fmtDateBR(e.data)}</td>
                    <td className="px-2 py-1">{e.distribuidor}</td>
                    <td className="px-2 py-1">{e.cliente}</td>
                    <td className="px-2 py-1">{e.produto}</td>
                    <td className="px-2 py-1 text-right">{fmtMoeda(e.precoVendido)}</td>
                    <td className="px-2 py-1 text-right">{fmtMoeda(e.precoMedioTabela4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">
          <strong>Corrigido</strong> em <code>agregarVendas</code>/<code>agruparCargas</code> (faturamento
          bruto/líquido/R$ por m³, igual ao "Fat. Bruto Venda" do BI) — <code>valorBruto</code> (preço
          realmente cobrado) continua intacto onde a pergunta é "quanto o cliente pagou de fato" (abaixo da
          tabela preço base, dispersão de preço, histórico de cliente). Resultado: todos os números da Fase 3 batem
          exato com o BI agora (Fat. Bruto Venda, Faturamento Líquido, m³, Valor M3 Vendido, Meta Destino, e
          as 3 alíquotas de ICMS).
        </p>
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <strong>Decisão pendente</strong>: a aba "Bonificações" (destino de bonificações) e a análise
          "abaixo da tabela preço base" continuam usando <code>bonificacaoOriginal</code> (CODTMV=2.2.48), não esse
          flag bruto. As {fmt(data?.achado10FlagBonificacaoSemCodtmv.transacoes ?? 0)} linhas acima têm
          desconto embutido mas NÃO aparecem hoje na aba Bonificações nem são excluídas da análise "abaixo da
          tabela preço base" (já que são "Vendas" pelo CODTMV). Quer que essas linhas passem a contar como bonificação
          também nessas duas telas, ou faz sentido mantê-las separadas (um desconto comercial numa venda
          normal é diferente de uma bonificação formal, mesmo que o preço_base contábil trate os dois igual)?
        </p>
      </Achado>

      <Achado
        numero={11}
        titulo="Cotas cadastradas x meta de volume do mês"
        status={
          !data?.achado11CotasVsMetaVolume.temCadastro
            ? 'nota'
            : Math.abs(data.achado11CotasVsMetaVolume.diferencaVolumePct ?? 0) > 5
              ? 'em-aberto'
              : 'corrigido'
        }
      >
        <p>
          Pedido do usuário 2026-08-13: verificar se a soma das cotas por produto (em m³, só produtos com
          fator m³/unidade cadastrado) bate com a meta de volume total do mês em{' '}
          <code>Cadastros → Cotas de venda</code>. Mês verificado:{' '}
          <strong>{data?.achado11CotasVsMetaVolume.mes ?? '—'}</strong>.
        </p>
        {!data?.achado11CotasVsMetaVolume.temCadastro ? (
          <p className="text-slate-500">Nenhuma cota cadastrada para este mês ainda — nada para conferir.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">Meta de volume do mês</p>
                <p className="font-semibold">{fmt(data.achado11CotasVsMetaVolume.metaVolumeM3, 0)} m³</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">Soma das cotas por produto (m³)</p>
                <p className="font-semibold">{fmt(data.achado11CotasVsMetaVolume.somaM3ProdutosCadastrados, 0)} m³</p>
              </div>
              <div
                className={`rounded-lg border p-3 ${
                  Math.abs(data.achado11CotasVsMetaVolume.diferencaVolumePct ?? 0) > 5
                    ? 'border-red-200 bg-red-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <p className={`text-xs ${Math.abs(data.achado11CotasVsMetaVolume.diferencaVolumePct ?? 0) > 5 ? 'text-red-700' : 'text-slate-500'}`}>
                  Diferença
                </p>
                <p className={`font-semibold ${Math.abs(data.achado11CotasVsMetaVolume.diferencaVolumePct ?? 0) > 5 ? 'text-red-800' : ''}`}>
                  {data.achado11CotasVsMetaVolume.diferencaVolumePct != null
                    ? `${data.achado11CotasVsMetaVolume.diferencaVolumePct > 0 ? '+' : ''}${fmt(data.achado11CotasVsMetaVolume.diferencaVolumePct, 1)}%`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">Soma % ICMS (7+12+18)</p>
                <p className={`font-semibold ${Math.abs((data.achado11CotasVsMetaVolume.somaIcmsPct ?? 100) - 100) > 0.1 ? 'text-red-700' : ''}`}>
                  {data.achado11CotasVsMetaVolume.somaIcmsPct != null ? `${fmt(data.achado11CotasVsMetaVolume.somaIcmsPct, 1)}%` : '—'}
                </p>
              </div>
            </div>
            {data.achado11CotasVsMetaVolume.produtosSemFatorM3 > 0 && (
              <p className="text-xs text-amber-700">
                {data.achado11CotasVsMetaVolume.produtosSemFatorM3} de {data.achado11CotasVsMetaVolume.produtosCadastrados} produto(s)
                cadastrado(s) neste mês não têm fator m³/unidade — não entram na soma acima, o que pode explicar parte da diferença.
              </p>
            )}
            {Math.abs(data.achado11CotasVsMetaVolume.diferencaVolumePct ?? 0) > 5 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                As cotas por produto cadastradas não somam a meta de volume total do mês (diferença acima de 5%). Ajuste as
                cotas por produto ou a meta de volume em <code>Cadastros → Cotas de venda</code> para os dois ficarem
                consistentes.
              </p>
            )}
          </>
        )}
      </Achado>

      <Achado
        numero={12}
        titulo="Nota de venda de madeira tratada com placa já em Tritrem Florestal"
        status={data && data.achado12NotaVendaAposTritrem.transacoes > 0 ? 'em-aberto' : 'nota'}
      >
        <p>
          Pedido do usuário 2026-09-08: mesma verificação já feita no Fase 1 (&ldquo;nota_apos_tritrem&rdquo;), agora contra a
          venda de madeira tratada — não existe fonte própria de nota de transporte interno de madeira ainda, então
          isto só sinaliza quando uma placa do Tri-Trem Florestal aparece indevidamente numa nota de venda comercial.
        </p>
        {!data || data.achado12NotaVendaAposTritrem.transacoes === 0 ? (
          <p className="text-slate-500">Nenhuma nota encontrada no período para placas do Tri-Trem Florestal.</p>
        ) : (
          <>
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {data.achado12NotaVendaAposTritrem.transacoes} nota(s), {fmtMoeda(data.achado12NotaVendaAposTritrem.valorTotal)} —
              confira se a placa realmente voltou à venda comercial, ou se é erro de nota/cadastro.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Placa</th>
                    <th className="px-2 py-1 text-right">Notas</th>
                    <th className="px-2 py-1">Primeira</th>
                    <th className="px-2 py-1">Última</th>
                    <th className="px-2 py-1 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.achado12NotaVendaAposTritrem.porPlaca.map((p) => (
                    <tr key={p.placa} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono font-medium">{p.placa}</td>
                      <td className="px-2 py-1 text-right">{fmt(p.n)}</td>
                      <td className="px-2 py-1">{fmtDateBR(p.primeira)}</td>
                      <td className="px-2 py-1">{fmtDateBR(p.ultima)}</td>
                      <td className="px-2 py-1 text-right">{fmtMoeda(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Achado>
    </div>
  )
}
