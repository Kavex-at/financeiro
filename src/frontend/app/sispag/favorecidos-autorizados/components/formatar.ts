import type { FavorecidoAutorizado } from '@/lib/sispag'

const TZ = 'America/Sao_Paulo'

export const formatarData = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }) : '—'

export const formatarHora = (iso?: string): string =>
  iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
    : '—'

/** Mesma pessoa, sem diferença de caixa ou espaço (o backend compara o usuário autenticado). */
export const mesmaPessoa = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Reaprovação aberta pelo sistema que ainda ninguém confirmou (F5 pendente). */
export const reaprovacaoSemPedido = (a: FavorecidoAutorizado): boolean =>
  a.estado === 'REAPROVACAO_PENDENTE' && !a.solicitadoPor

/**
 * Selo de conferência (I14l): "igual ao Conexos (lido HH:MM) · igual ao aprovado em DD/MM por X"
 * ou "diferente do aprovado". Só texto; nunca o destino.
 */
export const textoSelo = (a: FavorecidoAutorizado): string => {
  switch (a.ultimaConferenciaResultado) {
    case 'IGUAL':
      return `igual ao Conexos (lido ${formatarHora(a.ultimaConferenciaEm)}) · igual ao aprovado em ${formatarData(a.decididoEm)}${a.decididoPor ? ` por ${a.decididoPor}` : ''}`
    case 'DIFERENTE':
      return `diferente do aprovado (lido ${formatarHora(a.ultimaConferenciaEm)})`
    case 'SEM_DADO':
      return 'sem conta/chave no cadastro do Conexos — pedir ao responsável pelo cadastro do Conexos'
    case 'FALHA_LEITURA':
      return `não foi possível ler o Conexos (${formatarHora(a.ultimaConferenciaEm)})`
    default:
      return 'ainda não conferido com o Conexos'
  }
}
