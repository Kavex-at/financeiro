import type { AjusteCentavos, SugestaoBoleto } from '@/lib/sispag'
import { ajusteCentavosSchema } from '@/lib/sispag'
import { seloDoAjusteCentavos } from './sugestaoBoleto'

const confirmada = (deltaValor: number, over: Partial<SugestaoBoleto> = {}): SugestaoBoleto => ({
  filCod: 2,
  docCod: '536',
  titCod: '1',
  valorTitulo: 462.49,
  vencimentoTitulo: '2026-10-30',
  dataDebito: '2026-10-30',
  ddcCod: 10,
  ditCod: 1,
  valorBoleto: 462.49 + deltaValor,
  vencimentoBoleto: '2026-10-30',
  avaliacao: {
    resultado: 'CONHECIDO',
    deltaValor,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: [],
    confirmavel: false,
  },
  estado: 'CONFIRMADA',
  confirmavel: false,
  ...over,
})

const ajuste = (over: Partial<AjusteCentavos> = {}): AjusteCentavos => ({
  id: 'exec-1',
  filCod: 2,
  docCod: '536',
  titCodOrigem: '1',
  decisaoId: 'dec-1',
  etapa: 'concluido',
  tentativas: 1,
  ...over,
})

describe('seloDoAjusteCentavos (ADR-0073, I18l/I18m)', () => {
  it('modo off + par dentro do limite ⇒ "diferença de centavos — ajuste desligado"', () => {
    const s = seloDoAjusteCentavos({ sugestao: confirmada(0.01), modo: 'off' })
    expect(s).toMatchObject({ tipo: 'desligado', retomavel: false })
    expect(s?.texto).toMatch(/diferença de centavos — ajuste desligado/)
  })

  it('sem diferença, acima do limite ou não confirmada ⇒ sem selo', () => {
    expect(seloDoAjusteCentavos({ sugestao: confirmada(0), modo: 'on' })).toBeNull()
    expect(seloDoAjusteCentavos({ sugestao: confirmada(0.06), modo: 'on' })).toBeNull()
    expect(
      seloDoAjusteCentavos({ sugestao: confirmada(0.01, { estado: 'SUGERIDA' }), modo: 'on' }),
    ).toBeNull()
  })

  it.each(['pendente', 'renegociacao_criada', 'ajuste_aplicado', 'finalizada', 'liberada'] as const)(
    'etapa %s ⇒ "ajustando o título no Conexos", retomável',
    (etapa) => {
      const s = seloDoAjusteCentavos({
        sugestao: confirmada(0.01),
        modo: 'on',
        ajuste: ajuste({ etapa }),
      })
      expect(s).toMatchObject({ tipo: 'em_curso', retomavel: true })
      expect(s?.texto).toMatch(/ajustando o título no Conexos/)
    },
  )

  it('concluido ⇒ título novo X/Z e o LÍQUIDO do ledger (valor do boleto), não o base', () => {
    const s = seloDoAjusteCentavos({
      sugestao: confirmada(0.01),
      modo: 'on',
      ajuste: ajuste({ etapa: 'concluido', titCodNovo: '2', valorBoletoCentavos: 46250 }),
    })
    expect(s?.tipo).toBe('concluido')
    expect(s?.texto).toContain('536/2')
    expect(s?.texto).toMatch(/462,50/)
    expect(s?.texto).not.toMatch(/462,49/)
  })

  it.each([
    ['aguardando_aprovacao_manual', /aprovação.*Conexos/i, false],
    ['recusado', /não foi ajustado/i, false],
    ['cancelado', /cancelad/i, false],
    ['indeterminado', /conferir no Conexos/i, false],
  ] as const)('%s ⇒ aviso pt-BR com motivo e próxima ação', (etapa, texto, retomavel) => {
    const s = seloDoAjusteCentavos({
      sugestao: confirmada(0.01),
      modo: 'on',
      ajuste: ajuste({ etapa, motivo: 'TOTAL_DA_RENEGOCIACAO_DIVERGE_DO_BOLETO' }),
    })
    expect(s?.tipo).toBe('aviso')
    expect(s?.texto).toMatch(texto)
    expect(s?.retomavel).toBe(retomavel)
  })

  it('o schema da API recusa nada além de máscara 5+4 no código', () => {
    expect(() =>
      ajusteCentavosSchema.parse({ ...ajuste(), codigoMascarado: '3'.repeat(44) }),
    ).toThrow()
    expect(ajusteCentavosSchema.parse({ ...ajuste(), codigoMascarado: '34191…9000' })).toMatchObject(
      { codigoMascarado: '34191…9000' },
    )
  })
})
