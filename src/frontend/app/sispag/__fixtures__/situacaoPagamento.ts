import {
  ACAO_PAGAMENTO,
  type AcaoPagamento,
  DONO_PAGAMENTO,
  type DonoPagamento,
  ESTADO_PAGAMENTO,
  type MotivoPagamento,
  MOTIVO_PAGAMENTO,
  type ResumoSituacao,
  type SituacaoPagamento,
  type TituloAPagar,
} from '@/lib/sispag'

/**
 * Carteira de exemplo do rascunho aprovado (mockup v4, 20/10/2026) no formato do contrato. É a
 * base dos testes da aba de títulos com situação de pagamento; não é dado de produção.
 */

/** Dia de referência dos fixtures. */
export const HOJE_FIXTURE = Date.UTC(2026, 9, 20)
const DIA = 86_400_000

const pronto = (): SituacaoPagamento => ({ estado: ESTADO_PAGAMENTO.PRONTO, motivos: [] })

const bloqueado = (
  motivo: MotivoPagamento,
  rotulo: string,
  dono: DonoPagamento,
  codigo: AcaoPagamento,
  acaoRotulo: string,
  detalhe?: string,
): SituacaoPagamento => ({
  estado: ESTADO_PAGAMENTO.BLOQUEADO,
  motivos: [motivo],
  principal: motivo,
  rotulo,
  dono,
  acao: { codigo, rotulo: acaoRotulo },
  ...(detalhe ? { detalhe } : {}),
})

const titulo = (
  docCod: string,
  credor: string,
  valor: number,
  dias: number,
  filCod: number,
  situacaoPagamento: SituacaoPagamento,
  extra: Partial<TituloAPagar> = {},
): TituloAPagar => ({
  docCod,
  titCod: '1',
  filCod,
  credor,
  valor,
  vencimento: HOJE_FIXTURE + dias * DIA,
  diasAteVencimento: dias,
  liberado: true,
  pago: false,
  formaPagamentoConexos: 6,
  temBoleto: true,
  situacaoPagamento,
  ...extra,
})

