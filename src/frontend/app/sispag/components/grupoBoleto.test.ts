import {
  AVISO_TITULO_VENCE_ANTES_DO_BOLETO,
  avaliarTituloNaComposicao,
  chavesDeTitulosEmGrupo,
  EXPLICACAO_INTERCAMBIAVEL,
  orientacaoSituacaoGrupo,
  resumoMotivosGrupo,
  rotuloMotivoGrupo,
  rotuloSituacaoGrupo,
  somarComposicao,
  tituloEmGrupo,
} from './grupoBoleto'

/**
 * Rótulos em português e as contas da composição manual (ADR-0077, I21g): a tela explica por que
 * um grupo não é confirmável e mostra a soma ao vivo, em centavos inteiros (nunca float).
 */

describe('rotuloSituacaoGrupo', () => {
  it.each([
    ['DISPONIVEL', 'Disponível'],
    ['EM_LOTE', 'Em lote'],
    ['EM_REMESSA', 'Em remessa'],
    ['REJEITADO', 'Rejeitado pelo banco'],
    ['RETIDO', 'Retido'],
    ['DIVERGENTE', 'Divergente'],
    ['ORFAO', 'Órfão'],
    ['ANULADO', 'Anulado'],
    ['PAGO', 'Pago'],
  ])('%s → %s', (situacao, rotulo) => {
    expect(rotuloSituacaoGrupo(situacao)).toBe(rotulo)
  })

  it('situação desconhecida aparece como veio (nunca some)', () => {
    expect(rotuloSituacaoGrupo('NOVA')).toBe('NOVA')
  })
})

describe('orientacaoSituacaoGrupo', () => {
  it('REJEITADO diz o que fazer: resolver o borderô antigo no Conexos antes de pôr o grupo num lote novo', () => {
    expect(orientacaoSituacaoGrupo('REJEITADO')).toBe(
      'Resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo.',
    )
  })

  it('órfão e divergente também orientam; as demais situações não', () => {
    expect(orientacaoSituacaoGrupo('ORFAO')).toMatch(/boleto|título/i)
    expect(orientacaoSituacaoGrupo('DIVERGENTE')).toMatch(/parte|títulos/i)
    expect(orientacaoSituacaoGrupo('DISPONIVEL')).toBeUndefined()
    expect(orientacaoSituacaoGrupo('PAGO')).toBeUndefined()
  })
})

describe('motivos de um grupo não confirmável', () => {
  it('NAO_LIBERADO é "aguardando alçada"', () => {
    expect(rotuloMotivoGrupo('NAO_LIBERADO')).toBe('aguardando alçada')
  })

  it('CRUZA_FILIAL diz que não é suportado e que se paga à mão', () => {
    expect(rotuloMotivoGrupo('CRUZA_FILIAL')).toBe(
      'não suportado: títulos de filiais diferentes, pagar à mão',
    )
  })

  it.each([
    'PAGO',
    'CREDORES_DIFERENTES',
    'SOMA_DIFERENTE',
    'BOLETO_VENCIDO',
    'MARCA_RETENCAO_ATIVA',
    'EM_OUTRO_GRUPO',
    'FORA_DA_JANELA',
    'VALOR_ABERTO_INDISPONIVEL',
  ])('%s tem texto próprio, diferente do código', (m) => {
    expect(rotuloMotivoGrupo(m)).not.toBe(m)
    expect(rotuloMotivoGrupo(m).length).toBeGreaterThan(5)
  })

  it('motivo desconhecido aparece como veio', () => {
    expect(rotuloMotivoGrupo('XYZ')).toBe('XYZ')
  })

  it('o resumo junta os motivos sem repetir, na ordem recebida', () => {
    expect(resumoMotivosGrupo(['NAO_LIBERADO', 'NAO_LIBERADO', 'CRUZA_FILIAL'])).toBe(
      'aguardando alçada; não suportado: títulos de filiais diferentes, pagar à mão',
    )
    expect(resumoMotivosGrupo([])).toBe('')
  })

  it('a explicação do intercambiável cabe em UMA linha', () => {
    expect(EXPLICACAO_INTERCAMBIAVEL).not.toContain('\n')
    expect(EXPLICACAO_INTERCAMBIAVEL).toMatch(/boletos iguais/i)
  })
})

