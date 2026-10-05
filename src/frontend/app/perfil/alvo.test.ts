/**
 * Rótulo do alvo no histórico: o que o analista reconhece, nunca o id cru (que vai no tooltip).
 */
import type { LinhaHistorico } from '@/lib/api/perfil'
import { descreverAcao, descreverExcecoes, rotuloAlvo } from './alvo'

const linha = (over: Partial<LinhaHistorico>): LinhaHistorico => ({
  em: '2026-10-02T14:00:00.000000Z',
  frente: 'sispag',
  acao: 'lote_criado',
  alvoTipo: 'lote',
  alvoId: '33333333-3333-4333-8333-333333333333',
  fonte: 'lote_criado',
  fonteId: '1',
  status: 'info',
  detalhe: {},
  ...over,
})

describe('rotuloAlvo', () => {
  it('lote com remessa: "Lote nº", filial e banco; o UUID só no tooltip', () => {
    const r = rotuloAlvo(linha({ detalhe: { remessaNum: 231001, filCod: 1, banco: '341' } }))
    expect(r).toEqual({
      texto: 'Lote nº 231001',
      prefixo: 'Lote nº',
      codigo: '231001',
      detalhe: 'filial 1 · banco 341',
      titulo: 'lote 33333333-3333-4333-8333-333333333333',
    })
  })

  it('lote sem remessa (rascunho): id curto', () => {
    expect(rotuloAlvo(linha({ detalhe: { filCod: 1 } })).texto).toBe('Lote #33333333')
  })

  it('conciliação: banco e contagens, dizendo "agendados" e nunca "pagos"', () => {
    const r = rotuloAlvo(
      linha({
        acao: 'retorno_conciliado',
        alvoTipo: 'retorno',
        alvoId: '1-341-1-1',
        detalhe: { bncCod: 341, filCod: 1, agendados: 2, rejeitados: 1 },
      }),
    )
    expect(r.texto).toBe('Retorno do banco 341')
    expect(r.detalhe).toBe('filial 1 · 2 agendados, 1 rejeitado')
    expect(`${r.texto} ${r.detalhe}`).not.toMatch(/pago/i)
  })

  it('título do destino de pagamento: documento/parcela', () => {
    const r = rotuloAlvo(
      linha({ alvoTipo: 'titulo', alvoId: '1-5503-2', detalhe: { filCod: 1, docCod: '5503', titCod: '2' } }),
    )
    expect(r.texto).toBe('Título 5503/2')
  })

  it('adiantamento, processo e alerta', () => {
    expect(rotuloAlvo(linha({ alvoTipo: 'adiantamento', alvoId: '118230' })).texto).toBe('Adiantamento 118230')
    expect(rotuloAlvo(linha({ alvoTipo: 'processo', alvoId: '40211' })).texto).toBe('Processo 40211')
    expect(rotuloAlvo(linha({ alvoTipo: 'alerta', alvoId: '1', detalhe: { alvoAlerta: 'lote 231001' } })).texto).toBe(
      'Alerta: lote 231001',
    )
  })

  describe('evento de acesso: o que mudou, nunca o id do usuário', () => {
    const acesso = (acao: string, detalhe: LinhaHistorico['detalhe']) =>
      rotuloAlvo(linha({ frente: 'plataforma', acao, alvoTipo: 'usuario', alvoId: '2', detalhe })).texto

    it('papel recebido: antes → depois', () => {
      expect(
        acesso('acesso_recebido', {
          tipoAcesso: 'papel',
          outroUsername: 'admin',
          papelAntes: 'Leitura Permutas',
          papelDepois: 'Analista Financeiro',
        }),
      ).toBe('Papel: Leitura Permutas → Analista Financeiro')
    })

    it('alteração feita em outra pessoa leva o nome dela', () => {
      expect(acesso('acesso_alterado', { tipoAcesso: 'ativo', outroUsername: 'rafael.lima', ativoDepois: false })).toBe(
        'rafael.lima: Usuário desativado',
      )
    })

    it('senha e tipo desconhecido', () => {
      expect(acesso('acesso_recebido', { tipoAcesso: 'senha' })).toBe('Senha alterada')
      expect(acesso('acesso_recebido', { tipoAcesso: 'novo' })).toBe('Acesso alterado')
    })

    it('nenhum rótulo mostra o id cru', () => {
      expect(acesso('acesso_recebido', { tipoAcesso: 'papel', papelDepois: 'Consulta' })).not.toBe('2')
    })
  })
})

describe('descreverExcecoes', () => {
  it('concedida, revogada, mudança de efeito e remoção', () => {
    expect(
      descreverExcecoes(
        [
          { permissao: 'recebimentos:executar', efeito: 'conceder' },
          { permissao: 'operacao:ver', efeito: 'conceder' },
        ],
        [
          { permissao: 'recebimentos:executar', efeito: 'revogar' },
          { permissao: 'metricas:ver', efeito: 'conceder' },
        ],
      ),
    ).toMatch(/revogada.*concedida.*exceção removida|concedida.*revogada.*exceção removida/)
  })

  it('usa o rótulo do catálogo de permissões', () => {
    expect(descreverExcecoes([], [{ permissao: 'sispag:excecao', efeito: 'conceder' }])).toMatch(
      /^SISPAG — .+ concedida$/,
    )
  })

  it('sem diferença: texto genérico', () => {
    expect(descreverExcecoes([], [])).toBe('Exceções de permissão')
  })
})

describe('descreverAcao — eventos de acesso', () => {
  const acao = (acaoCod: string, detalhe: LinhaHistorico['detalhe']) =>
    descreverAcao(linha({ frente: 'plataforma', acao: acaoCod, alvoTipo: 'usuario', alvoId: '2', detalhe }))

  it('troca da própria senha (ator = alvo, sem "outro")', () => {
    expect(acao('acesso_recebido', { tipoAcesso: 'senha' })).toBe('Alterou a própria senha')
  })

  it('senha redefinida por um admin, dos dois lados', () => {
    expect(acao('acesso_recebido', { tipoAcesso: 'senha', outroUsername: 'admin' })).toBe(
      'Sua senha foi redefinida por admin',
    )
    expect(acao('acesso_alterado', { tipoAcesso: 'senha', outroUsername: 'rafael.lima' })).toBe(
      'Redefiniu a senha de rafael.lima',
    )
  })

  it('alteração do próprio acesso nunca diz "outro usuário"', () => {
    expect(acao('acesso_recebido', { tipoAcesso: 'papel', papelDepois: 'Consulta' })).toBe('Alterou o próprio acesso')
    expect(acao('acesso_recebido', { tipoAcesso: 'papel', outroUsername: 'admin' })).toBe(
      'Seu acesso foi alterado por admin',
    )
  })
})
