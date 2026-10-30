/**
 * Boleto DDA — item do pool `fin124` (Importação de Arquivo DDA) do Conexos, e a consolidação
 * dele contra a carteira de títulos a pagar. Ver `ontology/entities/BoletoDda.md`.
 *
 * O pool é da CONTA PAGADORA, não da filial: um item só ganha filial quando o próprio Conexos o
 * vincula a um título (associação do fin015, `titVldReflexoDdaAssoc`).
 */

/** Arquivo DDA importado no `fin124` (uma linha de `fin124/list`). */
export interface ArquivoDda {
    ddcCod: number;
    nome?: string;
    /** epoch ms */
    importadoEm?: number;
    /** epoch ms — presente = arquivo cancelado no fin124 */
    canceladoEm?: number;
    status?: number;
}

/** Boleto do pool (uma linha de `fin124/itens/list/{ddcCod}`). */
export interface ItemDda {
    ddcCod: number;
    ditCod: number;
    numero?: string;
    valor: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento?: string;
    /** Código de barras de 44 dígitos. */
    codbar?: string;
    /** Vínculo gravado pelo Conexos. Todos ausentes = boleto livre. */
    filCod?: number;
    docCod?: string;
    titCod?: string;
    flpCod?: number;
    bncCod?: number;
}

/** Boleto persistido, com o arquivo de origem. */
export interface BoletoDda extends ItemDda {
    arquivo?: string;
    /** epoch ms */
    importadoEm?: number;
}

/**
 * Situação do boleto frente à carteira.
 * - VINCULADO:  o Conexos já ligou o boleto a um título.
 * - CANDIDATO:  livre, e exatamente UM título aberto cai nos limites seguros da regra em camadas
 *               (|Δvalor| ≤ R$ 0,05 no mesmo dia, ou valor igual e boleto 1–5 dias depois).
 * - AMBIGUO:    livre, e MAIS de um título casa (cobrança recorrente de mesmo valor).
 * - SEM_TITULO: livre, e nenhum título aberto casa.
 */
export const BOLETO_DDA_SITUACAO = {
    VINCULADO: 'VINCULADO',
    CANDIDATO: 'CANDIDATO',
    AMBIGUO: 'AMBIGUO',
    SEM_TITULO: 'SEM_TITULO',
} as const;
export type BoletoDdaSituacao = (typeof BOLETO_DDA_SITUACAO)[keyof typeof BOLETO_DDA_SITUACAO];

/** Lote local (SISPAG) em que o título está, se houver. */
export interface BoletoDdaLoteRef {
    loteId: string;
    status: string;
}

/** Título da carteira ligado ao boleto (vínculo do Conexos ou candidato nosso). */
export interface BoletoDdaTitulo {
    filCod: number;
    docCod: string;
    titCod: string;
    credor?: string;
    valor?: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento?: string;
    /** Vencimento do boleto − vencimento do título, em dias. 0 = mesmo dia. */
    diferencaDias?: number;
    /** O Conexos sinaliza boleto DDA para este título (`tem_boleto` da carteira). */
    temBoletoDda?: boolean;
    lote?: BoletoDdaLoteRef;
    /** Resultado da regra em camadas (ADR-0068, I15c) para este par título × boleto. */
    tier?: 'FORTE' | 'ATENCAO' | 'VENCIDO_INFORMATIVO';
    /** boleto − título, em reais, com sinal. */
    deltaValor?: number;
}

