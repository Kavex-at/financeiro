/**
 * Desfecho por título (ADR-0072): rótulos exaustivos, mensagem de vence-antes (casos A e B), os 14
 * casos reais do pool (igual +8 d, acima +R$ 3…+R$ 526, abaixo −R$ 9,49) e a compatibilidade com a
 * resposta do backend anterior.
 */
import {
  type CandidatoTituloBoleto,
  type DesfechoTituloBoleto,
  SITUACOES_SUGESTAO_TITULO,
  type SugestaoBoleto,
} from '@/lib/sispag'
import {
  candidatoComoSugestao,
  desfechoPorTitulo,
  desfechosDeSugestoesLegadas,
  exigeReconhecimento,
  exigeReconhecimentoTipado,
  mensagemDivergenciaData,
  montarReconhecimentoDivergencia,
  motivoReconhecimentoValido,
  formatDeltaDias,
  formatDeltaValor,
  mensagemVenceAntes,
  resumoDoDesfecho,
  ROTULO_SITUACAO,
  SITUACAO_SEM_PAINEL,
  TEXTO_SINAL,
  TOM_SITUACAO,
} from './sugestaoBoleto'

const candidato = (over: Partial<CandidatoTituloBoleto> = {}): CandidatoTituloBoleto => ({
  ddcCod: 10,
  ditCod: 3,
  valorBoleto: 100,
  vencimentoBoleto: '2026-10-20',
  avaliacao: {
    resultado: 'ATENCAO',
    deltaValor: 0,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: [],
    confirmavel: false,
    diasVencidoNoDebito: 0,
  },
  ancorado: false,
  confirmavel: false,
  ...over,
})

const desfecho = (over: Partial<DesfechoTituloBoleto> = {}): DesfechoTituloBoleto => ({
  filCod: 2,
  docCod: '9001',
  titCod: '1',
  valorTitulo: 100,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  situacao: 'SO_FRACA',
  candidatos: [candidato()],
  totalCandidatos: 1,
  motivo: 'sem confirmação',
  avisoVenceAntes: 'NENHUM',
  diasVencidoNoDebito: 0,
  ...over,
})

describe('rótulos e tons por situação', () => {
  it('há um rótulo e um tom para CADA situação (exaustivo)', () => {
    for (const s of SITUACOES_SUGESTAO_TITULO) {
      expect(ROTULO_SITUACAO[s]).toEqual(expect.any(String))
      expect(TOM_SITUACAO[s]).toBeDefined()
    }
    expect(Object.keys(ROTULO_SITUACAO).sort()).toEqual([...SITUACOES_SUGESTAO_TITULO].sort())
  })

  it('textos da proposta', () => {
    expect(ROTULO_SITUACAO).toMatchObject({
      UNICA_SEGURA: 'sugestão disponível',
      SO_ATENCAO: 'ver boleto sugerido',
      AMBIGUA: 'mais de um boleto possível',
      SO_FRACA: 'ver candidato (sem confirmação)',
      DISPUTADA: 'boleto reservado a outro título',
      SO_VENCIDA: 'ver boleto vencido',
      SEM_CANDIDATO: 'sem boleto no pool',
    })
  })

  it('fraco nunca é "sugestão disponível" nem tom de ação', () => {
    expect(ROTULO_SITUACAO.SO_FRACA).not.toBe(ROTULO_SITUACAO.UNICA_SEGURA)
    expect(TOM_SITUACAO.SO_FRACA).not.toBe('acao')
    expect(SITUACAO_SEM_PAINEL.has('SEM_CANDIDATO')).toBe(true)
    expect(SITUACAO_SEM_PAINEL.has('SO_FRACA')).toBe(false)
  })

  it('os dois sinais novos têm texto', () => {
    expect(TEXTO_SINAL.VENCE_ANTES_DO_TITULO).toEqual({
      texto: 'vence antes do título',
      atencao: true,
    })
    expect(TEXTO_SINAL.RECONHECEU_VENCE_ANTES.texto).toEqual(expect.any(String))
  })
})

