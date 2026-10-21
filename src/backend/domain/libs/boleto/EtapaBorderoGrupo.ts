/**
 * Etapas do ledger `sispag_grupo_boleto_execucao` — write-ahead do borderô de um grupo numa
 * remessa (I19l–q, I19s; ADR-0076). Os valores são os do CHECK da migration 0089.
 */
export const ETAPA_BORDERO_GRUPO = {
    /**
     * Write-ahead: intenção gravada com `t0` ANTES do `POST fin010` (I19l(1)). Não há marcador no
     * ERP (decisão de 2026-10-21): a identidade do borderô é `filCod + borCod + borTimCad`.
     */
    INTENCAO_GRAVADA: 'intencao_gravada',
    /** `POST fin010` observado; `t1`, `borCod` e `borTimCad` persistidos (I19l(2)). */
    BORDERO_CRIADO: 'bordero_criado',
    /** Uma baixa por título gravada (I19l(3)). */
    BAIXAS_GRAVADAS: 'baixas_gravadas',
    /** Releitura: N baixas dos títulos esperados e `vlrTotalLiquido == valorBoleto` (I19l(4)). */
    BORDERO_CONFERIDO: 'bordero_conferido',
    /** Item nativo com o `borCod` observado no rascunho (I19n). */
    IMPORTADO: 'importado',
    /** Barra vinculada ao item de borderô e relida (I19o). */
    CODBAR_VINCULADO: 'codbar_vinculado',
    CONCLUIDO: 'concluido',
    /** Desvio: borCod antigo de um J rejeitado adotado neste write-ahead (I19s, PI-9). */
    REAPROVEITADO: 'reaproveitado',
    /** Desvio: falha determinística, grupo retirado do lote (I19p(3)). */
    RETIRADO: 'retirado',
    /** Limpeza observada: item, baixas e borderô ausentes na releitura (I19q). */
    LIMPO: 'limpo',
    /** Não se pode (ou não se conseguiu) limpar: `Alerta` e decisão da analista (I19q). */
    LIMPEZA_PENDENTE: 'limpeza_pendente',
    /**
     * Estado do ERP que o sistema não sabe reconhecer (dois borderôs na janela de identidade,
     * nosso `borCod` com outro `borTimCad`, baixa alheia…).
     */
    INDETERMINADO: 'indeterminado',
    /** Transitória (timeout/5xx/releitura inconclusiva, I19p(2)): a retomada continua. */
    FAILED: 'failed',
    /** Dry-run: montado e logado, nada escrito. */
    SIMULADO: 'simulado',
} as const;
export type EtapaBordero = (typeof ETAPA_BORDERO_GRUPO)[keyof typeof ETAPA_BORDERO_GRUPO];

const E = ETAPA_BORDERO_GRUPO;

/** Para onde a limpeza leva (I19q). */
const LIMPEZA: readonly EtapaBordero[] = [E.LIMPO, E.LIMPEZA_PENDENTE];
/** Toda etapa em andamento pode falhar (transitória), ser retirada ou ficar indeterminada. */
const DESVIOS: readonly EtapaBordero[] = [E.FAILED, E.RETIRADO, E.INDETERMINADO, ...LIMPEZA];

/**
 * Grafo de transições.
 *
 *  - Caminho feliz: intenção → criado → baixas → conferido → importado → codbar → concluído.
 *  - Reaproveitamento (I19s): intenção → reaproveitado → conferido (nunca cria outro borderô).
 *  - `failed` (I19p(2)) não é terminal: a retomada reconhece o ERP ao vivo e retoma em qualquer
 *    etapa à frente da intenção (o write-ahead é um só: nunca volta a `intencao_gravada`).
 *  - Limpeza (I19q): de qualquer etapa com possível borderô nosso, inclusive depois de
 *    `concluido` (G3: lote local cancelado com rascunho nativo aberto) e de `retirado`.
 *    `podeLimpar` é a guarda; a transição só registra o desfecho.
 */
