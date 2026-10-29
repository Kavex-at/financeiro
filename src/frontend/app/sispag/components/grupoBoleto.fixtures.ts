import type { GrupoBoletoListado, SugestaoGrupoBoleto } from '@/lib/sispag'

/** Fixtures do boleto agrupado (PEDRONI, filial 2): 3 × R$ 525,00 = boleto 332841 de R$ 1.575,00. */
export const TITULOS_PEDRONI = ['38883', '38884', '38885'].map((docCod) => ({
  filCod: 2,
  docCod,
  titCod: '1',
}))

export const sugestaoGrupo = (over: Partial<SugestaoGrupoBoleto> = {}): SugestaoGrupoBoleto => ({
  filCod: 2,
  pesCod: '9001',
  credor: 'PEDRONI',
  ddcCod: 900,
  ditCod: 332841,
  numeroBoleto: '332841',
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
  somaTitulosCentavos: 157500,
  titulos: TITULOS_PEDRONI.map((t) => ({
    ...t,
    motivos: [],
    valorCentavos: 52500,
    vencimento: '2026-10-21',
    valorLiquidoCentavos: 52500,
    deltaDias: 0,
  })),
  intercambiavel: false,
  parVigente: true,
  confirmavel: true,
  motivos: [],
  avisos: [],
  ...over,
})

export const grupoConfirmado = (over: Partial<GrupoBoletoListado> = {}): GrupoBoletoListado => ({
  id: 'G1',
  filCod: 2,
  pesCod: '9001',
  credor: 'PEDRONI',
  ddcCod: 900,
  ditCod: 332841,
  numeroBoleto: '332841',
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
  titulos: TITULOS_PEDRONI.map((t) => ({
    ...t,
    valorLiquidoCentavos: 52500,
    vencimento: '2026-10-21',
  })),
  somaTitulosCentavos: 157500,
  origem: 'SUGERIDO',
  intercambiavel: false,
  estado: 'CONFIRMADO',
  confirmadoPor: 'bia',
  versao: 1,
  situacao: 'DISPONIVEL',
  orfao: { orfao: false },
  ...over,
})