/** 9 prontos + 9 bloqueados (um por motivo; dois vencidos, dois que vencem hoje). */
export const TITULOS_FIXTURE: TituloAPagar[] = [
  titulo('116', 'NELSON HEUSI', 462.49, 2, 1, pronto()),
  titulo('5521', 'MULTILOG', 12840, 0, 1, pronto()),
  titulo('5530', 'CEVA LOGISTICS', 8210.35, 5, 1, pronto()),
  titulo('5534', 'TRANSLOG SUL', 15300, 3, 7, pronto(), { formaPagamentoConexos: 8, temBoleto: false }),
  titulo('5537', 'PORTO SECO NORTE', 6120.8, 4, 7, pronto(), { formaPagamentoConexos: 8, temBoleto: false }),
  titulo('5541', 'ARMAZÉNS ATLAS', 9840, 6, 1, pronto()),
  titulo('5560', 'FRIGORÍFICO VALE', 21700, 9, 3, pronto()),
  titulo('5562', 'GRÁFICA PONTO', 780, 12, 3, pronto(), { formaPagamentoConexos: 8, temBoleto: false }),
  titulo('5570', 'SEGUROS MARÍTIMOS', 34500, 7, 7, pronto()),
  titulo(
    '5544',
    'JOMED',
    1920,
    0,
    1,
    bloqueado(
      MOTIVO_PAGAMENTO.BOLETO_SEM_DDA,
      'Boleto sem DDA',
      DONO_PAGAMENTO.VOCE,
      ACAO_PAGAMENTO.VER_BOLETO,
      'Ver boleto',
      'nenhum boleto no pool',
    ),
    { temBoleto: false },
  ),
  titulo(
    '5502',
    'LOGÍSTICA BETA',
    5210,
    0,
    1,
    bloqueado(
      MOTIVO_PAGAMENTO.DUPLICIDADE,
      'Possível duplicidade',
      DONO_PAGAMENTO.VOCE,
      ACAO_PAGAMENTO.TRATAR_DUPLICIDADE,
      'Tratar alerta',
      'parecido com o doc 5498',
    ),
  ),
  titulo(
    '5549',
    'CEVA LOGISTICS',
    3470.12,
    1,
    1,
    bloqueado(
      MOTIVO_PAGAMENTO.BOLETO_SEM_DDA,
      'Boleto sem DDA',
      DONO_PAGAMENTO.VOCE,
      ACAO_PAGAMENTO.VER_BOLETO,
      'Ver boleto',
      '1 sugestão disponível',
    ),
    { temBoleto: false },
  ),
  titulo(
    '5590',
    'TRANSPORTES YAMA',
    7730,
    5,
    1,
    bloqueado(
      MOTIVO_PAGAMENTO.ALCADA,
      'Aguardando aprovação',
      DONO_PAGAMENTO.APROVADOR,
      ACAO_PAGAMENTO.ABRIR_NO_CONEXOS,
      'Abrir no Conexos',
      'aguarda alçada nível 2',
    ),
    { liberado: false },
  ),
  titulo(
    '5601',
    'COLUMBIA ADTO 157',
    18000,
    8,
    1,
    bloqueado(
      MOTIVO_PAGAMENTO.TIPO_PERMUTA,
      'Permuta ou adiantamento',
      DONO_PAGAMENTO.PERMUTAS,
      ACAO_PAGAMENTO.ABRIR_EM_PERMUTAS,
      'Abrir em Permutas',
      'pode já ter permuta parcial: confira o saldo em Permutas',
    ),
    { formaPagamentoConexos: undefined, temBoleto: false },
  ),
  titulo(
    '5311',
    'DEPÓSITO CENTRAL',
    2890,
    -4,
    1,
    bloqueado(
      MOTIVO_PAGAMENTO.VENCIDO,
      'Vencido',
      DONO_PAGAMENTO.CONTAS_A_PAGAR,
      ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS,
      'Renegociar no Conexos',
      'venceu há 4 dias',
    ),
  ),
  titulo(
    '5298',
    'TRANSLOG SUL',
    11200,
    -1,
    7,
    bloqueado(
      MOTIVO_PAGAMENTO.VENCIDO,
      'Vencido',
      DONO_PAGAMENTO.CONTAS_A_PAGAR,
      ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS,
      'Renegociar no Conexos',
      'venceu ontem',
    ),
    { formaPagamentoConexos: 8, temBoleto: false },
  ),
  titulo(
    '5604',
    'PAPELARIA CENTRO',
    640,
    10,
    3,
    bloqueado(
      MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG,
      'Forma não paga por SISPAG',
      DONO_PAGAMENTO.VOCE,
      ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS,
      'Corrigir a forma no Conexos',
      'cheque',
    ),
    { formaPagamentoConexos: 1, temBoleto: false },
  ),
  titulo(
    '5605',
    'EMBALAGENS SUL',
    4100,
    3,
    3,
    bloqueado(
      MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE,
      'Ajuste de centavos pendente',
      DONO_PAGAMENTO.VOCE,
      ACAO_PAGAMENTO.TENTAR_AJUSTE,
      'Tentar o ajuste de novo',
    ),
  ),
]

export const resumoDe = (titulos: TituloAPagar[]): ResumoSituacao => {
  const zero = () => ({ qtd: 0, valor: 0 })
  const resumo: ResumoSituacao = {
    porEstado: { PRONTO: zero(), BLOQUEADO: zero() },
    porMotivo: {},
    porDono: {},
    fontesIndisponiveis: [],
  }
  for (const t of titulos) {
    const s = t.situacaoPagamento
    if (!s) continue
    resumo.porEstado[s.estado].qtd += 1
    resumo.porEstado[s.estado].valor += t.valor
    if (s.principal) {
      const m = (resumo.porMotivo[s.principal] ??= zero())
      m.qtd += 1
      m.valor += t.valor
    }
    if (s.dono) {
      const d = (resumo.porDono[s.dono] ??= zero())
      d.qtd += 1
      d.valor += t.valor
    }
  }
  return resumo
}

export const RESUMO_FIXTURE: ResumoSituacao = resumoDe(TITULOS_FIXTURE)
