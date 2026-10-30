import { injectable } from 'tsyringe';
import {
    BOLETO_DDA_COLUNA,
    BOLETO_DDA_FAIXA,
    BOLETO_DDA_SEM_FILIAL,
    BOLETO_DDA_SITUACAO,
    type BoletoDdaColuna,
    type BoletoDdaConsolidado,
    type BoletoDdaContagem,
    type BoletoDdaFacetas,
    type BoletoDdaFaixa,
    type BoletoDdaFiltroFilial,
    type BoletoDdaSituacao,
    type BoletoDdaTitulo,
    type BoletoDdaTotais,
    type BoletoDdaTotal,
} from '../../interface/sispag/BoletoDda.js';

/** Teto de linhas por página. Limita quanto código de barras sai numa só resposta (security-2). */
export const BOLETO_DDA_TAMANHO_MAX = 100;
export const BOLETO_DDA_TAMANHO_PADRAO = 20;
/** Quantos boletos a faixa "vencem hoje" recebe; o resto fica atrás de "Ver só estes". */
export const BOLETO_DDA_AMOSTRA_HOJE = 4;

export interface OrdemBoletoDda {
    coluna: BoletoDdaColuna;
    direcao: 1 | -1;
}

export interface FiltroPaginaBoletoDda {
    situacao?: BoletoDdaSituacao;
    /** Filtro de coluna Situação (várias). Compõe com `situacao` (as duas precisam valer). */
    situacoes?: BoletoDdaSituacao[];
    /** Texto livre: número, valor, credor, documento, código de barras, linha digitável, arquivo. */
    busca?: string;
    /**
     * LEGADO (gaveta do título): filial de exibição igual, OU boleto sem filial — a gaveta precisa
     * dos boletos de mesmo valor sem título, que não têm filial. A aba usa `filiais` (I-DDA5).
     */
    filCod?: number;
    /** I-DDA5: só as filiais pedidas; `'sem'` é a opção "sem filial". */
    filiais?: BoletoDdaFiltroFilial[];
    bancos?: string[];
    /** Faixas de vencimento de Títulos a pagar; precisa de `hoje`. */
    faixas?: BoletoDdaFaixa[];
    valorMin?: number;
    valorMax?: number;
    /** Número do boleto (contém). */
    numero?: string;
    /** Credor ou `doc/tit` do vínculo ou de um candidato (contém). */
    titulo?: string;
    /** I21v: só os boletos de grupo (sugerido ou confirmado); ortogonal à situação. */
    emGrupo?: boolean;
    /**
     * Intervalo de vencimento do boleto, data civil `YYYY-MM-DD`, inclusivo. Compara por ordem de
     * string (o formato garante). Com intervalo ativo, boleto sem vencimento sai.
     */
    vencimentoDe?: string;
    vencimentoAte?: string;
    /** Dia civil BRT de hoje (`BankingCalendar.todayBrt`). Sem ele não há faixa nem urgente. */
    hoje?: string;
    /** Sem ordem, a ordem de entrada (a do repositório: vencimento, arquivo, item) é mantida. */
    ordem?: OrdemBoletoDda;
    pagina: number;
    tamanho: number;
}

/**
 * Situação que a lista padrão ("Todas") esconde e `contagem.todas` não soma: o título já saiu da
 * carteira, então não pede ação. Só aparece pelo filtro próprio.
 */
const ESCONDIDA_NA_LISTA_PADRAO: BoletoDdaSituacao = BOLETO_DDA_SITUACAO.TITULO_SAIU_CARTEIRA;

