import type { ChaveTituloGrupo, GrupoBoletoListado, SugestaoGrupoBoleto } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

/**
 * Boleto agrupado (ADR-0077): rótulos em português e as contas da composição manual. Puro e sem
 * React, para ser testado sem render. Dinheiro em CENTAVOS inteiros — nunca float.
 */

/** Aviso que exige reconhecimento explícito; o servidor o confere de novo (I21g). */
export const AVISO_TITULO_VENCE_ANTES_DO_BOLETO = 'TITULO_VENCE_ANTES_DO_BOLETO'

/** Janela por título: `0 ≤ vencimento do boleto − vencimento do título ≤ 10` dias civis (I21g). */
export const JANELA_MAXIMA_DIAS = 10

/** `R$ 1.575,00` a partir de centavos. */
export const formatCentavos = (centavos: number): string => formatBRL(centavos / 100)

const ROTULO_SITUACAO_GRUPO: Record<string, string> = {
  DISPONIVEL: 'Disponível',
  EM_LOTE: 'Em lote',
  EM_REMESSA: 'Em remessa',
  REJEITADO: 'Rejeitado pelo banco',
  RETIDO: 'Retido',
  DIVERGENTE: 'Divergente',
  ORFAO: 'Órfão',
  ANULADO: 'Anulado',
  PAGO: 'Pago',
}

/** Situação derivada do grupo; a desconhecida aparece como veio (nunca some). */
export const rotuloSituacaoGrupo = (situacao: string): string =>
  ROTULO_SITUACAO_GRUPO[situacao] ?? situacao

const ORIENTACAO_SITUACAO_GRUPO: Record<string, string> = {
  REJEITADO: 'Resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo.',
  ORFAO:
    'O boleto saiu do pool ou um título mudou: anule o grupo e confirme de novo, se ainda fizer sentido.',
  DIVERGENTE:
    'Parte dos títulos está paga e parte não: confira o borderô no Conexos antes de qualquer outra ação.',
  RETIDO: 'Um dos títulos está retido: desfaça a retenção para o grupo voltar a ser lotado.',
}

/** O que a analista deve fazer; `undefined` quando a situação não pede ação. */
export const orientacaoSituacaoGrupo = (situacao: string): string | undefined =>
  ORIENTACAO_SITUACAO_GRUPO[situacao]

/**
 * Por que a sugestão não é confirmável. `NAO_LIBERADO` é "aguardando alçada" e `CRUZA_FILIAL` diz
 * que o caso não é suportado (a analista paga à mão).
 */
const ROTULO_MOTIVO_GRUPO: Record<string, string> = {
  MENOS_DE_DOIS_TITULOS: 'um título só segue o caminho de um boleto por título',
  CRUZA_FILIAL: 'não suportado: títulos de filiais diferentes, pagar à mão',
  CREDORES_DIFERENTES: 'os títulos são de credores diferentes',
  BOLETO_VINCULADO_ERP: 'o Conexos já vinculou o boleto a um título',
  BOLETO_EM_DECISAO_1_1: 'o boleto já está confirmado para um título',
  BOLETO_INDISPONIVEL: 'o código de barras do boleto não está disponível',
  CODIGO_INVALIDO: 'o código de barras do boleto é inválido',
  BOLETO_INCONSISTENTE: 'o valor ou o vencimento do código não batem com o DDA',
  DATA_INDISPONIVEL: 'o vencimento do boleto não está disponível',
  PAR_NAO_VIGENTE: 'o emissor do boleto não está confirmado para este credor',
  BOLETO_VENCIDO: 'o boleto vence antes da data de débito',
  VALOR_ABERTO_INDISPONIVEL: 'o valor em aberto de algum título não está disponível',
  SOMA_DIFERENTE: 'a soma dos títulos é diferente do valor do boleto',
  NAO_LIBERADO: 'aguardando alçada',
  PAGO: 'um título já está pago',
  INATIVO: 'um título saiu da carteira',
  FORMA_NAO_BOLETO: 'um título não é pago por boleto no Conexos',
  TEM_BOLETO_ERP: 'o Conexos já associou um boleto DDA a um título',
  DECISAO_1_1_CONFIRMADA: 'um título já tem um boleto confirmado',
  MARCA_RETENCAO_ATIVA: 'um título está retido (duplicidade ou retirada ativa)',
  EM_LOTE_COMPROMETIDO: 'um título está em lote finalizado ou com remessa gerada',
  EM_OUTRO_GRUPO: 'um título já está em outro grupo confirmado',
  FORA_DA_JANELA: 'um título vence fora da janela de 10 dias do boleto',
}

export const rotuloMotivoGrupo = (motivo: string): string => ROTULO_MOTIVO_GRUPO[motivo] ?? motivo

/** Os motivos, sem repetir e na ordem recebida, separados por `; `. */
export const resumoMotivosGrupo = (motivos: readonly string[]): string =>
  [...new Set(motivos)].map(rotuloMotivoGrupo).join('; ')

/** Uma linha: K boletos iguais para títulos de mesmo valor (I21f). */
export const EXPLICACAO_INTERCAMBIAVEL =
  'Há boletos iguais para estes títulos: a divisão é fixa e você confirma cada grupo.'

