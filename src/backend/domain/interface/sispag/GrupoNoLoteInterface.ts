/**
 * Grupo de boleto como um BLOCO do lote (ADR-0076, I19j): a tela mostra o grupo como uma linha
 * (boleto mascarado, total, credor, vencimento do boleto, situação) que expande os N títulos.
 * Os N itens continuam em `LotePagamento.itens`, cada um com `grupoBoletoId`.
 */
export interface TituloDoGrupoNoLote {
    filCod: number;
    docCod: string;
    titCod: string;
}

export interface GrupoNoLote {
    grupoId: string;
    /** Máscara 5+4 (I17j). Nunca o código. */
    codbarMascarado: string;
    /** Valor do boleto em reais (mesma unidade de `ItemLote.valor`). */
    valorBoleto: number;
    /** Data civil `YYYY-MM-DD`: é a que vale para a formação automática e para L6 (PI-8). */
    vencimentoBoleto: string;
    credor?: string;
    /** `SituacaoGrupo` derivada (`libs/boleto/SituacaoGrupoBoleto.ts`) no contexto deste lote. */
    situacao: string;
    titulos: TituloDoGrupoNoLote[];
}

/** Avisos devolvidos com a inclusão do grupo no lote (não barram a inclusão). */
export const AVISO_INCLUSAO_GRUPO = {
    /** I19r/PI-9: o J anterior foi rejeitado e o borderô antigo pode seguir no Conexos. */
    BORDERO_ANTERIOR_A_RESOLVER: 'BORDERO_ANTERIOR_A_RESOLVER',
} as const;
export type AvisoInclusaoGrupo = (typeof AVISO_INCLUSAO_GRUPO)[keyof typeof AVISO_INCLUSAO_GRUPO];

export const AVISO_INCLUSAO_GRUPO_TEXTO: Readonly<Record<AvisoInclusaoGrupo, string>> = {
    BORDERO_ANTERIOR_A_RESOLVER:
        'O pagamento anterior deste boleto agrupado foi rejeitado pelo banco. Resolva o borderô ' +
        'antigo no Conexos (fin010) antes de gerar a remessa: se ele continuar em cadastro e fora ' +
        'dos pendentes do lote novo, o grupo será retirado na remessa.',
};
