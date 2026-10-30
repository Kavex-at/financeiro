import type { BoletoDdaSituacao } from '@/lib/sispag'

type SeloSituacao = { label: string; className: string; title: string }

/** Selo da situação do boleto (aba Boletos DDA e gaveta do título). */
export const SITUACAO_BADGE: Record<BoletoDdaSituacao, SeloSituacao> =
  {
    VINCULADO: {
      label: 'vinculado',
      className: 'border-success/40 text-success',
      title: 'O Conexos já ligou este boleto a um título (associação do fin015).',
    },
    CANDIDATO: {
      label: 'candidato',
      className: 'border-info/40 text-info',
      title: 'Livre. Um título aberto cai nos limites seguros de valor e vencimento — confira.',
    },
    AMBIGUO: {
      label: 'ambíguo',
      className: 'border-warning/40 text-warning',
      title: 'Livre. Mais de um título aberto cai nos limites seguros (cobrança recorrente).',
    },
    FORA_JANELA: {
      label: 'fora da janela',
      className: 'border-muted text-muted-foreground',
      title:
        'Livre, e o vencimento está fora do que a carteira carrega (15 dias atrás a 45 dias à frente): o título ainda não entrou, ou já saiu por idade.',
    },
    TITULO_SAIU_CARTEIRA: {
      label: 'saiu da carteira',
      className: 'border-muted text-muted-foreground',
      title:
        'Existe um título de valor e data próximos que já saiu da carteira (em regra quitado, mas pode ser cancelado, previsão ou renegociado). Escondido da lista padrão.',
    },
    SEM_TITULO: {
      label: 'sem título',
      className: 'border-muted text-muted-foreground',
      title: 'Livre, e nenhum título aberto cai nos limites seguros de valor e vencimento.',
    },
  }

/**
 * Selo tolerante: uma situação que este bundle não conhece (backend mais novo no deploy em
 * andamento) vira um selo neutro com o valor cru, em vez de derrubar a linha.
 */
export const badgeDaSituacao = (situacao: string): SeloSituacao =>
  (SITUACAO_BADGE as Record<string, SeloSituacao | undefined>)[situacao] ?? {
    label: situacao.toLowerCase().replace(/_/g, ' '),
    className: 'border-muted text-muted-foreground',
    title: 'Situação que esta versão da tela não conhece. Recarregue a página.',
  }