describe('somarComposicao — soma ao vivo em centavos inteiros', () => {
  it('fecha quando a soma é igual ao boleto', () => {
    expect(somarComposicao([52500, 52500, 52500], 157500)).toEqual({
      somaCentavos: 157500,
      diferencaCentavos: 0,
      fecha: true,
    })
  })

  it('a diferença é soma − boleto, com sinal, e um centavo já não fecha', () => {
    expect(somarComposicao([52500, 52500, 52499], 157500)).toEqual({
      somaCentavos: 157499,
      diferencaCentavos: -1,
      fecha: false,
    })
    expect(somarComposicao([52500, 52500, 52501], 157500).diferencaCentavos).toBe(1)
  })

  it('nada selecionado: soma 0, diferença = −boleto, não fecha', () => {
    expect(somarComposicao([], 157500)).toEqual({
      somaCentavos: 0,
      diferencaCentavos: -157500,
      fecha: false,
    })
  })

  it('não acumula erro de ponto flutuante (0,10 + 0,20)', () => {
    expect(somarComposicao([10, 20], 30).fecha).toBe(true)
  })
})

describe('avaliarTituloNaComposicao — janela de 10 dias (I21g)', () => {
  const av = (vencBoleto: string, vencTitulo: string) =>
    avaliarTituloNaComposicao({ vencimentoBoleto: vencBoleto, vencimentoTitulo: vencTitulo })

  it('mesmo dia: dentro da janela, sem aviso', () => {
    expect(av('2026-10-21', '2026-10-21')).toEqual({
      deltaDias: 0,
      foraDaJanela: false,
      venceAntesDoBoleto: false,
    })
  })

  it('título que vence ANTES do boleto (Δ > 0, até 10 dias): dentro da janela, com aviso', () => {
    expect(av('2026-10-21', '2026-10-15')).toMatchObject({
      deltaDias: 6,
      foraDaJanela: false,
      venceAntesDoBoleto: true,
    })
    expect(av('2026-10-21', '2026-10-11')).toMatchObject({ deltaDias: 10, foraDaJanela: false })
  })

  it('11 dias ou título que vence DEPOIS do boleto: fora da janela, com o motivo em português', () => {
    const longe = av('2026-10-21', '2026-10-10')
    expect(longe).toMatchObject({ deltaDias: 11, foraDaJanela: true })
    expect(longe.motivoForaDaJanela).toMatch(/10 dias/)
    const depois = av('2026-10-21', '2026-10-22')
    expect(depois).toMatchObject({ deltaDias: -1, foraDaJanela: true })
    expect(depois.motivoForaDaJanela).toMatch(/depois do boleto/)
  })

  it('o aviso reconhecível tem o nome que o servidor confere', () => {
    expect(AVISO_TITULO_VENCE_ANTES_DO_BOLETO).toBe('TITULO_VENCE_ANTES_DO_BOLETO')
  })
})

describe('título de grupo não é selecionável avulso (aba de títulos)', () => {
  const grupos = [
    {
      estado: 'CONFIRMADO',
      titulos: [
        { filCod: 2, docCod: '901', titCod: '1' },
        { filCod: 2, docCod: '902', titCod: '1' },
      ],
    },
    { estado: 'ANULADO', titulos: [{ filCod: 2, docCod: '777', titCod: '1' }] },
  ]

  it('só os grupos CONFIRMADOS marcam os seus títulos (anulado libera)', () => {
    const chaves = chavesDeTitulosEmGrupo(grupos)
    expect(chaves).toEqual(new Set(['2:901:1', '2:902:1']))
    expect(tituloEmGrupo(chaves, { filCod: 2, docCod: '901', titCod: '1' })).toBe(true)
    expect(tituloEmGrupo(chaves, { filCod: 2, docCod: '777', titCod: '1' })).toBe(false)
    expect(tituloEmGrupo(chaves, { filCod: 4, docCod: '901', titCod: '1' })).toBe(false)
  })
})