/** Linha da aba "Boletos DDA". */
export interface BoletoDdaConsolidado {
    ddcCod: number;
    ditCod: number;
    arquivo?: string;
    importadoEm?: number;
    numero?: string;
    valor: number;
    vencimento?: string;
    vencido: boolean;
    codbar?: string;
    linhaDigitavel?: string;
    /** Código FEBRABAN do banco emissor (3 primeiros dígitos das barras). */
    bancoEmissor?: string;
    situacao: BoletoDdaSituacao;
    /** Presente só em VINCULADO. */
    vinculo?: BoletoDdaTitulo & { flpCod?: number };
    /** Presente em CANDIDATO (1) e AMBIGUO (2+): dentro dos limites seguros da regra em camadas. */
    candidatos: BoletoDdaTitulo[];
    /**
     * Valor praticamente igual, mas data fora do limite seguro (vence antes do título/da data de
     * débito, ou além de 5 dias): só informação, não conta para a situação (I15h).
     */
    informativos?: BoletoDdaTitulo[];
    /**
     * I21v: o boleto fecha a soma de um grupo — sugerido (I21e/f) ou confirmado. Ortogonal à
     * `situacao`: um boleto `CANDIDATO` ou `AMBIGUO` pode ser de grupo.
     */
    grupo?: BoletoDdaGrupo;
    /**
     * Filial de exibição (I-DDA5): a do vínculo; senão a comum a TODOS os candidatos; senão
     * ausente ("sem filial"). Preenchida só nas linhas que saem na página.
     */
    filial?: number;
}

/** O grupo de títulos que o boleto paga (só o resumo; o detalhe vem dos endpoints de grupos). */
export interface BoletoDdaGrupo {
    estado: 'SUGERIDO' | 'CONFIRMADO';
    /** Só em `CONFIRMADO`. */
    id?: string;
    filCod: number;
    nTitulos: number;
    /** Sugestão confirmável hoje; `CONFIRMADO` é sempre `true`. */
    confirmavel: boolean;
}

export const BOLETO_DDA_ESCOPO = {
    /** Vencimento hoje ou depois — os boletos ainda pagáveis. Default da aba. */
    A_VENCER: 'a-vencer',
    TODOS: 'todos',
} as const;
export type BoletoDdaEscopo = (typeof BOLETO_DDA_ESCOPO)[keyof typeof BOLETO_DDA_ESCOPO];

/** Contagem por situação (chips da aba). `todas` = soma. */
export type BoletoDdaContagem = Record<BoletoDdaSituacao | 'todas', number> & {
    /** Boletos de grupo (sugerido ou confirmado), depois de filial + busca (I21v). */
    emGrupo: number;
};

/** Quantidade e soma do valor DO BOLETO (R$). */
export interface BoletoDdaTotal {
    qtd: number;
    valor: number;
}

/**
 * Totais da aba (cards, segmentos e chips), na mesma base da `contagem`: depois de filial, busca e
 * filtros de coluna, ANTES do filtro de situação e do "Em grupo".
 * - `urgentes`: vence hoje ou em 1–2 dias (dia civil BRT), fora `VINCULADO`;
 *   `urgentesParaConferir`/`urgentesSemTitulo` o dividem.
 * - `hoje`: vence hoje, fora `VINCULADO` (a faixa "vencem hoje").
 */
export type BoletoDdaTotais = Record<
    | BoletoDdaSituacao
    | 'todas'
    | 'emGrupo'
    | 'grupoSugerido'
    | 'grupoConfirmado'
    | 'hoje'
    | 'urgentes'
    | 'urgentesParaConferir'
    | 'urgentesSemTitulo',
    BoletoDdaTotal
>;

/** Faixas de vencimento — as mesmas de Títulos a pagar. */
export const BOLETO_DDA_FAIXA = {
    VENCIDO: 'VENCIDO',
    HOJE: 'HOJE',
    ATE_2_DIAS: '1-2',
    ATE_7_DIAS: '3-7',
    MAIS_DE_7_DIAS: '8+',
} as const;
export type BoletoDdaFaixa = (typeof BOLETO_DDA_FAIXA)[keyof typeof BOLETO_DDA_FAIXA];

/** Colunas ordenáveis da aba. */
export const BOLETO_DDA_COLUNA = {
    SITUACAO: 'situacao',
    NUMERO: 'numero',
    VALOR: 'valor',
    VENCIMENTO: 'vencimento',
    BANCO: 'banco',
    TITULO: 'titulo',
    FILIAL: 'filial',
} as const;
export type BoletoDdaColuna = (typeof BOLETO_DDA_COLUNA)[keyof typeof BOLETO_DDA_COLUNA];

