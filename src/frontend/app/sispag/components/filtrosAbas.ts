import type { OpcoesFiltroExtra } from '@/app/permutas/components/tabela-filtro'
import {
  type ArquivoRetorno,
  type ChaveTitulo,
  formaDePagamento,
  type LotePagamento,
  type LoteSispag,
  ORDEM_FORMA_DE_PAGAMENTO,
  type TituloAPagar,
} from '@/lib/sispag'
import { diaDoPrazo } from '../situacao/prazoTitulo'
import { diaDoErp, diaEmBrasilia } from './filtroDatas'

/**
 * Qual data o de/até filtra em cada aba do SISPAG, e como extraí-la. Tudo aqui é o que o usuário
 * decidiu para o filtro de datas (ver `ontology/_inbox/sispag-filtros-data-boleto-tasks.md`); o
 * rótulo vai para a barra para que a analista nunca precise adivinhar qual data está filtrando.
 */
export const ROTULO_DATA = {
  titulos: 'Vencimento',
  candidatos: 'Vencimento',
  finalizados: 'Remessa gerada',
  /** `flpDtaCredito` — a única data que o `fin015/list` devolve para o lote nativo. */
  rem: 'Data de crédito',
  retornos: 'Recebido em',
} as const

/** Dica dos chips de boleto nos lotes: como um lote misto é tratado. */
export const TITULO_BOLETO_LOTE =
  'Boleto: lotes com ao menos um título com boleto. Sem boleto: lotes com ao menos um título sem boleto. Um lote misto aparece nos dois.'

const chave = (c: ChaveTitulo) => `${c.filCod}:${c.docCod}:${c.titCod}`

/**
 * Títulos a pagar: vencimento (dia ERP) e a forma de pagamento — a mesma da coluna, com BOLETO
 * dividido em com/sem DDA. Um chip por forma presente na carteira.
 */
export const filtroTitulos: OpcoesFiltroExtra<TituloAPagar> = {
  // I19t: o prazo efetivo (boleto sugerido ou título) no lugar do vencimento isolado.
  getDatas: (t) => [diaDoPrazo(t)],
  getCategoria: (t) => {
    const { chave, rotulo } = formaDePagamento(t)
    return { chave, rotulo }
  },
  ordemCategorias: ORDEM_FORMA_DE_PAGAMENTO,
}

/** Dica visível sob os chips de forma de pagamento dos títulos. */
export const DICA_FORMA_PAGAMENTO =
  'Boleto sem DDA: o Conexos marca o título como boleto, mas o boleto DDA não casou (valor ou vencimento diferente) — a remessa sairia sem código de barras.'

/**
 * Títulos visíveis na aba conforme o filtro de comprometidos. Título em lote FINALIZADO ou com
 * remessa gerada (ADR-0064) não é selecionável nem se move — por padrão fica fora da tabela de
 * trabalho, e o botão com a contagem o traz de volta.
 */
export const titulosVisiveis = (
  titulos: TituloAPagar[],
  mostrarComprometidos: boolean,
): TituloAPagar[] => (mostrarComprometidos ? titulos : titulos.filter((t) => !t.loteComprometido))

/**
 * Lotes candidatos: o lote passa no de/até se QUALQUER item vence no intervalo. Um item tem boleto
 * se a carteira diz que o título tem boleto DDA (`comBoleto`, chaves `fil:doc:tit`) ou se a
 * modalidade escolhida no lote já é BOLETO — o item não carrega o flag da carteira, e um título
 * fora da carteira carregada (lista cortada) ainda é reconhecido pela modalidade.
 */
export const filtroCandidatos = (comBoleto: ReadonlySet<string>): OpcoesFiltroExtra<LotePagamento> => ({
  getDatas: (l) => l.itens.map((i) => diaDoErp(i.vencimento)),
  getBoleto: (l) => l.itens.map((i) => i.modalidade === 'BOLETO' || comBoleto.has(chave(i))),
})

/** Chaves dos títulos com boleto DDA na carteira — insumo de `filtroCandidatos`. */
export const chavesComBoleto = (titulos: TituloAPagar[]): Set<string> =>
  new Set(titulos.filter((t) => t.temBoleto === true).map(chave))

/** Finalizados: dia (Brasília) em que a remessa foi gerada; sem remessa, o da finalização. */
export const filtroFinalizados: OpcoesFiltroExtra<LotePagamento> = {
  getDatas: (l) => [diaEmBrasilia(l.remessaGeradaEm ?? l.finalizadoEm)],
}

/** Lançamento Lote (REM) — lote nativo do fin015: data de crédito (dia ERP). */
export const filtroLotesNativos: OpcoesFiltroExtra<LoteSispag> = {
  getDatas: (l) => [diaDoErp(l.dataCredito)],
}

/** Retorno (.RET): dia (Brasília) em que o arquivo entrou no fin052; sem ele, o do processamento. */
export const diaDoRetorno = (r: ArquivoRetorno): string | undefined =>
  diaEmBrasilia(r.cadastradoEm ?? r.processadoEm)

export const filtroRetornos: OpcoesFiltroExtra<ArquivoRetorno> = {
  getDatas: (r) => [diaDoRetorno(r)],
}

/** `YYYY-MM-DD` → `DD/MM/YYYY` por split (sem `new Date`, que trocaria o dia pelo fuso). */
export const formatarDia = (dia?: string): string => {
  if (!dia) return '—'
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}
