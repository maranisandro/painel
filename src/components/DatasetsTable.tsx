'use client'

import { useState } from 'react'
import { SyncAllButton } from './SyncAllButton'
import { DatasetRow } from './DatasetRow'

interface DatasetItem {
  id: string
  name: string
  code: string
  query: string
  dataSourceName: string
  dataSourceType: string
  incrementalField: string | null
  watermark: string | null
  intervalMinutes: number | null
  scheduleEnabled: boolean
  rowsCount: number
  lastRun: { status: string; startedAt: string; error: string | null } | null
}

/**
 * Coordena a sincronização entre "Sincronizar tudo" e os botões individuais
 * por dataset — pedido do usuário 2026-08-13: "colocar um botão para
 * atualizar cada fonte individual, caso eu clique em uma fonte para
 * atualizar desabilite outras fontes". `syncingId` guarda QUAL sincronização
 * está rodando (o id do dataset, ou `'ALL'` para o botão geral) — enquanto
 * algo está rodando, todo o resto fica desabilitado (evita disparar duas
 * sincronizações ao mesmo tempo pela tela, complementando o advisory lock
 * que já existe no backend).
 */
export function DatasetsTable({ datasets }: { datasets: DatasetItem[] }) {
  const [syncingId, setSyncingId] = useState<string | null>(null)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Fontes de Dados e Datasets</h1>
        <SyncAllButton
          disabled={syncingId !== null && syncingId !== 'ALL'}
          onSyncStart={() => setSyncingId('ALL')}
          onSyncEnd={() => setSyncingId(null)}
        />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        "Sincronizar tudo" roda todos os datasets ativos em ordem (referências primeiro); cada linha
        também tem um botão para sincronizar só aquele dataset. Só uma sincronização por vez pela tela —
        os outros botões ficam desabilitados enquanto uma está em andamento.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3">Dataset</th>
              <th className="px-4 py-3">Fonte</th>
              <th className="px-4 py-3">Incremental</th>
              <th className="px-4 py-3">Agenda</th>
              <th className="px-4 py-3">Linhas em cache</th>
              <th className="px-4 py-3">Última execução</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <DatasetRow
                key={d.id}
                {...d}
                disabled={syncingId !== null && syncingId !== d.id}
                onSyncStart={() => setSyncingId(d.id)}
                onSyncEnd={() => setSyncingId(null)}
              />
            ))}
            {datasets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Nenhum dataset cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