/** Valor do filtro de filial para "sem filial" (I-DDA5). */
export const BOLETO_DDA_SEM_FILIAL = 'sem';
export type BoletoDdaFiltroFilial = number | typeof BOLETO_DDA_SEM_FILIAL;

/** Opções dos filtros de coluna, sobre o escopo inteiro (sem filtro), como em Títulos. */
export interface BoletoDdaFacetas {
    filiais: Array<{ valor: number; qtd: number }>;
    semFilial: number;
    bancos: Array<{ valor: string; qtd: number }>;
}

/** Uma PÁGINA da aba — o pool inteiro nunca vai ao navegador. */
export interface BoletosDdaResposta {
    boletos: BoletoDdaConsolidado[];
    total: number;
    pagina: number;
    tamanho: number;
    contagem: BoletoDdaContagem;
    /** Totais com R$ (cards e segmentos). */
    totais: BoletoDdaTotais;
    /** Opções dos filtros de coluna. */
    facetas: BoletoDdaFacetas;
    /** Até 4 boletos não casados que vencem hoje (a faixa sob os cards), na ordem da lista. */
    amostraHoje: BoletoDdaConsolidado[];
    filiais: number[];
    /** epoch ms da última sincronização com o fin124; ausente = nunca sincronizado. */
    sincronizadoEm?: number;
    /**
     * I-DDA7: epoch ms da última conversa BEM-SUCEDIDA com o fin124 (conferência rápida ou passada
     * completa), ou `sincronizadoEm` se for mais recente. Base do aviso "DDA parado".
     */
    conferidoEm?: number;
    /** Texto da regra de candidato vigente (vem das constantes de `RegraSugestaoBoleto`). */
    regraCandidato: string;
}

export interface SincronizacaoDdaResultado {
    /** Arquivos novos PLANEJADOS na passada (inclui os que falharam ou ficaram adiados). */
    arquivosNovos: number;
    /** Arquivos conhecidos PLANEJADOS para releitura (idem). */
    arquivosRelidos: number;
    /** Arquivos efetivamente lidos e gravados (novos + relidos − falhas − adiados). */
    arquivosLidos: number;
    boletos: number;
    /** Arquivos cuja leitura falhou (não interrompem os demais). */
    falhas: number;
    /**
     * Arquivos que ficaram para a próxima passada porque o prazo (`prazoMs`) acabou. Novos vão
     * antes dos relidos, então o que sobra é, em regra, releitura de arquivo já conhecido.
     */
    arquivosAdiados: number;
    /**
     * Dos `falhas`, quantos o fin124 devolveu VAZIOS tendo itens no snapshot (`EmptyDdaFileError`,
     * código `DDA_FILE_EMPTY`): o snapshot foi mantido.
     */
    arquivosVazios: number;
}

/** Cabeçalho de um arquivo como está no snapshot local (para a conferência rápida). */
export interface ArquivoDdaEstado {
    nome?: string;
    status?: number;
    canceladoEm?: number;
    importadoEm?: number;
}

export const CONFERENCIA_DDA_ESTADO = {
    CONFERIDO: 'conferido',
    /** Listou, mas algo ficou para depois (prazo) ou falhou num arquivo. */
    PARCIAL: 'parcial',
    OCUPADA: 'ocupada',
    FALHOU: 'falhou',
} as const;
export type ConferenciaDdaEstado =
    (typeof CONFERENCIA_DDA_ESTADO)[keyof typeof CONFERENCIA_DDA_ESTADO];

/** Resultado da conferência rápida (I-DDA6). */
export interface ConferenciaDda {
    estado: ConferenciaDdaEstado;
    arquivosNovos?: number;
    /** Arquivos conhecidos que só tiveram o cabeçalho atualizado (cancelado, status, nome). */
    arquivosCabecalho?: number;
    /** Conhecidos que sumiram da listagem (nada é apagado). */
    arquivosSumidos?: number;
    boletos?: number;
    falhas?: number;
    arquivosAdiados?: number;
    arquivosVazios?: number;
    erro?: string;
}
