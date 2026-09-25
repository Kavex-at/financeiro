import { injectable } from 'tsyringe';
import {
    BOLETO_DDA_SITUACAO,
    type BoletoDdaConsolidado,
    type BoletoDdaContagem,
    type BoletoDdaSituacao,
    type BoletoDdaTitulo,
} from '../../interface/sispag/BoletoDda.js';

/** Teto de linhas por página. Limita quanto código de barras sai numa só resposta (security-2). */
export const BOLETO_DDA_TAMANHO_MAX = 100;
export const BOLETO_DDA_TAMANHO_PADRAO = 20;

export interface FiltroPaginaBoletoDda {
    situacao?: BoletoDdaSituacao;
    /** Texto livre: número, valor, credor, documento, código de barras, linha digitável, arquivo. */
    busca?: string;
    filCod?: number;
    pagina: number;
    tamanho: number;
}

export interface PaginaBoletoDda {
    boletos: BoletoDdaConsolidado[];
    /** Linhas depois de TODOS os filtros (inclusive situação) — base da paginação. */
    total: number;
    /** Página efetivamente devolvida (a pedida, limitada à última existente). */
    pagina: number;
    tamanho: number;
    /** Contagem por situação depois de filial + busca, ANTES do filtro de situação (chips da aba). */
    contagem: BoletoDdaContagem;
    /** Filiais presentes no escopo, para o seletor. */
    filiais: number[];
}

/**
 * Filial de um boleto: a do vínculo, ou a do único candidato. O pool DDA não tem filial própria,
 * então um boleto sem filial passa em QUALQUER filtro de filial (mesma regra da aba antes da
 * paginação no servidor — `useTabelaFiltro`).
 */
const filialDe = (b: BoletoDdaConsolidado): number | undefined =>
    b.vinculo?.filCod ?? (b.candidatos.length === 1 ? b.candidatos[0]?.filCod : undefined);

/**
 * `4815.33` → `4.815,33`. À mão, e não `toLocaleString('pt-BR')`: a busca monta este texto para
 * as ~24 mil linhas do escopo "todos" a cada requisição, e o `Intl` do Node custava ~0,7 s nisso.
 */
const valorBr = (valor: number): string => {
    const [inteiro = '0', centavos = '00'] = Math.abs(valor).toFixed(2).split('.');
    const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${valor < 0 ? '-' : ''}${milhar},${centavos}`;
};

const textoDeBusca = (b: BoletoDdaConsolidado): string =>
    [
        b.numero,
        b.codbar,
        b.linhaDigitavel,
        b.arquivo,
        b.valor.toFixed(2),
        valorBr(b.valor),
        ...[b.vinculo, ...b.candidatos]
            .filter((t): t is BoletoDdaTitulo => t !== undefined)
            .flatMap((t) => [t.credor, `${t.docCod}/${t.titCod}`]),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

/**
 * Filtra e pagina a lista consolidada da aba "Boletos DDA". PURA.
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
        const busca = filtro.busca?.trim().toLowerCase() ?? '';
        const filiais = [
            ...new Set(linhas.map(filialDe).filter((f): f is number => f !== undefined)),
        ].sort((a, c) => a - c);

        const semSituacao = linhas.filter((b) => {
            const fil = filialDe(b);
            const filialOk =
                filtro.filCod === undefined || fil === undefined || fil === filtro.filCod;
            return filialOk && (busca === '' || textoDeBusca(b).includes(busca));
        });

        const contagem: BoletoDdaContagem = {
            todas: semSituacao.length,
            VINCULADO: 0,
            CANDIDATO: 0,
            AMBIGUO: 0,
            SEM_TITULO: 0,
        };
        for (const b of semSituacao) contagem[b.situacao] += 1;

        const filtradas =
            filtro.situacao === undefined
                ? semSituacao
                : semSituacao.filter((b) => b.situacao === filtro.situacao);

        const tamanho = Math.min(Math.max(1, filtro.tamanho), BOLETO_DDA_TAMANHO_MAX);
        const ultima = Math.max(1, Math.ceil(filtradas.length / tamanho));
        const pagina = Math.min(Math.max(1, filtro.pagina), ultima);
        return {
            boletos: filtradas.slice((pagina - 1) * tamanho, pagina * tamanho),
            total: filtradas.length,
            pagina,
            tamanho,
            contagem,
            filiais,
        };
    };
}

/** Situações aceitas no filtro (para o Zod da rota). */
export const SITUACOES_FILTRAVEIS = Object.values(BOLETO_DDA_SITUACAO) as [
    BoletoDdaSituacao,
    ...BoletoDdaSituacao[],
];
