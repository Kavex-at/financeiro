import type { ItemLote, LotePagamento, TituloAPagar } from '@/lib/sispag'
import {
  chavesComBoleto,
  diaDoRetorno,
  filtroCandidatos,
  filtroFinalizados,
  filtroLotesNativos,
  filtroTitulos,
  formatarDia,
} from './filtrosAbas'

const dia = (s: string) => Date.parse(`${s}T00:00:00Z`)

const titulo = (over: Partial<TituloAPagar>): TituloAPagar => ({
  docCod: '1',
  titCod: '1',
  filCod: 1,
  valor: 10,
  liberado: true,
  pago: false,
  ...over,
})

const item = (over: Partial<ItemLote>): ItemLote => ({
  loteId: 'L',
  filCod: 1,
  docCod: '1',
  titCod: '1',
  incluidoPor: 'x',
  ...over,
})

const lote = (over: Partial<LotePagamento>): LotePagamento => ({
  id: 'L',
  filCod: 1,
  status: 'RASCUNHO',
  criadoPor: 'x',
  versao: 1,
  itens: [],
  ...over,
})

describe('filtros por aba', () => {
  it('títulos: vencimento como dia ERP e boleto do título', () => {
    const t = titulo({ vencimento: dia('2026-10-06'), temBoleto: true })
    expect(filtroTitulos.getDatas?.(t)).toEqual(['2026-10-06'])
    expect(filtroTitulos.getBoleto?.(t)).toEqual([true])
    expect(filtroTitulos.getBoleto?.(titulo({}))).toEqual([false])
  })

  it('candidatos: datas de todos os itens; boleto pela carteira OU pela modalidade', () => {
    const comBoleto = chavesComBoleto([
      titulo({ docCod: 'A', temBoleto: true }),
      titulo({ docCod: 'B', temBoleto: false }),
    ])
    const l = lote({
      itens: [
        item({ docCod: 'A', vencimento: dia('2026-10-01') }),
        item({ docCod: 'B', vencimento: dia('2026-10-09') }),
        item({ docCod: 'C', modalidade: 'BOLETO' }),
      ],
    })
    const f = filtroCandidatos(comBoleto)
    expect(f.getDatas?.(l)).toEqual(['2026-10-01', '2026-10-09', undefined])
    expect(f.getBoleto?.(l)).toEqual([true, false, true])
  })

  it('finalizados: remessa gerada (dia em Brasília), senão a finalização', () => {
    expect(
      filtroFinalizados.getDatas?.(lote({ remessaGeradaEm: '2026-10-07T01:00:00Z' })),
    ).toEqual(['2026-10-06'])
    expect(
      filtroFinalizados.getDatas?.(lote({ finalizadoEm: '2026-10-03T15:00:00Z' })),
    ).toEqual(['2026-10-03'])
  })

  it('REM: data de crédito como dia ERP', () => {
    expect(
      filtroLotesNativos.getDatas?.({
        filCod: 1,
        flpCod: 1,
        status: 1,
        envioConfirmado: false,
        retornoProcessado: false,
        titulosCount: 0,
        soma: 0,
        itensRetorno: 0,
        dataCredito: dia('2026-10-02'),
      }),
    ).toEqual(['2026-10-02'])
  })

  it('retornos: cadastro do arquivo, senão o processamento', () => {
    const base = { filCod: 1, bncCod: 341, gtbCodSeq: 1, garCodSeq: 1 }
    expect(diaDoRetorno({ ...base, cadastradoEm: Date.parse('2026-10-05T12:00:00Z') })).toBe(
      '2026-10-05',
    )
    expect(diaDoRetorno({ ...base, processadoEm: Date.parse('2026-10-04T12:00:00Z') })).toBe(
      '2026-10-04',
    )
    expect(diaDoRetorno(base)).toBeUndefined()
  })

  it('formatarDia sem fuso', () => {
    expect(formatarDia('2026-10-06')).toBe('06/10/2026')
    expect(formatarDia(undefined)).toBe('—')
  })
})
