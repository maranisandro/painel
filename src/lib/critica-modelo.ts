/**
 * Aba "Crítica ao modelo" — mecanismo genérico de reconhecimento de achados,
 * usado pela Fase 1 (combustível/transporte) e agora pela Fase 3 (venda de
 * madeira tratada). Pedido do usuário 2026-08-05 (Fase 1): "cada problema
 * deve ter o reconhecimento formal, ou até mesmo ajuste na origem". Extraído
 * aqui pra Fase 3 reusar a mesma mecânica sem duplicar a lógica de merge com
 * status (já repetida em `/api/fase1/critica` e `/api/abastecimento/critica`).
 *
 * Os achados são RECALCULADOS AO VIVO a cada carregamento (não gravados) —
 * só o STATUS de tratamento é persistido (`CriticaModeloAchado`), casado
 * pela `chave` estável que a função de detecção de cada módulo gera.
 */
import { prisma } from '@/lib/prisma'

export interface AchadoDetectado {
  categoria: string
  chave: string
  titulo: string
  descricao: string
}

export interface AchadoComStatus extends AchadoDetectado {
  status: string
  reconhecidoPor: string | null
  reconhecidoEm: string | null
  motivo: string | null
}

/**
 * `aberto` nunca é gravado (é o padrão quando não há registro) — pedido do
 * usuário 2026-09-10 (Fase 3): além de `reconhecido`/`encaminhado_origem` (já
 * usados na Fase 1), `resolvido` some da lista padrão da crítica (o usuário
 * ainda consegue ver resolvidos filtrando por status explicitamente).
 */
export const STATUS_ACHADO_VALIDOS = ['reconhecido', 'encaminhado_origem', 'resolvido']

/** Casa os achados detectados AO VIVO com o status persistido (por `modulo`+`chave`). */
export async function mesclarComStatusAchados(modulo: string, detectados: AchadoDetectado[]): Promise<AchadoComStatus[]> {
  const registros = await prisma.criticaModeloAchado.findMany({ where: { modulo } })
  const registroPorChave = new Map(registros.map((r) => [r.chave, r]))
  return detectados.map((a) => {
    const registro = registroPorChave.get(a.chave)
    return {
      ...a,
      status: registro?.status ?? 'aberto',
      reconhecidoPor: registro?.reconhecidoPor ?? null,
      reconhecidoEm: registro?.reconhecidoEm?.toISOString() ?? null,
      motivo: registro?.motivo ?? null,
    }
  })
}
