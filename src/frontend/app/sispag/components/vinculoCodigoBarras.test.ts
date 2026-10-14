import type { ItemLote, RetiradaDoLote, VinculoPrevisto } from '@/lib/sispag'
import { descreverDelta, seloDoItem } from './vinculoCodigoBarras'

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
  loteId: 'L1',
  filCod: 2,
  docCod: '636',
  titCod: '1',
  valor: 1028.8,
  incluidoPor: 'ana',
  ...over,
})

const previsto = (over: Partial<VinculoPrevisto> = {}): VinculoPrevisto => ({
  titulo: { filCod: 2, docCod: '636', titCod: '1' },
  elegivel: true,
  valorAbertoFonte: 'CARTEIRA_LOCAL',
  ...over,
})

describe('descreverDelta', () => {
  it('mostra o sinal sempre', () => {
    expect(descreverDelta({ deltaDias: 3, deltaCentavos: 0 })).toMatch(/\+3 dias/)
    expect(descreverDelta({ deltaDias: -1 })).toMatch(/-1 dia\b/)
    expect(descreverDelta({ deltaCentavos: 1 })).toMatch(/\+R\$\s?0,01/)
    expect(descreverDelta({ deltaCentavos: -150 })).toMatch(/-R\$\s?1,50/)
    expect(descreverDelta({})).toBe('')
  })
})

describe('seloDoItem', () => {
  it('vinculado: persistente, com a máscara e o valor', () => {
    const s = seloDoItem({
      item: item({
        vinculoCodigoBarras: {
          origem: 'DECISAO_HUMANA',
          decisaoId: 'd',
          codigoMascarado: '12345…6789',
          aplicadoEm: '2026-10-14T12:00:00.000Z',
          flpCod: 36,
        },
      }),
      modo: 'off',
      dataDebito: '2026-10-20',
    })
    expect(s?.tipo).toBe('vinculado')
    expect(s?.texto).toMatch(/vinculado por confirmação/)
    expect(s?.texto).toContain('12345…6789')
    expect(s?.texto).toMatch(/R\$\s?1\.028,80/)
    expect(s?.texto).toMatch(/20\/10/)
  })

  it('item vinculado e depois retirado NÃO aparece como sucesso', () => {
    const retirada = {
      titulo: { filCod: 2, docCod: '636', titCod: '1' },
      motivo: 'VINCULO_CODIGO_BARRAS_FALHOU',
      ocorridoEm: '2026-10-14T13:00:00Z',
    } as RetiradaDoLote
    const s = seloDoItem({
      item: item({
        vinculoCodigoBarras: {
          origem: 'DECISAO_HUMANA',
          codigoMascarado: '12345…6789',
          aplicadoEm: '2026-10-14T12:00:00.000Z',
          flpCod: 36,
        },
      }),
      retirado: retirada,
    })
    expect(s?.tipo).toBe('retirado')
    expect(s?.texto).not.toMatch(/vinculado por confirmação/)
  })

  it('previsto só com modo on; derivado e sem prometer', () => {
    const on = seloDoItem({ item: item(), previsto: previsto(), modo: 'on' })
    expect(on?.tipo).toBe('previsto')
    expect(on?.texto).toMatch(/será vinculado na remessa/)
    expect(on?.texto).toMatch(/relê/i)
  })

  it('shadow e off não mostram selo previsto', () => {
    expect(seloDoItem({ item: item(), previsto: previsto(), modo: 'shadow' })).toBeNull()
    expect(seloDoItem({ item: item(), previsto: previsto(), modo: 'off' })).toBeNull()
  })

  it('inelegível mostra o motivo e o delta com sinal', () => {
    const s = seloDoItem({
      item: item(),
      previsto: previsto({
        elegivel: false,
        motivo: 'DATA_FORA_DA_JANELA',
        deltaDias: 6,
        deltaCentavos: 0,
      }),
      modo: 'on',
    })
    expect(s?.tipo).toBe('inelegivel')
    expect(s?.texto).toMatch(/\+6 dias/)
  })

  it('sem nada a dizer ⇒ null', () => {
    expect(seloDoItem({ item: item(), modo: 'on' })).toBeNull()
  })
})
