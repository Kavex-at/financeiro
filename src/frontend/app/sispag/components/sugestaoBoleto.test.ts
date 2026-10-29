import { desfechoTituloSchema, type SugestaoBoleto, SITUACOES_SUGESTAO_TITULO } from '@/lib/sispag'
import {
  ACAO_VER_GRUPO,
  agruparPorTitulo,
  avisoSelecaoGrupoSugerido,
  chaveTitulo,
  descricaoGrupoSugerido,
  formatDeltaDias,
  formatDeltaPercentual,
  formatDeltaValor,
  resumoDoDesfecho,
  resumoDoTitulo,
  ROTULO_SITUACAO,
  SITUACAO_SEM_PAINEL,
  TOM_SITUACAO,
} from './sugestaoBoleto'

const base = (over: Partial<SugestaoBoleto> = {}): SugestaoBoleto => ({
  filCod: 1,
  docCod: '10',
  titCod: '1',
  valorTitulo: 100,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  ddcCod: 5,
  ditCod: 6,
  valorBoleto: 100,
  vencimentoBoleto: '2026-10-20',
  avaliacao: {
    resultado: 'FORTE',
    deltaValor: 0,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: [],
    confirmavel: true,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
  ...over,
})

describe('deltas com sinal (boleto − título)', () => {
  it('valor', () => {
    expect(formatDeltaValor(0.01)).toBe('R$ +0,01')
    expect(formatDeltaValor(-12.5)).toBe('R$ -12,50')
    expect(formatDeltaValor(0)).toBe('R$ 0,00')
  })
  it('percentual', () => {
    expect(formatDeltaPercentual(1.6)).toBe('+1,6 %')
    expect(formatDeltaPercentual(-0.34)).toBe('-0,3 %')
  })
  it('dias', () => {
    expect(formatDeltaDias(2)).toBe('+2 dias')
    expect(formatDeltaDias(-1)).toBe('-1 dia')
    expect(formatDeltaDias(0)).toBe('0 dias')
  })
})

describe('resumo por título', () => {
  it('sem sugestão = indefinido', () => {
    expect(resumoDoTitulo(undefined)).toBeUndefined()
    expect(resumoDoTitulo([])).toBeUndefined()
  })
  it('confirmada vence a disponível; informativa quando nada é confirmável', () => {
    expect(resumoDoTitulo([base(), base({ estado: 'CONFIRMADA', ditCod: 7 })])).toBe('CONFIRMADA')
    expect(resumoDoTitulo([base()])).toBe('DISPONIVEL')
    expect(
      resumoDoTitulo([
        base({
          confirmavel: false,
          avaliacao: { ...base().avaliacao, resultado: 'VENCIDO_INFORMATIVO', confirmavel: false },
        }),
      ]),
    ).toBe('INFORMATIVA')
  })
  it('confirmação órfã vence a confirmada comum (precisa de atenção)', () => {
    expect(
      resumoDoTitulo([
        base({ estado: 'CONFIRMADA', ditCod: 7 }),
        base({ estado: 'CONFIRMADA', ditCod: 8, orfa: true, confirmavel: false }),
      ]),
    ).toBe('ORFA')
    expect(resumoDoTitulo([base({ estado: 'CONFIRMADA', orfa: true })])).toBe('ORFA')
  })
  it('agrupa por fil:doc:tit', () => {
    const m = agruparPorTitulo([base(), base({ ditCod: 9 }), base({ titCod: '2' })])
    expect(m.get(chaveTitulo({ filCod: 1, docCod: '10', titCod: '1' }))).toHaveLength(2)
    expect(m.size).toBe(2)
  })
})

describe('EM_GRUPO — título dentro de um boleto agrupado confirmado (I15q, ADR-0077)', () => {
  it('é uma situação conhecida, sem tom de ação, e o rótulo abre a gaveta (onde o grupo se anula)', () => {
    expect(SITUACOES_SUGESTAO_TITULO).toContain('EM_GRUPO')
    expect(ROTULO_SITUACAO.EM_GRUPO).toBe('em boleto agrupado')
    expect(TOM_SITUACAO.EM_GRUPO).toBe('mudo')
    expect(SITUACAO_SEM_PAINEL.has('EM_GRUPO')).toBe(false) // abre a gaveta (I21v): Anular lá
  })
})

// ── I21v/I21w — título de uma SUGESTÃO de grupo na carteira (ADR-0077, emenda 2026-10-29) ─────────
describe('GRUPO_SUGERIDO — título de sugestão de grupo (RHENUS 5541/5566, 129818)', () => {
  const grupo = {
    ddcCod: 165,
    ditCod: 24398,
    numeroBoleto: '129818',
    nTitulos: 2,
    valorBoletoCentavos: 2636985,
    confirmavel: true,
  }
  const desfecho = (over: Record<string, unknown> = {}) =>
    desfechoTituloSchema.parse({
      filCod: 1,
      docCod: '5566',
      titCod: '1',
      valorTitulo: 25935.47,
      vencimentoTitulo: '2026-10-29',
      dataDebito: '2026-10-29',
      situacao: 'GRUPO_SUGERIDO',
      candidatos: [],
      totalCandidatos: 0,
      motivo: 'x',
      avisoVenceAntes: 'NENHUM',
      diasVencidoNoDebito: 0,
      grupoSugerido: grupo,
      ...over,
    })

  it('é situação conhecida, com rótulo, tom de aviso, e abre a gaveta com o grupo', () => {
    expect(SITUACOES_SUGESTAO_TITULO).toContain('GRUPO_SUGERIDO')
    expect(ROTULO_SITUACAO.GRUPO_SUGERIDO).toBe('em grupo sugerido')
    expect(TOM_SITUACAO.GRUPO_SUGERIDO).toBe('aviso')
    expect(SITUACAO_SEM_PAINEL.has('GRUPO_SUGERIDO')).toBe(false) // abre a gaveta (I21v)
    expect(SITUACAO_SEM_PAINEL.has('SEM_CANDIDATO')).toBe(true)
  })

  it('o desfecho da API traz o ponteiro do grupo e o resumo o repassa', () => {
    const d = desfecho()
    expect(d.grupoSugerido).toMatchObject({ ddcCod: 165, ditCod: 24398, nTitulos: 2 })
    expect(resumoDoDesfecho(d)?.grupoSugerido).toEqual(d.grupoSugerido)
  })

  it('desfecho sem grupo (backend antigo) continua válido', () => {
    expect(resumoDoDesfecho(desfecho({ situacao: 'SEM_CANDIDATO', grupoSugerido: undefined }))).toMatchObject({
      situacao: 'SEM_CANDIDATO',
    })
  })

  it('texto do selo e da ação', () => {
    expect(ACAO_VER_GRUPO).toBe('Ver grupo')
    expect(descricaoGrupoSugerido(grupo).replace(/\u00a0/g, ' ')).toBe(
      'Faz parte de um grupo sugerido: boleto 129818, 2 títulos, R$ 26.369,85.',
    )
    expect(
      descricaoGrupoSugerido({ ...grupo, numeroBoleto: undefined, confirmavel: false, motivo: 'NAO_LIBERADO' }),
    ).toMatch(/aguardando alçada/)
  })

  it('selecionar o título avulso avisa (Q8); sem grupo, não avisa', () => {
    expect(avisoSelecaoGrupoSugerido(resumoDoDesfecho(desfecho()))).toMatch(/grupo sugerido/)
    expect(avisoSelecaoGrupoSugerido(resumoDoDesfecho(desfecho({ grupoSugerido: undefined })))).toBeUndefined()
    expect(avisoSelecaoGrupoSugerido(undefined)).toBeUndefined()
  })

  it('o título com 1:1 forte mantém a situação e só ganha o ponteiro (aviso de seleção também)', () => {
    const d = desfecho({ situacao: 'UNICA_SEGURA' })
    expect(resumoDoDesfecho(d)?.situacao).toBe('UNICA_SEGURA')
    expect(avisoSelecaoGrupoSugerido(resumoDoDesfecho(d))).toMatch(/grupo sugerido/)
  })

  it('o filtro de situação e a contagem existem para a situação nova', () => {
    expect(SITUACOES_SUGESTAO_TITULO.filter((x) => x === 'GRUPO_SUGERIDO')).toHaveLength(1)
    expect(Object.keys(ROTULO_SITUACAO).sort()).toEqual([...SITUACOES_SUGESTAO_TITULO].sort())
  })
})