const TRANSICOES: Readonly<Record<EtapaBordero, ReadonlySet<EtapaBordero>>> = {
    [E.INTENCAO_GRAVADA]: new Set([E.BORDERO_CRIADO, E.REAPROVEITADO, E.SIMULADO, ...DESVIOS]),
    [E.BORDERO_CRIADO]: new Set([E.BAIXAS_GRAVADAS, ...DESVIOS]),
    [E.BAIXAS_GRAVADAS]: new Set([E.BORDERO_CONFERIDO, ...DESVIOS]),
    [E.REAPROVEITADO]: new Set([E.BORDERO_CONFERIDO, ...DESVIOS]),
    [E.BORDERO_CONFERIDO]: new Set([E.IMPORTADO, ...DESVIOS]),
    [E.IMPORTADO]: new Set([E.CODBAR_VINCULADO, ...DESVIOS]),
    [E.CODBAR_VINCULADO]: new Set([E.CONCLUIDO, ...DESVIOS]),
    [E.FAILED]: new Set([
        E.BORDERO_CRIADO,
        E.BAIXAS_GRAVADAS,
        E.BORDERO_CONFERIDO,
        E.IMPORTADO,
        E.CODBAR_VINCULADO,
        E.CONCLUIDO,
        E.REAPROVEITADO,
        E.RETIRADO,
        E.INDETERMINADO,
        ...LIMPEZA,
    ]),
    [E.CONCLUIDO]: new Set(LIMPEZA),
    [E.RETIRADO]: new Set(LIMPEZA),
    [E.LIMPO]: new Set(),
    [E.LIMPEZA_PENDENTE]: new Set(),
    [E.INDETERMINADO]: new Set(),
    [E.SIMULADO]: new Set(),
};

/**
 * Terminais: nenhum passo de PREPARAÇÃO a seguir — liberam o índice "no máximo uma execução não
 * terminal por grupo" (uma remessa nova, depois de J rejeitado, abre outra execução). `concluido`
 * e `retirado` ainda admitem a limpeza (compensação); os demais terminais são finais.
 */
const TERMINAIS: ReadonlySet<EtapaBordero> = new Set<EtapaBordero>([
    E.CONCLUIDO,
    E.RETIRADO,
    E.LIMPO,
    E.LIMPEZA_PENDENTE,
    E.INDETERMINADO,
    E.SIMULADO,
]);

/** Etapas em que não há borderô nosso a apagar (já limpo, entregue à analista, nada escrito). */
const SEM_LIMPEZA: ReadonlySet<EtapaBordero> = new Set<EtapaBordero>([
    E.LIMPO,
    E.LIMPEZA_PENDENTE,
    E.INDETERMINADO,
    E.SIMULADO,
    E.REAPROVEITADO,
]);

/** Máquina de estados PURA do borderô do grupo (I19l–q, I19s). */
export default class EtapaBorderoGrupo {
    /** Todas as etapas, na ordem declarada (fonte única do CHECK da 0089). */
    public static todas = (): EtapaBordero[] => Object.values(E);

    public static podeTransicionar = (de: EtapaBordero, para: EtapaBordero): boolean =>
        TRANSICOES[de]?.has(para) === true;

    /** Devolve `para` ou lança — transição inválida é bug, nunca estado a gravar. */
    public static transicionar = (de: EtapaBordero, para: EtapaBordero): EtapaBordero => {
        if (!EtapaBorderoGrupo.podeTransicionar(de, para)) {
            throw new Error(`transição inválida do borderô do grupo: ${de} → ${para}`);
        }
        return para;
    };

    public static ehTerminal = (etapa: EtapaBordero): boolean => TERMINAIS.has(etapa);

    /**
     * I19q — a limpeza só apaga o borderô que NÓS criamos nesta execução e só enquanto o lote
     * nativo não foi finalizado e não tem `.REM`, os dois lidos AGORA (ausente ⇒ não, fail-closed).
     * `vldHasRemessaPgto` NÃO é guarda (decisão de 2026-10-21): vale 1 desde o `importar` e 0
     * depois do `DELETE` do item, logo não diz se o borderô foi ao banco. Borderô reaproveitado de
     * um J rejeitado nunca é apagado (só o item nativo sai). Falso ⇒ `Alerta`
     * `sispag-bordero-grupo-pendente` e a analista decide.
     */
    public static podeLimpar = (
        etapa: EtapaBordero,
        ctx: { loteNativoFinalizado?: boolean; remessaGerada?: boolean; reaproveitado: boolean },
    ): boolean =>
        !SEM_LIMPEZA.has(etapa) &&
        !ctx.reaproveitado &&
        ctx.loteNativoFinalizado === false &&
        ctx.remessaGerada === false;
}
