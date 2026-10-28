import {
  desfechoTituloSchema,
  SINAIS_SUGESTAO_BOLETO,
  CODIGOS_ERRO_SUGESTAO_BOLETO,
  confirmacaoEmissorSchema,
  decisaoSugestaoBoletoSchema,
  linhaCopiadaSchema,
  listagemSugestoesBoletoSchema,
  resultadoDecisaoBoletoSchema,
  sugestaoBoletoSchema,
} from './sispag'

/**
 * Espelho do contrato de `routes/sispag.ts` (ADR-0068): o que o backend devolve passa nos schemas,
 * e a sugestão NÃO tem campo para barras nem para linha digitável.
 */

const sugestao = {
  filCod: 2,
  docCod: '9001',
  titCod: '1',
  pesCod: '7001',
  credor: 'ACME',
  valorTitulo: 100,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  ddcCod: 10,
  ditCod: 3,
  valorBoleto: 100.03,
  vencimentoBoleto: '2026-10-20',
  emissor: { banco: '237', layout: 'BRADESCO_237', mascarado: '237 / 2656 / ***2740' },
  avaliacao: {
    resultado: 'FORTE',
    deltaValor: 0.03,
    deltaPercentual: 0.03,
    deltaDias: 0,
    sinais: ['VALOR_ATE_5_CENTAVOS', 'MESMO_DIA'],
    confirmavel: true,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
}

describe('contrato da sugestão de boleto (ADR-0068)', () => {
  it('a listagem do backend passa no schema, com aviso de DDA defasado opcional', () => {
    const r = listagemSugestoesBoletoSchema.parse({
      sugestoes: [sugestao],
      total: 1,
      pagina: 1,
      tamanho: 50,
      contagem: { FORTE: 1, ATENCAO: 0 },
      sincronizadoEm: 1_760_000_000_000,
      ddaDefasadoHoras: 20,
    })
    expect(r.sugestoes[0]?.emissor?.mascarado).toBe('237 / 2656 / ***2740')
    expect(r.ddaDefasadoHoras).toBe(20)
  })

  it('a sugestão não carrega barras, linha digitável nem chave do emissor', () => {
    const parsed = sugestaoBoletoSchema.parse({
      ...sugestao,
      codbar: '1'.repeat(44),
      linhaDigitavel: '2'.repeat(47),
      emissor: { ...sugestao.emissor, chave: '237:2656:0092740' },
    })
    const json = JSON.stringify(parsed)
    expect(json).not.toMatch(/\d{30,}/)
    expect(json).not.toContain('0092740')
    expect(parsed).not.toHaveProperty('codbar')
    expect(parsed).not.toHaveProperty('linhaDigitavel')
  })

  it('rejeita um tier desconhecido', () => {
    expect(() =>
      sugestaoBoletoSchema.parse({
        ...sugestao,
        avaliacao: { ...sugestao.avaliacao, resultado: 'MUITO_FORTE' },
      }),
    ).toThrow()
  })

  it('decisão, resultado da decisão, cópia e confirmação de emissor', () => {
    const decisao = {
      id: 'dec-1',
      filCod: 2,
      docCod: '9001',
      titCod: '1',
      pesCod: '7001',
      ddcCod: 10,
      ditCod: 3,
      codbarMascarado: '237…1533',
      valorTitulo: 100,
      vencimentoTitulo: '2026-10-20',
      valorBoleto: 100.03,
      vencimentoBoleto: '2026-10-20',
      deltaValor: 0.03,
      deltaPercentual: 0.03,
      deltaDias: 0,
      sinais: ['MESMO_DIA'],
      tier: 'FORTE',
      decisao: 'CONFIRMADA',
      decididoPor: 'bia',
      decididoEm: '2026-10-14T11:00:00.000Z',
      confirmacaoEmissorId: 'par-1',
    }
    expect(decisaoSugestaoBoletoSchema.parse(decisao).tier).toBe('FORTE')
    expect(resultadoDecisaoBoletoSchema.parse({ criada: false, decisao }).criada).toBe(false)
    expect(linhaCopiadaSchema.parse({ linhaDigitavel: '2'.repeat(47) }).linhaDigitavel).toHaveLength(47)
    const par = confirmacaoEmissorSchema.parse({
      id: 'par-1',
      pesCod: '7001',
      layoutEmissor: 'GENERICO',
      bancoEmissor: '001',
      emissorMascarado: '001 / 1234 / ****',
      estado: 'VIGENTE',
      confirmadoPor: 'ana',
      confirmadoEm: '2026-10-14T10:00:00.000Z',
      versao: 1,
      elegivelAutomatico: false,
    })
    expect(par.elegivelAutomatico).toBe(false)
  })

  it('a confirmação órfã e a decisão ANULADA passam nos schemas (I15l)', () => {
    const orfa = sugestaoBoletoSchema.parse({
      ...sugestao,
      estado: 'CONFIRMADA',
      confirmavel: false,
      orfa: true,
      motivoOrfa: 'O boleto confirmado saiu do pool DDA.',
    })
    expect(orfa.orfa).toBe(true)
    expect(orfa.motivoOrfa).toMatch(/pool DDA/)
    expect(sugestaoBoletoSchema.parse(sugestao).orfa).toBeUndefined()
    const anulada = decisaoSugestaoBoletoSchema.parse({
      id: 'd1',
      filCod: 2,
      docCod: '9001',
      titCod: '1',
      pesCod: '7001',
      ddcCod: 10,
      ditCod: 3,
      codbarMascarado: '237…1533',
      valorTitulo: 100,
      vencimentoTitulo: '2026-10-20',
      valorBoleto: 100,
      vencimentoBoleto: '2026-10-20',
      deltaValor: 0,
      deltaPercentual: 0,
      deltaDias: 0,
      sinais: [],
      decisao: 'ANULADA',
      decididoPor: 'ana',
      decididoEm: '2026-10-14T10:00:00.000Z',
      anuladaPor: 'bia',
      anuladaEm: '2026-10-14T12:00:00.000Z',
      motivoAnulacao: 'par revogado: conta trocada',
    })
    expect(anulada.decisao).toBe('ANULADA')
  })

  it('os códigos de erro espelham os do backend', () => {
    expect(Object.values(CODIGOS_ERRO_SUGESTAO_BOLETO).sort()).toEqual(
      [
        'BOLETO_JA_SUGERIDO_A_OUTRO_TITULO',
        'BOLETO_VENCIDO_NAO_CONFIRMAVEL',
        'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO',
        'CONFIRMACAO_EMISSOR_NAO_ENCONTRADA',
        'COPIA_LINHA_SEM_TRILHA',
        'DECISAO_NAO_CONFIRMADA',
        'RECONHECIMENTO_DE_AVISO_OBRIGATORIO',
        'RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO',
        'RECONHECIMENTO_DE_DIVERGENCIA_OBRIGATORIO',
        'SUGESTAO_BOLETO_INDISPONIVEL',
        'TITULO_SEM_SUGESTAO',
      ].sort(),
    )
  })
})

describe('contrato do desfecho por título (ADR-0072)', () => {
  const candidato = {
    ddcCod: 10,
    ditCod: 3,
    valorBoleto: 103,
    vencimentoBoleto: '2026-10-20',
    emissor: { banco: '237', layout: 'BRADESCO_237', mascarado: '237 / 2656 / ***2740' },
    avaliacao: {
      resultado: 'ATENCAO',
      deltaValor: 3,
      deltaPercentual: 3,
      deltaDias: 0,
      sinais: ['MESMO_DIA', 'VENCE_ANTES_DO_TITULO'],
      confirmavel: false,
      diasVencidoNoDebito: 0,
    },
    ancorado: false,
    confirmavel: false,
    motivo: 'Sem confirmação do emissor nem do número do documento.',
  }
  const desfecho = {
    filCod: 2,
    docCod: '9001',
    titCod: '1',
    valorTitulo: 100,
    vencimentoTitulo: '2026-10-20',
    dataDebito: '2026-10-20',
    situacao: 'SO_FRACA',
    candidatos: [candidato],
    totalCandidatos: 1,
    motivo: 'Sem confirmação',
    avisoVenceAntes: 'ATENCAO',
    diasVencidoNoDebito: 0,
  }

  it('aceita titulos[], contagemSituacao, situacao, avisoVenceAntes e totalCandidatos', () => {
    const r = listagemSugestoesBoletoSchema.parse({
      sugestoes: [],
      titulos: [desfecho],
      totalTitulos: 1,
      contagemSituacao: { SO_FRACA: 1 },
      total: 0,
      pagina: 1,
      tamanho: 50,
      contagem: {},
    })
    expect(r.titulos?.[0]).toMatchObject({
      situacao: 'SO_FRACA',
      avisoVenceAntes: 'ATENCAO',
      totalCandidatos: 1,
    })
    expect(r.contagemSituacao).toEqual({ SO_FRACA: 1 })
  })

  it('os dois sinais novos NÃO quebram o parse da lista inteira', () => {
    expect(SINAIS_SUGESTAO_BOLETO).toEqual(
      expect.arrayContaining(['VENCE_ANTES_DO_TITULO', 'RECONHECEU_VENCE_ANTES']),
    )
    const r = listagemSugestoesBoletoSchema.parse({
      sugestoes: [
        {
          ...sugestao,
          avaliacao: {
            ...sugestao.avaliacao,
            sinais: ['MESMO_DIA', 'VENCE_ANTES_DO_TITULO', 'RECONHECEU_VENCE_ANTES'],
          },
        },
      ],
      total: 1,
      pagina: 1,
      tamanho: 50,
      contagem: {},
    })
    expect(r.sugestoes[0]?.avaliacao.sinais).toContain('RECONHECEU_VENCE_ANTES')
  })

  it('os sinais da âncora DPS (I15p, ADR-0073) passam no schema', () => {
    const r = listagemSugestoesBoletoSchema.parse({
      sugestoes: [
        {
          ...sugestao,
          avaliacao: { ...sugestao.avaliacao, sinais: ['VALOR_IGUAL', 'DPS_IGUAL', 'ORDEM_DPS'] },
        },
      ],
      total: 1,
      pagina: 1,
      tamanho: 50,
      contagem: {},
    })
    expect(r.sugestoes[0]?.avaliacao.sinais).toEqual(['VALOR_IGUAL', 'DPS_IGUAL', 'ORDEM_DPS'])
  })

  it('o sinal da âncora de número (I15s, ADR-0079) passa no schema', () => {
    const r = listagemSugestoesBoletoSchema.parse({
      sugestoes: [
        {
          ...sugestao,
          avaliacao: {
            ...sugestao.avaliacao,
            sinais: ['VALOR_ATE_5_CENTAVOS', 'NUMERO_IGUAL', 'NUMERO_CONFIAVEL'],
          },
        },
      ],
      total: 1,
      pagina: 1,
      tamanho: 50,
      contagem: {},
    })
    expect(r.sugestoes[0]?.avaliacao.sinais).toContain('NUMERO_CONFIAVEL')
  })

  it('resposta antiga (sem os campos novos) ainda é aceita', () => {
    const r = listagemSugestoesBoletoSchema.parse({
      sugestoes: [sugestao],
      total: 1,
      pagina: 1,
      tamanho: 50,
      contagem: {},
    })
    expect(r.titulos).toBeUndefined()
    expect(r.contagemSituacao).toBeUndefined()
  })

  it('o candidato não tem campo para barras nem linha digitável', () => {
    const parsed = desfechoTituloSchema.parse({
      ...desfecho,
      candidatos: [{ ...candidato, codbar: '1'.repeat(44), linhaDigitavel: '2'.repeat(47) }],
    })
    expect(JSON.stringify(parsed)).not.toMatch(/\d{20,}/)
  })

  it('nº do documento (doc_esp_numero) passa e é preservado na sugestão e no desfecho', () => {
    expect(sugestaoBoletoSchema.parse({ ...sugestao, numeroDocumento: '25349' }).numeroDocumento).toBe(
      '25349',
    )
    expect(desfechoTituloSchema.parse({ ...desfecho, numeroDocumento: '25349' }).numeroDocumento).toBe(
      '25349',
    )
    // Opcional: backend antigo, sem o campo, continua passando.
    expect(desfechoTituloSchema.parse(desfecho).numeroDocumento).toBeUndefined()
  })

    it('situação desconhecida é recusada (enum fechado)', () => {
    expect(
      desfechoTituloSchema.safeParse({ ...desfecho, situacao: 'INVENTADA' }).success,
    ).toBe(false)
  })
})
