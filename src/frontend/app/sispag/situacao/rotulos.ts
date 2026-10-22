import {
  ACAO_PAGAMENTO,
  type AcaoPagamento,
  DONO_PAGAMENTO,
  type DonoPagamento,
  FONTE_SITUACAO,
  type FonteSituacao,
  MOTIVO_PAGAMENTO,
  type MotivoPagamento,
  SUGESTAO_BOLETO_SEM_DDA,
  type SugestaoBoletoSemDda,
} from '@/lib/sispag'

/**
 * A ÚNICA tabela de textos da situação de pagamento (ADR-0075) no frontend: rótulo do motivo,
 * quem resolve, o botão e o efeito. O backend manda `rotulo`/`acao.rotulo` prontos para a linha;
 * estas tabelas existem para o que a tela mostra SEM linha (chips de motivo, cards, regras "?").
 * Um teste garante que todo motivo do contrato tem entrada em cada tabela.
 */

export const ROTULO_MOTIVO: Readonly<Record<MotivoPagamento, string>> = {
  [MOTIVO_PAGAMENTO.ALCADA]: 'Aguardando aprovação',
  [MOTIVO_PAGAMENTO.TIPO_PERMUTA]: 'Permuta ou adiantamento',
  [MOTIVO_PAGAMENTO.VENCIDO]: 'Vencido',
  [MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG]: 'Forma não paga por SISPAG',
  [MOTIVO_PAGAMENTO.DUPLICIDADE]: 'Possível duplicidade',
  [MOTIVO_PAGAMENTO.RETIDO_CODBAR]: 'Retido por boleto repetido',
  [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE]: 'Ajuste de centavos pendente',
  [MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR]: 'Confirmação de boleto a revisar',
  [MOTIVO_PAGAMENTO.BOLETO_SEM_DDA]: 'Boleto sem DDA',
}

/** Sub-chips de "Boleto sem DDA" (I19r): em que pé está a sugestão de boleto. */
export const ROTULO_SUGESTAO_BOLETO: Readonly<Record<SugestaoBoletoSemDda, string>> = {
  [SUGESTAO_BOLETO_SEM_DDA.PARA_CONFIRMAR]: 'Sugestão para confirmar',
  [SUGESTAO_BOLETO_SEM_DDA.A_ESCOLHER]: 'Boleto a escolher',
  [SUGESTAO_BOLETO_SEM_DDA.CANDIDATO_FRACO]: 'Só candidato fraco',
  [SUGESTAO_BOLETO_SEM_DDA.SEM_CANDIDATO]: 'Sem boleto no DDA',
  [SUGESTAO_BOLETO_SEM_DDA.AGUARDANDO_VINCULO]: 'Confirmado, aguardando vínculo',
}

export const ROTULO_DONO: Readonly<Record<DonoPagamento, string>> = {
  [DONO_PAGAMENTO.VOCE]: 'Você',
  [DONO_PAGAMENTO.APROVADOR]: 'Aprovador',
  [DONO_PAGAMENTO.PERMUTAS]: 'Permutas',
  [DONO_PAGAMENTO.CONTAS_A_PAGAR]: 'Contas a pagar',
  [DONO_PAGAMENTO.CADASTRO]: 'Cadastro',
}

/** Quem resolve cada motivo (espelha a tabela do plano, §3). */
export const DONO_DO_MOTIVO: Readonly<Record<MotivoPagamento, DonoPagamento>> = {
  [MOTIVO_PAGAMENTO.ALCADA]: DONO_PAGAMENTO.APROVADOR,
  [MOTIVO_PAGAMENTO.TIPO_PERMUTA]: DONO_PAGAMENTO.PERMUTAS,
  [MOTIVO_PAGAMENTO.VENCIDO]: DONO_PAGAMENTO.CONTAS_A_PAGAR,
  [MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG]: DONO_PAGAMENTO.VOCE,
  [MOTIVO_PAGAMENTO.DUPLICIDADE]: DONO_PAGAMENTO.VOCE,
  [MOTIVO_PAGAMENTO.RETIDO_CODBAR]: DONO_PAGAMENTO.VOCE,
  [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE]: DONO_PAGAMENTO.VOCE,
  [MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR]: DONO_PAGAMENTO.VOCE,
  [MOTIVO_PAGAMENTO.BOLETO_SEM_DDA]: DONO_PAGAMENTO.VOCE,
}

