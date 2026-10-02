/**
 * AtividadeUsuario — read model sobre os ledgers que já existem (ADR-0058). Sem tabela própria.
 *
 * Uma linha = uma ação registrada de UM usuário (ator; ou alvo, no evento de acesso). Os valores
 * de `fonte`, `acao`, `frente` e `status` são constantes tipadas: nenhuma rota, serviço ou SQL
 * escreve a string crua fora daqui.
 */

/** Os quatro períodos do perfil. */
export const TIPO_PERIODO = {
    HOJE: 'hoje',
    SEMANA: 'semana',
    MES: 'mes',
    PERSONALIZADO: 'personalizado',
} as const;
export type TipoPeriodo = (typeof TIPO_PERIODO)[keyof typeof TIPO_PERIODO];
export const TIPOS_PERIODO = Object.values(TIPO_PERIODO) as [TipoPeriodo, ...TipoPeriodo[]];

/** Frente da linha. `plataforma` = ações fora das três frentes (alerta, acesso). */
export const FRENTE_ATIVIDADE = {
    PERMUTAS: 'permutas',
    SISPAG: 'sispag',
    RECEBIMENTOS: 'recebimentos',
    PLATAFORMA: 'plataforma',
} as const;
export type FrenteAtividade = (typeof FRENTE_ATIVIDADE)[keyof typeof FRENTE_ATIVIDADE];
export const FRENTES_ATIVIDADE = Object.values(FRENTE_ATIVIDADE) as [
    FrenteAtividade,
    ...FrenteAtividade[],
];

/** Status normalizado (o bruto de cada ledger é traduzido por `STATUS_POR_FONTE`). */
export const STATUS_ATIVIDADE = {
    SUCESSO: 'sucesso',
    ERRO: 'erro',
    EM_ANDAMENTO: 'em_andamento',
    CANCELADO: 'cancelado',
    INFO: 'info',
} as const;
export type StatusAtividade = (typeof STATUS_ATIVIDADE)[keyof typeof STATUS_ATIVIDADE];
export const STATUS_ATIVIDADE_VALORES = Object.values(STATUS_ATIVIDADE) as [
    StatusAtividade,
    ...StatusAtividade[],
];

/**
 * Fonte = o ramo do UNION ALL. Único por ramo: entra no desempate do keyset, porque ids de
 * tabelas diferentes colidem.
 */
export const FONTE_ATIVIDADE = {
    PERMUTA_EXECUCAO: 'permuta_execucao',
    EXCECAO_CRIADA: 'excecao_criada',
    EXCECAO_REMOVIDA: 'excecao_removida',
    LOTE_CRIADO: 'lote_criado',
    LOTE_FINALIZADO: 'lote_finalizado',
    DESTINO_AUDIT: 'destino_audit',
    REMESSA: 'remessa',
    CONCILIACAO: 'conciliacao',
    SN_EXECUCAO: 'sn_execucao',
    ALERTA_RECONHECIDO: 'alerta_reconhecido',
    ACESSO_EVENTO: 'acesso_evento',
} as const;
export type FonteAtividade = (typeof FONTE_ATIVIDADE)[keyof typeof FONTE_ATIVIDADE];
export const FONTES_ATIVIDADE = Object.values(FONTE_ATIVIDADE) as [
    FonteAtividade,
    ...FonteAtividade[],
];

/** Ação (o "tipo" do filtro). O rótulo em português mora no front. */
export const ACAO_ATIVIDADE = {
    BAIXA_PERMUTA: 'baixa_permuta',
    EXCECAO_CRIADA: 'excecao_criada',
    EXCECAO_REMOVIDA: 'excecao_removida',
    LOTE_CRIADO: 'lote_criado',
    LOTE_FINALIZADO: 'lote_finalizado',
    DESTINO_GRAVADO: 'destino_gravado',
    DESTINO_APROVADO: 'destino_aprovado',
    REMESSA_GERADA: 'remessa_gerada',
    RETORNO_CONCILIADO: 'retorno_conciliado',
    NUMERARIO_EXECUTADO: 'numerario_executado',
    ALERTA_RECONHECIDO: 'alerta_reconhecido',
    ACESSO_ALTERADO: 'acesso_alterado',
    ACESSO_RECEBIDO: 'acesso_recebido',
} as const;
export type AcaoAtividade = (typeof ACAO_ATIVIDADE)[keyof typeof ACAO_ATIVIDADE];
export const ACOES_ATIVIDADE = Object.values(ACAO_ATIVIDADE) as [AcaoAtividade, ...AcaoAtividade[]];