describe('mensagemVenceAntes (§3.4)', () => {
  const ctx = { vencimentoTitulo: '2026-10-16', dataDebito: '2026-10-16' }

  it('caso A: vencido no débito — dias antes do título e dias de atraso, só informação', () => {
    const m = mensagemVenceAntes(
      {
        vencimentoBoleto: '2026-10-13',
        avaliacao: {
          ...candidato().avaliacao,
          resultado: 'VENCIDO_INFORMATIVO',
          deltaDias: -3,
          diasVencidoNoDebito: 3,
          sinais: ['VENCE_ANTES_DO_TITULO'],
        },
      },
      ctx,
    )
    expect(m).toContain('vence em 13/10, 3 dias antes do título (16/10)')
    expect(m).toContain('Na data de débito (16/10) ele já estará vencido há 3 dias')
    expect(m).toContain('portal do banco')
    expect(m).toContain('Serve só como informação')
  })

  it('caso B: ainda vale no débito antecipado — não promete que sai na remessa', () => {
    const m = mensagemVenceAntes(
      {
        vencimentoBoleto: '2026-10-15',
        avaliacao: {
          ...candidato().avaliacao,
          deltaDias: -1,
          diasVencidoNoDebito: 0,
          sinais: ['VENCE_ANTES_DO_TITULO'],
        },
      },
      { vencimentoTitulo: '2026-10-16', dataDebito: '2026-10-14' },
    )
    expect(m).toContain('vence em 15/10, 1 dia antes do título (16/10)')
    expect(m).toContain('O débito está previsto para 14/10')
    expect(m).toContain('Confirmar não faz o boleto sair na remessa')
  })

  it('Δ ≥ 0 e SEM_RELACAO: nenhuma mensagem inventada', () => {
    expect(mensagemVenceAntes(candidato(), ctx)).toBeUndefined()
    expect(
      mensagemVenceAntes(
        {
          vencimentoBoleto: '2026-10-21',
          avaliacao: { ...candidato().avaliacao, deltaDias: 5 },
        },
        ctx,
      ),
    ).toBeUndefined()
    expect(
      mensagemVenceAntes(
        {
          vencimentoBoleto: '2026-09-01',
          avaliacao: { ...candidato().avaliacao, resultado: 'SEM_RELACAO', deltaDias: -30 },
        },
        ctx,
      ),
    ).toBeUndefined()
  })

  it('decisão legada sem o sinal gravado deriva o aviso do Δdias < 0', () => {
    const legado = {
      vencimentoBoleto: '2026-10-15',
      avaliacao: { ...candidato().avaliacao, deltaDias: -1, sinais: [] },
    }
    expect(mensagemVenceAntes(legado, ctx)).toContain('1 dia antes do título')
    expect(exigeReconhecimento(legado)).toBe(false) // só o sinal exige reconhecer
  })

  it('exigeReconhecimento: só com o sinal VENCE_ANTES_DO_TITULO', () => {
    expect(
      exigeReconhecimento({
        avaliacao: { ...candidato().avaliacao, sinais: ['VENCE_ANTES_DO_TITULO'] },
      }),
    ).toBe(true)
    expect(exigeReconhecimento(candidato())).toBe(false)
  })
})

describe('os 14 casos reais do pool (SO_FRACA exibida, nunca confirmável)', () => {
  // igual +8 d · acima +R$ 3 … +R$ 526 · abaixo −R$ 9,49
  const casos: Array<[string, number, number]> = [
    ['igual com +8 dias', 0, 8],
    ['acima +R$ 3', 3, 0],
    ['acima +R$ 12,40', 12.4, 1],
    ['acima +R$ 87', 87, 0],
    ['acima +R$ 526', 526, 0],
    ['abaixo −R$ 9,49', -9.49, 0],
  ]
  it.each(casos)('%s: delta com sinal e sem botão de confirmar', (_n, dv, dd) => {
    const c = candidato({
      avaliacao: { ...candidato().avaliacao, deltaValor: dv, deltaDias: dd },
      motivo: 'Sem confirmação do emissor nem do número do documento.',
    })
    const d = desfecho({ candidatos: [c] })
    const s = candidatoComoSugestao(d, c)
    expect(s.confirmavel).toBe(false)
    expect(s.avaliacao.confirmavel).toBe(false)
    expect(s.motivo).toContain('Sem confirmação')
    if (dv !== 0) expect(formatDeltaValor(dv)).toMatch(/^R\$ [+-]/)
    if (dd !== 0) expect(formatDeltaDias(dd)).toMatch(/^[+-]/)
  })
})