/** Formato aceito para `vencimentoDe`/`vencimentoAte` (para o Zod da rota). */
export const DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface PaginaBoletoDda {
    boletos: BoletoDdaConsolidado[];
    /** Linhas depois de TODOS os filtros (inclusive situação) — base da paginação. */
    total: number;
    /** Página efetivamente devolvida (a pedida, limitada à última existente). */
    pagina: number;
    tamanho: number;
    /**
     * Contagem por situação depois de filial + busca + filtros de coluna, ANTES do filtro de
     * situação e do "Em grupo" (chips da aba).
     */
    contagem: BoletoDdaContagem;
    /** Mesma base da `contagem`, com R$. */
    totais: BoletoDdaTotais;
    facetas: BoletoDdaFacetas;
    amostraHoje: BoletoDdaConsolidado[];
    /** Filiais presentes no escopo, para o seletor (legado). */
    filiais: number[];
}

const DIA_MS = 86_400_000;

/**
 * Filial de exibição (I-DDA5): a do vínculo; senão a comum a TODOS os candidatos; senão
 * `undefined` ("sem filial"). O pool DDA não tem filial própria.
 */
export const filialDe = (b: BoletoDdaConsolidado): number | undefined => {
    if (b.vinculo) return b.vinculo.filCod;
    const primeira = b.candidatos[0]?.filCod;
    if (primeira === undefined) return undefined;
    return b.candidatos.every((c) => c.filCod === primeira) ? primeira : undefined;
};

