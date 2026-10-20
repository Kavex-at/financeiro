import { ACAO_PAGAMENTO, DONO_PAGAMENTO, FONTE_SITUACAO, MOTIVO_PAGAMENTO } from '@/lib/sispag'
import {
  ACAO_DO_MOTIVO,
  DONO_DO_MOTIVO,
  EFEITO_MOTIVO,
  ORIENTACAO_NO_CONEXOS,
  ROTULO_ACAO,
  ROTULO_DONO,
  ROTULO_FONTE,
  ROTULO_MOTIVO,
} from './rotulos'

describe('tabelas de rótulos da situação de pagamento', () => {
  it.each(Object.values(MOTIVO_PAGAMENTO))('o motivo %s tem rótulo, dono, ação e efeito', (m) => {
    expect(ROTULO_MOTIVO[m]).toBeTruthy()
    expect(EFEITO_MOTIVO[m]).toBeTruthy()
    expect(DONO_DO_MOTIVO[m]).toBeDefined()
    expect(ACAO_DO_MOTIVO[m]).toBeDefined()
  })

  it.each(Object.values(DONO_PAGAMENTO))('o dono %s tem rótulo', (d) => {
    expect(ROTULO_DONO[d]).toBeTruthy()
  })

  it.each(Object.values(ACAO_PAGAMENTO))('a ação %s tem rótulo', (a) => {
    expect(ROTULO_ACAO[a]).toBeTruthy()
  })

  it.each(Object.values(FONTE_SITUACAO))('a fonte %s tem rótulo', (f) => {
    expect(ROTULO_FONTE[f]).toBeTruthy()
  })

  it('toda ação do motivo existe na tabela de rótulos de ação', () => {
    for (const m of Object.values(MOTIVO_PAGAMENTO)) {
      expect(ROTULO_ACAO[ACAO_DO_MOTIVO[m]]).toBeTruthy()
    }
  })

  it('as ações sem tela própria têm orientação para o Conexos', () => {
    for (const a of [
      ACAO_PAGAMENTO.ABRIR_NO_CONEXOS,
      ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS,
      ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS,
    ]) {
      expect(ORIENTACAO_NO_CONEXOS[a]?.passos).toBeTruthy()
    }
  })
})
