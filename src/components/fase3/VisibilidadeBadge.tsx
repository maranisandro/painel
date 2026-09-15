'use client'

export type Visibilidade = 'admin' | 'interno' | 'externo'

const ESTILO: Record<Visibilidade, string> = {
  admin: 'bg-purple-100 text-purple-700',
  interno: 'bg-sky-100 text-sky-700',
  externo: 'bg-emerald-100 text-emerald-700',
}

const LABEL: Record<Visibilidade, string> = {
  admin: 'admin',
  interno: 'interno',
  externo: 'externo',
}

const TITULO: Record<Visibilidade, string> = {
  admin: 'Visível só para ADMIN',
  interno: 'Visível só para usuário interno (sem restrição de distribuidor/cliente)',
  externo: 'Visível também para o futuro usuário externo (distribuidor/cliente)',
}

/**
 * Selo de visibilidade por perfil de usuário — pedido do usuário 2026-09-14:
 * "igual foi feito a marcação no card do que é visível para o admin queria
 * que colocasse mais dois label, o que é visto interno / externo e admin,
 * os externos serão quando criarmos os usuários que terão a acessos
 * específicos de distribuidor e/ou cliente". Hoje só existem usuários ADMIN
 * e usuários internos (com ou sem `escopoVendas`); "externo" é o desenho do
 * próximo tipo de usuário (login de distribuidor/cliente), ainda não criado
 * — o selo é só documentação visual por enquanto, não um controle de acesso
 * novo. A classificação de cada card/tabela segue a regra JÁ aplicada hoje
 * no backend:
 *  - `admin`: campo zerado pro resto no backend (`isAdmin`, ver
 *    /api/fase3/data e /api/fase3/estrategico)
 *  - `interno`: dado calculado só quando `user.escopoVendas == null`
 *    (`comparativoCotas`), ou dado que vem de uma lista GLOBAL não filtrada
 *    pelo escopo do usuário (ex. `DISTRIBUIDORES_CONHECIDOS`) — vazaria
 *    nome de outro distribuidor/cliente pro futuro usuário externo
 *  - `externo`: o resto — já vem das MESMAS `linhas` filtradas por
 *    `aplicarEscopoUsuario` (união de distribuidor/cliente do usuário), sem
 *    depender de mais nada global
 */
export function VisibilidadeBadge({ nivel }: { nivel: Visibilidade }) {
  return (
    <span title={TITULO[nivel]} className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${ESTILO[nivel]}`}>
      {LABEL[nivel]}
    </span>
  )
}
