import type { BoletoDdaSituacao } from '@/lib/sispag'

/** Selo da situação do boleto (aba Boletos DDA e gaveta do título). */
export const SITUACAO_BADGE: Record<BoletoDdaSituacao, { label: string; className: string; title: string }> =
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
    SEM_TITULO: {
      label: 'sem título',
      className: 'border-muted text-muted-foreground',
      title: 'Livre, e nenhum título aberto cai nos limites seguros de valor e vencimento.',
    },
  }
