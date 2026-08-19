/**
 * Frente V — Workflow de Aprovação · constantes tipadas.
 *
 * Princípio P3 da ontologia: status são constantes tipadas, nunca strings cruas.
 * Ver `ontology/state-machines/aprovacao-titulo.md` e `etapa-aprovacao.md`.
 */

/**
 * `docTip` do Conexos. A Frente V, Fase 1, cobre **somente contas a pagar** (ADR-0038 D1).
 * O ERP documenta: 1 = SAÍDA A RECEBER, 2 = ENTRADA A PAGAR.
 */
export const DOC_TIP = {
    A_RECEBER: 1,
    A_PAGAR: 2,
} as const;

/** Status agregado do workflow de um título. */
export const STATUS_WORKFLOW = {
    SEM_WORKFLOW: 'SEM_WORKFLOW',
    AGUARDANDO: 'AGUARDANDO',
    APROVADO: 'APROVADO',
    REJEITADO: 'REJEITADO',
    INDETERMINADO: 'INDETERMINADO',
} as const;

export type StatusWorkflow = (typeof STATUS_WORKFLOW)[keyof typeof STATUS_WORKFLOW];

/** Status de uma etapa individual da trilha. */
export const ETAPA_STATUS = {
    PENDENTE: 'PENDENTE',
    CONCLUIDA: 'CONCLUIDA',
    REJEITADA: 'REJEITADA',
    INDETERMINADO: 'INDETERMINADO',
} as const;

export type EtapaStatus = (typeof ETAPA_STATUS)[keyof typeof ETAPA_STATUS];

/**
 * Tradução do `ftbVldStatus` bruto do Conexos para o status de domínio.
 *
 * ⚠️ **Este é o ÚNICO ponto do código que interpreta `ftbVldStatus`.** Não leia o número cru em
 * lugar nenhum — quando a pendência **PV-01** fechar, a correção tem de ser uma edição aqui.
 *
 * Observado em produção (filial 2, amostra de 300 títulos, 2026-08-18):
 *
 * | valor | ocorrências | leitura                                              |
 * |-------|-------------|------------------------------------------------------|
 * | `1`   | 8           | pendente (nesses, `ftbTimCmd == ftbTimBloq`)          |
 * | `2`   | 156         | respondido — bate com o "Respondido" da tela PSQ_027  |
 * | `7`   | **13**      | **DESCONHECIDO** → `INDETERMINADO` (**PV-01**)        |
 *
 * O spec OpenAPI não traz legenda para este enum. Qualquer valor fora do mapa cai em
 * `INDETERMINADO` — nunca em `CONCLUIDA` (invariante I4): classificar como aprovada uma etapa que
 * não sabemos ler contaminaria o tempo médio de um painel financeiro auditável.
 *
 * Ver `ontology/_inbox/frente-v-pendencias-validacao.md` § PV-01.
 */
export const ETAPA_STATUS_ERP: Readonly<Record<number, EtapaStatus>> = {
    1: ETAPA_STATUS.PENDENTE,
    2: ETAPA_STATUS.CONCLUIDA,
};

/**
 * Ações observadas em `fbaDesNome`. Ambas contam como conclusão positiva da etapa — premissa
 * registrada em **PV-02**, ainda não validada com o time: se `APROVAR` for etapa intermediária
 * (aprova mas não libera para pagamento), o status agregado ficará otimista.
 *
 * Observado: `LIBERAR` 122×, `APROVAR` 34×, vazio 21× (etapa pendente).
 */
export const ACAO_CONCLUSIVA = ['LIBERAR', 'APROVAR'] as const;

/**
 * Ações que significam **recusa** da etapa.
 *
 * ⚠️ **Nenhuma foi observada em produção** (169 etapas resolvidas, todas `LIBERAR` ou `APROVAR`).
 * A lista existe porque o ERP tem `motCodCanc`/`motDesNomeCanc` e a ação de cancelar bloqueio —
 * mas os rótulos abaixo são uma **aposta**, não um fato. Se a recusa real usar outro rótulo, ela
 * não casa aqui e a etapa cai em `INDETERMINADO` **com lacuna visível** — nunca em `CONCLUIDA`.
 * Esse é o comportamento desejado: errar para o lado de "não sei" (invariante I4).
 *
 * Fecha junto com **PV-02**.
 */
export const ACAO_REJEICAO = ['CANCELAR', 'RECUSAR', 'REJEITAR'] as const;

/**
 * Motivo de lacuna — o que NÃO conseguimos afirmar sobre um título, e por quê.
 *
 * Um painel financeiro auditável não apresenta número inferido como registro do ERP. Quando algo
 * não pode ser afirmado, o título carrega a lacuna e a UI a exibe (invariantes I3 e I4).
 */
export const LACUNA = {
    STATUS_ETAPA_DESCONHECIDO: 'STATUS_ETAPA_DESCONHECIDO',
    SEM_DATA_FINALIZACAO: 'SEM_DATA_FINALIZACAO',
    ETAPA_SEM_RESPONSAVEL: 'ETAPA_SEM_RESPONSAVEL',
    TIMESTAMPS_INCONSISTENTES: 'TIMESTAMPS_INCONSISTENTES',
    ACAO_ETAPA_DESCONHECIDA: 'ACAO_ETAPA_DESCONHECIDA',
} as const;

export type Lacuna = (typeof LACUNA)[keyof typeof LACUNA];

/** Texto legível de cada lacuna, para a UI não precisar de um dicionário próprio. */
export const LACUNA_DESCRICAO: Readonly<Record<Lacuna, string>> = {
    [LACUNA.STATUS_ETAPA_DESCONHECIDO]:
        'O ERP devolveu um status de etapa que ainda não sabemos interpretar (PV-01).',
    [LACUNA.SEM_DATA_FINALIZACAO]:
        'A data de finalização do documento não é exposta pela API acessível hoje; o relógio começa na primeira etapa (PV-04).',
    [LACUNA.ETAPA_SEM_RESPONSAVEL]: 'Etapa sem responsável registrado no ERP.',
    [LACUNA.TIMESTAMPS_INCONSISTENTES]:
        'A data da ação é anterior à data de recebimento da etapa; duração não calculada.',
    [LACUNA.ACAO_ETAPA_DESCONHECIDA]:
        'O ERP registrou uma ação de etapa que ainda não sabemos classificar como aprovação ou recusa (PV-02).',
};

/**
 * Chave do advisory lock da ingestão da Frente V.
 *
 * Número arbitrário mas ESTÁVEL — é a identidade da exclusão mútua entre execuções do job.
 * Distinto das chaves das outras frentes (`INGEST_LOCK_KEY` das permutas,
 * `RECEBIMENTO_INGEST_LOCK_KEY`): colidir faria uma frente bloquear a ingestão da outra sem motivo.
 */
export const APROVACOES_INGEST_LOCK_KEY = 918273649;