/** Faixa de vencimento de um dia civil em relação a `hoje` (as de Títulos a pagar). */
export const faixaDe = (vencimento: string, hoje: string): BoletoDdaFaixa => {
    const dias = Math.round(
        (Date.parse(`${vencimento}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA_MS,
    );
    if (dias < 0) return BOLETO_DDA_FAIXA.VENCIDO;
    if (dias === 0) return BOLETO_DDA_FAIXA.HOJE;
    if (dias <= 2) return BOLETO_DDA_FAIXA.ATE_2_DIAS;
    if (dias <= 7) return BOLETO_DDA_FAIXA.ATE_7_DIAS;
    return BOLETO_DDA_FAIXA.MAIS_DE_7_DIAS;
};

/**
 * `4815.33` → `4.815,33`. À mão, e não `toLocaleString('pt-BR')`: a busca monta este texto para
 * as ~24 mil linhas do escopo "todos" a cada requisição, e o `Intl` do Node custava ~0,7 s nisso.
 */
const valorBr = (valor: number): string => {
    const [inteiro = '0', centavos = '00'] = Math.abs(valor).toFixed(2).split('.');
    const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${valor < 0 ? '-' : ''}${milhar},${centavos}`;
};

const titulosDe = (b: BoletoDdaConsolidado): BoletoDdaTitulo[] =>
    [b.vinculo, ...b.candidatos, ...(b.titulosSaidos ?? [])].filter(
        (t): t is BoletoDdaTitulo => t !== undefined,
    );

const textoDeBusca = (b: BoletoDdaConsolidado): string =>
    [
        b.numero,
        b.codbar,
        b.linhaDigitavel,
        b.arquivo,
        b.valor.toFixed(2),
        valorBr(b.valor),
        ...titulosDe(b).flatMap((t) => [t.credor, `${t.docCod}/${t.titCod}`]),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

const textoDoTitulo = (b: BoletoDdaConsolidado): string =>
    titulosDe(b)
        .flatMap((t) => [t.credor, `${t.docCod}/${t.titCod}`])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

const ORDEM_SITUACAO: Record<BoletoDdaSituacao, number> = {
    VINCULADO: 0,
    CANDIDATO: 1,
    AMBIGUO: 2,
    FORA_JANELA: 3,
    SEM_TITULO: 4,
    TITULO_SAIU_CARTEIRA: 5,
};

/** Chave de ordenação de uma coluna; `undefined` vai para o fim nas duas direções. */
const chaveDe = (b: BoletoDdaConsolidado, coluna: BoletoDdaColuna): string | number | undefined => {
    switch (coluna) {
        case BOLETO_DDA_COLUNA.SITUACAO:
            return ORDEM_SITUACAO[b.situacao];
        case BOLETO_DDA_COLUNA.NUMERO:
            return b.numero;
        case BOLETO_DDA_COLUNA.VALOR:
            return b.valor;
        case BOLETO_DDA_COLUNA.VENCIMENTO:
            return b.vencimento;
        case BOLETO_DDA_COLUNA.BANCO:
            return b.bancoEmissor;
        case BOLETO_DDA_COLUNA.TITULO:
            return (b.vinculo ?? b.candidatos[0])?.credor?.toLowerCase();
        case BOLETO_DDA_COLUNA.FILIAL:
            return filialDe(b);
    }
};

const ordenar = (
    linhas: BoletoDdaConsolidado[],
    ordem: OrdemBoletoDda | undefined,
): BoletoDdaConsolidado[] => {
    if (!ordem) return linhas;
    const { coluna, direcao } = ordem;
    // `sort` é estável: o empate preserva a ordem do repositório.
    return [...linhas].sort((a, c) => {
        const x = chaveDe(a, coluna);
        const y = chaveDe(c, coluna);
        if (x === undefined || y === undefined) {
            return x === y ? 0 : x === undefined ? 1 : -1;
        }
        if (x === y) return 0;
        return (x < y ? -1 : 1) * direcao;
    });
};

const vazio = (): BoletoDdaTotal => ({ qtd: 0, valor: 0 });
const somar = (t: BoletoDdaTotal, valor: number): void => {
    t.qtd += 1;
    t.valor += valor;
};
const centavos = (v: number): number => Math.round(v * 100) / 100;

/** Faixa urgente (`HOJE` ou `1-2`) de um boleto não casado; senão `undefined`. */
const urgenciaDe = (
    b: BoletoDdaConsolidado,
    hoje: string | undefined,
): BoletoDdaFaixa | undefined => {
    if (!hoje || !b.vencimento || b.situacao === BOLETO_DDA_SITUACAO.VINCULADO) return undefined;
    const f = faixaDe(b.vencimento, hoje);
    return f === BOLETO_DDA_FAIXA.HOJE || f === BOLETO_DDA_FAIXA.ATE_2_DIAS ? f : undefined;
};

/**
 * Filtra, totaliza, ordena e pagina a lista consolidada da aba "Boletos DDA". PURA.
 *
 * Existe para que o navegador receba uma PÁGINA, não o pool inteiro: o escopo "todos" mandava
 * 24.137 linhas com código de barras e linha digitável num único GET (~8,5 MB estimados) —
 * Regis-Review 2026-09-24, performance-1 / security-2.
 */
@injectable()
export default class PaginacaoBoletoDda {
    public paginar = (
        linhas: BoletoDdaConsolidado[],
        filtro: FiltroPaginaBoletoDda,
    ): PaginaBoletoDda => {
        const situacoes = filtro.situacoes?.length ? new Set(filtro.situacoes) : undefined;
        // Sem pedir situação, a lista padrão esconde os que saíram da carteira (e as facetas também).
        const escondeSaidos = filtro.situacao === undefined && situacoes === undefined;
        const facetas = this.facetas(
            escondeSaidos ? linhas.filter((b) => b.situacao !== ESCONDIDA_NA_LISTA_PADRAO) : linhas,
        );
        const criterios = this.criterios(filtro);
        const semSituacao = linhas.filter((b) => criterios.every((ok) => ok(b)));
        const { contagem, totais, amostraHoje } = this.totalizar(semSituacao, filtro.hoje);

        const filtradas = ordenar(
            semSituacao.filter(
                (b) =>
                    !(escondeSaidos && b.situacao === ESCONDIDA_NA_LISTA_PADRAO) &&
                    (filtro.situacao === undefined || b.situacao === filtro.situacao) &&
                    (situacoes === undefined || situacoes.has(b.situacao)) &&
                    (filtro.emGrupo !== true || b.grupo !== undefined),
            ),
            filtro.ordem,
        );

        const tamanho = Math.min(Math.max(1, filtro.tamanho), BOLETO_DDA_TAMANHO_MAX);
        const ultima = Math.max(1, Math.ceil(filtradas.length / tamanho));
        const pagina = Math.min(Math.max(1, filtro.pagina), ultima);
        return {
            boletos: filtradas.slice((pagina - 1) * tamanho, pagina * tamanho).map(this.comFilial),
            total: filtradas.length,
            pagina,
            tamanho,
            contagem,
            totais,
            facetas,
            amostraHoje: amostraHoje.map(this.comFilial),
            filiais: facetas.filiais.map((f) => f.valor),
        };
    };

    /**
     * Os filtros que valem ANTES da situação (filial, vencimento, colunas, busca), só os ativos.
     * A busca vem por último: montar o texto de busca é o passo mais caro.
     */
    private criterios = (
        filtro: FiltroPaginaBoletoDda,
    ): Array<(b: BoletoDdaConsolidado) => boolean> => {
        const criterios: Array<(b: BoletoDdaConsolidado) => boolean> = [];
        const { filCod, hoje, vencimentoDe, vencimentoAte, valorMin, valorMax } = filtro;
        if (filCod !== undefined) {
            criterios.push((b) => {
                const fil = filialDe(b);
                return fil === undefined || fil === filCod;
            });
        }
        if (filtro.filiais?.length) {
            const pedidas = new Set<BoletoDdaFiltroFilial>(filtro.filiais);
            criterios.push((b) => pedidas.has(filialDe(b) ?? BOLETO_DDA_SEM_FILIAL));
        }
        if (vencimentoDe !== undefined || vencimentoAte !== undefined) {
            criterios.push(
                (b) =>
                    b.vencimento !== undefined &&
                    (vencimentoDe === undefined || b.vencimento >= vencimentoDe) &&
                    (vencimentoAte === undefined || b.vencimento <= vencimentoAte),
            );
        }
        if (filtro.bancos?.length) {
            const bancos = new Set(filtro.bancos);
            criterios.push((b) => b.bancoEmissor !== undefined && bancos.has(b.bancoEmissor));
        }
        if (filtro.faixas?.length && hoje) {
            const faixas = new Set(filtro.faixas);
            criterios.push(
                (b) => b.vencimento !== undefined && faixas.has(faixaDe(b.vencimento, hoje)),
            );
        }
        if (valorMin !== undefined) criterios.push((b) => b.valor >= valorMin);
        if (valorMax !== undefined) criterios.push((b) => b.valor <= valorMax);
        const numero = filtro.numero?.trim().toLowerCase() ?? '';
        if (numero !== '') criterios.push((b) => (b.numero ?? '').toLowerCase().includes(numero));
        const titulo = filtro.titulo?.trim().toLowerCase() ?? '';
        if (titulo !== '') criterios.push((b) => textoDoTitulo(b).includes(titulo));
        const busca = filtro.busca?.trim().toLowerCase() ?? '';
        if (busca !== '') criterios.push((b) => textoDeBusca(b).includes(busca));
        return criterios;
    };

    /** Contagem, totais com R$ e a amostra de "vencem hoje" sobre a base antes da situação. */
    private totalizar = (
        linhas: BoletoDdaConsolidado[],
        hoje: string | undefined,
    ): Pick<PaginaBoletoDda, 'contagem' | 'totais' | 'amostraHoje'> => {
        const contagem: BoletoDdaContagem = {
            todas: 0,
            VINCULADO: 0,
            CANDIDATO: 0,
            AMBIGUO: 0,
            FORA_JANELA: 0,
            TITULO_SAIU_CARTEIRA: 0,
            SEM_TITULO: 0,
            emGrupo: 0,
        };
        const totais: BoletoDdaTotais = {
            todas: vazio(),
            VINCULADO: vazio(),
            CANDIDATO: vazio(),
            AMBIGUO: vazio(),
            FORA_JANELA: vazio(),
            TITULO_SAIU_CARTEIRA: vazio(),
            SEM_TITULO: vazio(),
            emGrupo: vazio(),
            grupoSugerido: vazio(),
            grupoConfirmado: vazio(),
            hoje: vazio(),
            urgentes: vazio(),
            urgentesParaConferir: vazio(),
            urgentesSemTitulo: vazio(),
        };
        const amostraHoje: BoletoDdaConsolidado[] = [];
        for (const b of linhas) {
            contagem[b.situacao] += 1;
            somar(totais[b.situacao], b.valor);
            // Fora da lista padrão: o título já saiu da carteira, nada a conferir nem a pagar.
            if (b.situacao === ESCONDIDA_NA_LISTA_PADRAO) continue;
            contagem.todas += 1;
            somar(totais.todas, b.valor);
            if (b.grupo) {
                contagem.emGrupo += 1;
                somar(totais.emGrupo, b.valor);
                const sub = b.grupo.estado === 'CONFIRMADO' ? 'grupoConfirmado' : 'grupoSugerido';
                somar(totais[sub], b.valor);
            }
            // Urgência é "conferir ou achar título": fora da janela não tem título a achar.
            if (b.situacao === BOLETO_DDA_SITUACAO.FORA_JANELA) continue;
            const faixa = urgenciaDe(b, hoje);
            if (faixa === undefined) continue;
            somar(totais.urgentes, b.valor);
            const sub =
                b.situacao === BOLETO_DDA_SITUACAO.SEM_TITULO
                    ? 'urgentesSemTitulo'
                    : 'urgentesParaConferir';
            somar(totais[sub], b.valor);
            if (faixa !== BOLETO_DDA_FAIXA.HOJE) continue;
            somar(totais.hoje, b.valor);
            if (amostraHoje.length < BOLETO_DDA_AMOSTRA_HOJE) amostraHoje.push(b);
        }
        for (const t of Object.values(totais)) t.valor = centavos(t.valor);
        return { contagem, totais, amostraHoje };
    };

    private comFilial = (b: BoletoDdaConsolidado): BoletoDdaConsolidado => {
        const filial = filialDe(b);
        return filial === undefined ? b : { ...b, filial };
    };

    /** Opções dos filtros de coluna sobre o escopo inteiro, como `opcoesDosFiltros` de Títulos. */
    private facetas = (linhas: BoletoDdaConsolidado[]): BoletoDdaFacetas => {
        const filiais = new Map<number, number>();
        const bancos = new Map<string, number>();
        let semFilial = 0;
        for (const b of linhas) {
            const fil = filialDe(b);
            if (fil === undefined) semFilial += 1;
            else filiais.set(fil, (filiais.get(fil) ?? 0) + 1);
            if (b.bancoEmissor) bancos.set(b.bancoEmissor, (bancos.get(b.bancoEmissor) ?? 0) + 1);
        }
        return {
            filiais: [...filiais].sort(([a], [c]) => a - c).map(([valor, qtd]) => ({ valor, qtd })),
            semFilial,
            bancos: [...bancos]
                .sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))
                .map(([valor, qtd]) => ({ valor, qtd })),
        };
    };
}

/** Situações aceitas no filtro (para o Zod da rota). */
export const SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO) as [
    BoletoDdaSituacao,
    ...BoletoDdaSituacao[],
];

/** Faixas aceitas no filtro (para o Zod da rota). */
export const FAIXAS_FILTRAVEIS = Object.values(BOLETO_DDA_FAIXA) as [
    BoletoDdaFaixa,
    ...BoletoDdaFaixa[],
];

/** Colunas aceitas em `ordem` (para o Zod da rota). */
export const COLUNAS_ORDENAVEIS = Object.values(BOLETO_DDA_COLUNA) as [
    BoletoDdaColuna,
    ...BoletoDdaColuna[],
];
