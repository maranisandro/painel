import type { SessionUser } from '@/lib/authz'
import type { VendaLinha } from './faturamento'

/**
 * Restringe `linhas` ao escopo de distribuidor/cliente do usuário — pedido
 * do usuário 2026-09-11: "não pode ser por filtro de URL, tem que ser
 * inserido em código para evitar qualquer falha de segurança". Deve ser
 * chamado logo após `prepararVendas`, ANTES de qualquer filtro vindo de
 * query string, em toda rota da Fase 3 que retorna linha de venda.
 * `escopo` nulo (ADMIN ou usuário sem nenhum vínculo) não filtra nada — a
 * restrição é uma exceção explícita, nunca o padrão. Com vínculo, é união
 * (OR): a linha passa se bater com QUALQUER distribuidor OU QUALQUER
 * cliente vinculado.
 */
export function aplicarEscopoUsuario(linhas: VendaLinha[], escopo: SessionUser['escopoVendas']): VendaLinha[] {
  if (!escopo) return linhas
  return linhas.filter((l) => escopo.distribuidores.includes(l.distribuidor) || escopo.clientes.includes(l.cliente))
}