/** A ação do motivo (a linha usa a que o backend mandar; esta alimenta a tabela de regras). */
export const ACAO_DO_MOTIVO: Readonly<Record<MotivoPagamento, AcaoPagamento>> = {
  [MOTIVO_PAGAMENTO.ALCADA]: ACAO_PAGAMENTO.ABRIR_NO_CONEXOS,
  [MOTIVO_PAGAMENTO.TIPO_PERMUTA]: ACAO_PAGAMENTO.ABRIR_EM_PERMUTAS,
  [MOTIVO_PAGAMENTO.VENCIDO]: ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS,
  [MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG]: ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS,
  [MOTIVO_PAGAMENTO.DUPLICIDADE]: ACAO_PAGAMENTO.TRATAR_DUPLICIDADE,
  [MOTIVO_PAGAMENTO.RETIDO_CODBAR]: ACAO_PAGAMENTO.DESFAZER_RETENCAO,
  [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE]: ACAO_PAGAMENTO.TENTAR_AJUSTE,
  [MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR]: ACAO_PAGAMENTO.VER_BOLETO,
  [MOTIVO_PAGAMENTO.BOLETO_SEM_DDA]: ACAO_PAGAMENTO.VER_BOLETO,
}

export const ROTULO_ACAO: Readonly<Record<AcaoPagamento, string>> = {
  [ACAO_PAGAMENTO.ABRIR_NO_CONEXOS]: 'Abrir no Conexos',
  [ACAO_PAGAMENTO.ABRIR_EM_PERMUTAS]: 'Abrir em Permutas',
  [ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS]: 'Renegociar no Conexos',
  [ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS]: 'Corrigir a forma no Conexos',
  [ACAO_PAGAMENTO.TRATAR_DUPLICIDADE]: 'Tratar alerta',
  [ACAO_PAGAMENTO.DESFAZER_RETENCAO]: 'Desfazer retenção',
  [ACAO_PAGAMENTO.TENTAR_AJUSTE]: 'Tentar o ajuste de novo',
  [ACAO_PAGAMENTO.VER_BOLETO]: 'Ver boleto',
}

export const EFEITO_MOTIVO: Readonly<Record<MotivoPagamento, string>> = {
  [MOTIVO_PAGAMENTO.ALCADA]: 'Não entra em lote até o aprovador liberar (alçada).',
  [MOTIVO_PAGAMENTO.TIPO_PERMUTA]:
    'Não é pagamento por SISPAG. O tipo é uma indicação: pode já ter permuta parcial.',
  [MOTIVO_PAGAMENTO.VENCIDO]: 'O ERP recusa finalizar com vencimento passado.',
  [MOTIVO_PAGAMENTO.FORMA_NAO_SISPAG]:
    'Cheque, extra-caixa, cartão de crédito e caixa não saem por remessa.',
  [MOTIVO_PAGAMENTO.DUPLICIDADE]: 'Barra o título até justificar ou desfazer o bloqueio.',
  [MOTIVO_PAGAMENTO.RETIDO_CODBAR]:
    'O sistema retirou o título por boleto repetido ou ilegível e o mantém retido.',
  [MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE]:
    'A renegociação de centavos no Conexos não terminou.',
  [MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR]:
    'O Conexos sinalizou o título depois da confirmação do boleto.',
  [MOTIVO_PAGAMENTO.BOLETO_SEM_DDA]:
    'Sem o código de barras a remessa não sai. O chip se divide pela sugestão: para confirmar, a escolher, só candidato fraco, sem boleto no DDA e confirmado aguardando o vínculo.',
}

/**
 * O que a analista faz no Conexos quando a ação não tem tela própria aqui. Nunca um botão morto:
 * a ação abre este texto, com o documento para copiar.
 */
export const ORIENTACAO_NO_CONEXOS: Readonly<
  Partial<Record<AcaoPagamento, { titulo: string; passos: string }>>
> = {
  [ACAO_PAGAMENTO.ABRIR_NO_CONEXOS]: {
    titulo: 'Cobrar a liberação no Conexos',
    passos:
      'O título ainda está em alçada. Peça ao aprovador que libere no Conexos (liberação de títulos, fin103). Depois de liberado, ele volta a Pronto na próxima ingestão.',
  },
  [ACAO_PAGAMENTO.RENEGOCIAR_NO_CONEXOS]: {
    titulo: 'Renegociar o vencimento no Conexos',
    passos:
      'O vencimento já passou. A renegociação de pagamentos (fin070) gera um título novo com vencimento futuro; ele entra na carteira na próxima ingestão.',
  },
  [ACAO_PAGAMENTO.CORRIGIR_FORMA_NO_CONEXOS]: {
    titulo: 'Corrigir a forma de pagamento no Conexos',
    passos:
      'A forma "Pago por" do título não sai por remessa. Se o pagamento será por boleto, TED ou PIX, corrija a forma no título (psq014) e aguarde a próxima ingestão.',
  },
}

export const ROTULO_FONTE: Readonly<Record<FonteSituacao, string>> = {
  [FONTE_SITUACAO.DUPLICIDADE]: 'bloqueios por duplicidade',
  [FONTE_SITUACAO.AJUSTE_CENTAVOS]: 'ajustes de centavos',
  [FONTE_SITUACAO.BOLETO]: 'sugestões de boleto',
}