/**
 * Tabela ÚNICA de tradução status bruto → normalizado, por fonte. Exaustiva sobre os `CHECK` das
 * migrations de origem; os eventos pontuais carregam um bruto sintético (`evento`, o `evento` da
 * trilha de destino, o `tipo` do evento de acesso). O SQL do filtro de status é derivado DESTA
 * tabela (pares `fonte:bruto` como parâmetro), então tela e filtro nunca discordam.
 */
export const STATUS_POR_FONTE: Readonly<
    Record<FonteAtividade, Readonly<Record<string, StatusAtividade>>>
> = {
    [FONTE_ATIVIDADE.PERMUTA_EXECUCAO]: {
        settled: STATUS_ATIVIDADE.SUCESSO,
        parcial: STATUS_ATIVIDADE.SUCESSO,
        error: STATUS_ATIVIDADE.ERRO,
        pending: STATUS_ATIVIDADE.EM_ANDAMENTO,
        reconciling: STATUS_ATIVIDADE.EM_ANDAMENTO,
    },
    [FONTE_ATIVIDADE.EXCECAO_CRIADA]: { evento: STATUS_ATIVIDADE.INFO },
    [FONTE_ATIVIDADE.EXCECAO_REMOVIDA]: { evento: STATUS_ATIVIDADE.INFO },
    [FONTE_ATIVIDADE.LOTE_CRIADO]: {
        RASCUNHO: STATUS_ATIVIDADE.INFO,
        FINALIZADO: STATUS_ATIVIDADE.INFO,
        REMESSA_GERADA: STATUS_ATIVIDADE.INFO,
        RETORNADO: STATUS_ATIVIDADE.INFO,
        BAIXADO: STATUS_ATIVIDADE.INFO,
        CANCELADO: STATUS_ATIVIDADE.CANCELADO,
    },
    [FONTE_ATIVIDADE.LOTE_FINALIZADO]: {
        RASCUNHO: STATUS_ATIVIDADE.SUCESSO,
        FINALIZADO: STATUS_ATIVIDADE.SUCESSO,
        REMESSA_GERADA: STATUS_ATIVIDADE.SUCESSO,
        RETORNADO: STATUS_ATIVIDADE.SUCESSO,
        BAIXADO: STATUS_ATIVIDADE.SUCESSO,
        CANCELADO: STATUS_ATIVIDADE.CANCELADO,
    },
    [FONTE_ATIVIDADE.DESTINO_AUDIT]: {
        GRAVACAO: STATUS_ATIVIDADE.INFO,
        APROVACAO: STATUS_ATIVIDADE.INFO,
    },
    [FONTE_ATIVIDADE.REMESSA]: {
        settled: STATUS_ATIVIDADE.SUCESSO,
        error: STATUS_ATIVIDADE.ERRO,
        pending: STATUS_ATIVIDADE.EM_ANDAMENTO,
        reconciling: STATUS_ATIVIDADE.EM_ANDAMENTO,
    },
    [FONTE_ATIVIDADE.CONCILIACAO]: {
        settled: STATUS_ATIVIDADE.SUCESSO,
        error: STATUS_ATIVIDADE.ERRO,
        pending: STATUS_ATIVIDADE.EM_ANDAMENTO,
        reconciling: STATUS_ATIVIDADE.EM_ANDAMENTO,
    },
    [FONTE_ATIVIDADE.SN_EXECUCAO]: {
        settled: STATUS_ATIVIDADE.SUCESSO,
        error: STATUS_ATIVIDADE.ERRO,
        pending: STATUS_ATIVIDADE.EM_ANDAMENTO,
        reconciling: STATUS_ATIVIDADE.EM_ANDAMENTO,
    },
    [FONTE_ATIVIDADE.ALERTA_RECONHECIDO]: { evento: STATUS_ATIVIDADE.INFO },
    [FONTE_ATIVIDADE.ACESSO_EVENTO]: {
        papel: STATUS_ATIVIDADE.INFO,
        excecao: STATUS_ATIVIDADE.INFO,
        ativo: STATUS_ATIVIDADE.INFO,
    },
};

