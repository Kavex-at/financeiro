import {
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

  it('os códigos de erro espelham os do backend', () => {
    expect(Object.values(CODIGOS_ERRO_SUGESTAO_BOLETO).sort()).toEqual(
      [
        'BOLETO_JA_SUGERIDO_A_OUTRO_TITULO',
        'BOLETO_VENCIDO_NAO_CONFIRMAVEL',
        'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO',
        'CONFIRMACAO_EMISSOR_NAO_ENCONTRADA',
        'COPIA_LINHA_SEM_TRILHA',
        'SUGESTAO_BOLETO_INDISPONIVEL',
      ].sort(),
    )
  })
})