describe('adaptações', () => {
  it('candidatoComoSugestao: confirmada/órfã viram estado CONFIRMADA; órfã carrega o motivo', () => {
    const c = candidato()
    const orfa = candidatoComoSugestao(
      desfecho({ situacao: 'ORFA', motivoOrfa: 'O boleto saiu do pool.' }),
      c,
    )
    expect(orfa).toMatchObject({ estado: 'CONFIRMADA', orfa: true, motivoOrfa: 'O boleto saiu do pool.' })
    const conf = candidatoComoSugestao(desfecho({ situacao: 'CONFIRMADA' }), c)
    expect(conf.estado).toBe('CONFIRMADA')
    expect(conf.orfa).toBeUndefined()
    expect(candidatoComoSugestao(desfecho(), c).estado).toBe('SUGERIDA')
  })

  it('resumoDoDesfecho e desfechoPorTitulo', () => {
    const d = desfecho({ situacao: 'AMBIGUA', totalCandidatos: 4, avisoVenceAntes: 'ATENCAO' })
    expect(resumoDoDesfecho(d)).toEqual({
      situacao: 'AMBIGUA',
      avisoVenceAntes: 'ATENCAO',
      total: 4,
    })
    expect(resumoDoDesfecho(undefined)).toBeUndefined()
    expect(desfechoPorTitulo([d]).get('2:9001:1')).toBe(d)
    expect(desfechoPorTitulo(undefined).size).toBe(0)
  })

  it('resposta do backend anterior: reconstrói o desfecho só com o que a lista antiga prova', () => {
    const base: SugestaoBoleto = {
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
    }
    const vencida: SugestaoBoleto = {
      ...base,
      docCod: '11',
      confirmavel: false,
      avaliacao: { ...base.avaliacao, resultado: 'VENCIDO_INFORMATIVO', deltaDias: -2, confirmavel: false },
    }
    const [a, b] = desfechosDeSugestoesLegadas([base, vencida])
    expect(a).toMatchObject({ situacao: 'UNICA_SEGURA', avisoVenceAntes: 'NENHUM' })
    expect(a?.candidatos[0]?.confirmavel).toBe(true)
    expect(b).toMatchObject({ situacao: 'SO_VENCIDA', avisoVenceAntes: 'CRITICO' })
    expect(b?.candidatos[0]?.confirmavel).toBe(false)
  })
})

describe('reconhecimento tipado de data divergente (I15q, ADR-0078)', () => {
  const divergente = (deltaDias: number) => ({
    valorBoleto: 1234.56,
    vencimentoBoleto: '2026-10-17',
    avaliacao: {
      ...candidato().avaliacao,
      deltaDias,
      exigeReconhecimento: 'DATA_DIVERGENTE' as const,
    },
  })

  it('o tipado vale para Δ<0 e para Δ>5; backend antigo (sem o campo) nunca pede o tipado', () => {
    expect(exigeReconhecimentoTipado(divergente(-3))).toBe(true)
    expect(exigeReconhecimentoTipado(divergente(7))).toBe(true)
    expect(exigeReconhecimentoTipado({ avaliacao: candidato().avaliacao })).toBe(false)
    expect(
      exigeReconhecimentoTipado({
        avaliacao: { ...candidato().avaliacao, exigeReconhecimento: 'NENHUM' },
      }),
    ).toBe(false)
  })

  it('exigeReconhecimento também vale para o tipado sem o sinal (Δ>5)', () => {
    expect(exigeReconhecimento(divergente(7))).toBe(true)
  })

  it('o ack envia o que a tela mostra: Δ com sinal e valor em centavos, motivo sem as pontas', () => {
    expect(montarReconhecimentoDivergencia(divergente(-3), '  Confirmado por telefone  ')).toEqual({
      tipo: 'DATA_DIVERGENTE',
      aceito: true,
      motivo: 'Confirmado por telefone',
      deltaDiasVisto: -3,
      valorBoletoVisto: 123456,
    })
  })

  it('motivo: 10 a 500 caracteres depois do trim', () => {
    expect(motivoReconhecimentoValido('curto')).toBe(false)
    expect(motivoReconhecimentoValido('   123456789   ')).toBe(false)
    expect(motivoReconhecimentoValido('1234567890')).toBe(true)
    expect(motivoReconhecimentoValido('x'.repeat(500))).toBe(true)
    expect(motivoReconhecimentoValido('x'.repeat(501))).toBe(false)
  })

  it('mensagem diz o sentido e as datas', () => {
    expect(mensagemDivergenciaData(divergente(-3), { vencimentoTitulo: '2026-10-20' })).toContain(
      'vence em 17/10, 3 dias antes do título (20/10)',
    )
    expect(
      mensagemDivergenciaData(
        { ...divergente(7), vencimentoBoleto: '2026-10-27' },
        { vencimentoTitulo: '2026-10-20' },
      ),
    ).toContain('7 dias depois do título')
  })
})