/** Os pares `fonte:bruto` cujo status normalizado é `status` — o parâmetro do filtro SQL. */
export const chavesDoStatus = (status: StatusAtividade): string[] =>
    Object.entries(STATUS_POR_FONTE).flatMap(([fonte, mapa]) =>
        Object.entries(mapa)
            .filter(([, normalizado]) => normalizado === status)
            .map(([bruto]) => `${fonte}:${bruto}`),
    );

/** O alvo da leitura: SEMPRE a identidade autenticada na v1 (I1). Parâmetro interno, v2-ready. */
export interface AlvoPerfil {
    userId: number;
    username: string;
}

/** Item da trilha de exceções de permissão (`AccessRepository`). */
export interface ExcecaoAcesso {
    permissao: string;
    efeito: 'conceder' | 'revogar';
}

/**
 * Detalhe opcional da linha, para o rótulo do alvo. Nenhuma chave de credencial. Do outro usuário,
 * só o nome e — nos eventos de acesso — o que mudou naquela alteração (papel, exceções, ativo), que
 * é a própria ação do usuário (ator) ou a que ele sofreu (alvo).
 */
export interface DetalheAtividade {
    parcial?: boolean;
    filCod?: number;
    conexosUsername?: string;
    loteId?: string;
    invoiceDocCod?: string;
    docCod?: string;
    tipoAlerta?: string;
    alvoAlerta?: string;
    tipoAcesso?: string;
    outroUsername?: string;
    /** Lote: número da remessa (quando já gerada) e banco. */
    remessaNum?: number;
    banco?: string;
    /** Destino de pagamento: parcela do título (`docCod` já existe). */
    titCod?: string;
    /** Conciliação: banco e contagens do retorno. "agendados" = o que o .RET aceitou (nunca "pago"). */
    bncCod?: number;
    agendados?: number;
    rejeitados?: number;
    /** Evento de acesso: o que mudou. */
    papelAntes?: string;
    papelDepois?: string;
    ativoDepois?: boolean;
    excecoesAntes?: ExcecaoAcesso[];
    excecoesDepois?: ExcecaoAcesso[];
}

/** Linha como sai do repositório (status ainda bruto). */
export interface LinhaAtividadeBruta {
    /** Instante com microssegundos, ISO UTC (texto do Postgres; nunca passa por `Date`). */
    em: string;
    frente: FrenteAtividade;
    acao: AcaoAtividade;
    alvoTipo: string;
    alvoId: string;
    valor?: number;
    statusBruto: string;
    fonte: FonteAtividade;
    fonteId: string;
    detalhe: DetalheAtividade;
}

/** Linha como sai do serviço (status normalizado). */
export interface LinhaAtividade extends Omit<LinhaAtividadeBruta, 'statusBruto'> {
    status: StatusAtividade;
}

/** Posição do keyset `(em DESC, fonte ASC, fonte_id DESC)`. */
export interface CursorHistorico {
    em: string;
    fonte: FonteAtividade;
    fonteId: string;
}

export interface ConsultaHistorico {
    userId: number;
    username: string;
    inicio: string;
    fim: string;
    frente?: FrenteAtividade;
    tipo?: AcaoAtividade;
    status?: StatusAtividade;
    cursor?: CursorHistorico;
    limit: number;
}

export interface ConsultaAgregados {
    username: string;
    inicio: string;
    fim: string;
}

export interface AgregadosPermutas {
    /** `settled` com borderô finalizado — o "concluídas" de `/metricas`. */
    concluidas: number;
    /** `parcial` com borderô finalizado (entra no R$, não no principal). */
    parciais: number;
    /** `SUM(valor_baixado)` de `settled` + `parcial` finalizadas. */
    valorBaixado: number;
    /** `settled`/`parcial` sem borderô finalizado (ou estornado). */
    aguardandoBordero: number;
    comErro: number;
}

export interface AgregadosSispag {
    lotesFinalizados: number;
    /** Lotes cuja 1ª remessa `settled` não-dry foi executada pelo usuário. */
    remessasGeradas: number;
    valorRemessado: number;
    /** Itens `AGENDADO` ou `PAGO` (o .RET aceitou). */
    valorAgendado: number;
    /** Itens `PAGO` (baixa lida no fin064, ADR-0055). */
    valorPagoConfirmado: number;
    retornosConciliados: number;
    comErro: number;
}

export interface AgregadosRecebimentos {
    concluidas: number;
    valor: number;
    comErro: number;
}

export interface AgregadosAtividade {
    permutas: AgregadosPermutas;
    sispag: AgregadosSispag;
    recebimentos: AgregadosRecebimentos;
}
