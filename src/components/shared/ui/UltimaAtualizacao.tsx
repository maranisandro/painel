function formatar(iso: string): string {
  const data = new Date(iso)
  const dataFmt = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const horaFmt = data.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `Dados atualizados em ${dataFmt} às ${horaFmt}`
}

/** Marca de "última atualização de dados" exibida junto ao título de cada painel — pedido do usuário 2026-08-31. */
export function UltimaAtualizacao({ iso, className }: { iso: string | null | undefined; className?: string }) {
  return (
    <p className={`text-xs text-slate-500 ${className ?? ''}`}>
      {iso ? formatar(iso) : 'Ainda sem sincronização'}
    </p>
  )
}