/** Soma ao vivo da composição manual, em centavos inteiros. */
export interface SomaComposicao {
  somaCentavos: number
  /** Soma dos títulos − valor do boleto, com sinal. */
  diferencaCentavos: number
  fecha: boolean
}

export const somarComposicao = (
  titulosCentavos: readonly number[],
  valorBoletoCentavos: number,
): SomaComposicao => {
  const somaCentavos = titulosCentavos.reduce((acc, c) => acc + Math.round(c), 0)
  const diferencaCentavos = somaCentavos - valorBoletoCentavos
  return { somaCentavos, diferencaCentavos, fecha: diferencaCentavos === 0 }
}

const DIA_MS = 24 * 60 * 60 * 1000

/** Dias civis entre duas datas `YYYY-MM-DD` (b − a). */
const diasEntre = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS)

export interface AvaliacaoTituloComposicao {
  /** Vencimento do boleto − vencimento do título, em dias civis. */
  deltaDias: number
  foraDaJanela: boolean
  /** Título vence ANTES do boleto, dentro da janela: exige reconhecimento (aviso I21g). */
  venceAntesDoBoleto: boolean
  motivoForaDaJanela?: string
}

export const avaliarTituloNaComposicao = (p: {
  vencimentoBoleto: string
  vencimentoTitulo: string
}): AvaliacaoTituloComposicao => {
  const deltaDias = diasEntre(p.vencimentoTitulo, p.vencimentoBoleto)
  if (deltaDias < 0) {
    return {
      deltaDias,
      foraDaJanela: true,
      venceAntesDoBoleto: false,
      motivoForaDaJanela: 'vence depois do boleto',
    }
  }
  if (deltaDias > JANELA_MAXIMA_DIAS) {
    return {
      deltaDias,
      foraDaJanela: true,
      venceAntesDoBoleto: false,
      motivoForaDaJanela: `vence mais de ${JANELA_MAXIMA_DIAS} dias antes do boleto`,
    }
  }
  return { deltaDias, foraDaJanela: false, venceAntesDoBoleto: deltaDias > 0 }
}

/** Chave `fil:doc:tit` de um título, a mesma que o painel e a aba de títulos usam. */
const chaveDoTitulo = (t: { filCod: number; docCod: string; titCod: string }): string =>
  `${t.filCod}:${t.docCod}:${t.titCod}`

/** Os títulos dos grupos CONFIRMADOS (o anulado libera os seus). */
export const chavesDeTitulosEmGrupo = (
  grupos: ReadonlyArray<{
    estado: string
    titulos: ReadonlyArray<{ filCod: number; docCod: string; titCod: string }>
  }>,
): Set<string> =>
  new Set(grupos.filter((g) => g.estado === 'CONFIRMADO').flatMap((g) => g.titulos.map(chaveDoTitulo)))

export const tituloEmGrupo = (
  chaves: ReadonlySet<string>,
  t: { filCod: number; docCod: string; titCod: string },
): boolean => chaves.has(chaveDoTitulo(t))


// ── I21v — o grupo de um título ou de um boleto (gaveta e aba Boletos DDA) ───────────────────

/** O que a filial tem: sugestões calculadas e grupos confirmados. */
export interface GruposDaFilial {
  sugestoes: SugestaoGrupoBoleto[]
  grupos: GrupoBoletoListado[]
}

export type GrupoEncontrado =
  | { tipo: 'SUGERIDO'; sugestao: SugestaoGrupoBoleto }
  | { tipo: 'CONFIRMADO'; grupo: GrupoBoletoListado }

const mesmoTitulo = (a: ChaveTituloGrupo, b: ChaveTituloGrupo): boolean =>
  a.filCod === b.filCod && a.docCod === b.docCod && a.titCod === b.titCod

/** Grupo `CONFIRMADO` que contém o título; senão a sugestão que o contém. O confirmado vence. */
export const grupoDoTitulo = (
  g: GruposDaFilial,
  chave: ChaveTituloGrupo,
): GrupoEncontrado | undefined => {
  const grupo = g.grupos.find(
    (x) => x.estado === 'CONFIRMADO' && x.titulos.some((t) => mesmoTitulo(t, chave)),
  )
  if (grupo) return { tipo: 'CONFIRMADO', grupo }
  const sugestao = g.sugestoes.find((x) => x.titulos.some((t) => mesmoTitulo(t, chave)))
  return sugestao ? { tipo: 'SUGERIDO', sugestao } : undefined
}

/** Grupo do boleto (`ddcCod`+`ditCod`): o confirmado vence a sugestão. */
export const grupoDoBoleto = (
  g: GruposDaFilial,
  ddcCod: number,
  ditCod: number,
): GrupoEncontrado | undefined => {
  const grupo = g.grupos.find(
    (x) => x.estado === 'CONFIRMADO' && x.ddcCod === ddcCod && x.ditCod === ditCod,
  )
  if (grupo) return { tipo: 'CONFIRMADO', grupo }
  const sugestao = g.sugestoes.find((x) => x.ddcCod === ddcCod && x.ditCod === ditCod)
  return sugestao ? { tipo: 'SUGERIDO', sugestao } : undefined
}
