import { inject, injectable } from 'tsyringe';
import type { BoletoDda } from '../../interface/sispag/BoletoDda.js';
import {
    AVISO_CONJUNTO,
    type AvisoConjunto,
    type IrmaoConjunto,
} from '../../interface/sispag/ConfirmacaoEmConjunto.js';
import {
    type AvaliacaoSugestao,
    type CandidatoTitulo,
    type ChaveTitulo,
    type DesfechoTitulo,
    EXIGE_RECONHECIMENTO,
    SINAL_SUGESTAO,
    SITUACAO_SUGESTAO_TITULO,
    TIER_SUGESTAO,
} from '../../interface/sispag/SugestaoBoleto.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import { LIMITE_VALOR_MESMO_DIA } from './RegraSugestaoBoleto.js';

const SITUACOES_ELEGIVEIS: ReadonlySet<string> = new Set([
    SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA,
    SITUACAO_SUGESTAO_TITULO.SO_ATENCAO,
]);
const TIERS: ReadonlySet<string> = new Set(Object.values(TIER_SUGESTAO));

const centavos = (v: number): number => Math.round(v * 100);

export const chaveDoTitulo = (c: ChaveTitulo): string => `${c.filCod}:${c.docCod}:${c.titCod}`;

const mesmoTitulo = (a: ChaveTitulo, b: ChaveTitulo): boolean =>
    a.filCod === b.filCod && a.docCod === b.docCod && a.titCod === b.titCod;

/** O que a regra precisa do título de origem: a chave e o credor. */
export interface OrigemConjunto extends ChaveTitulo {
    pesCod: string;
}

export interface EntradaIrmaosConjunto {
    origem: OrigemConjunto;
    desfechos: DesfechoTitulo[];
    /** Chaves (`chaveDoTitulo`) dos títulos em lote local FINALIZADO/REMESSA_GERADA/RETORNADO. */
    emLoteFinalizado: ReadonlySet<string>;
    /** Pool DDA inteiro, para o aviso de boletos idênticos (I15t(5)). */
    pool: BoletoDda[];
}

/**
 * RegraIrmaosConjunto — elegibilidade e avisos da confirmação em conjunto (I15t, ADR-0080). Pura:
 * recebe o cenário já calculado pelo motor e não lê banco. A mesma conferência
 * (`motivoInelegivel`) roda na listagem e, ao vivo, dentro do `confirmar` de cada linha.
 */
@injectable()
export default class RegraIrmaosConjunto {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
    ) {}

    /**
     * Por que este par não entra no conjunto (pt-BR), ou `undefined` quando entra. Confere só o que é
     * do conjunto (I15t(1)): o resto da confirmação é do `confirmar`.
     */
    public motivoInelegivel = (p: {
        origem: OrigemConjunto;
        titulo: ChaveTitulo & { pesCod?: string };
        avaliacao: AvaliacaoSugestao;
    }): string | undefined => {
        if (p.titulo.filCod !== p.origem.filCod) {
            return 'O título é de outra filial: a confirmação em conjunto é só na mesma filial.';
        }
        if (p.titulo.pesCod !== p.origem.pesCod) {
            return 'O título é de outro credor: a confirmação em conjunto é só do mesmo credor.';
        }
        const { avaliacao: a } = p;
        if (!a.confirmavel || !TIERS.has(a.resultado)) {
            return 'O boleto deste título não é confirmável agora.';
        }
        if (!a.sinais.includes(SINAL_SUGESTAO.NUMERO_CONFIAVEL)) {
            return 'O boleto não foi escolhido pelo número do documento: confirme este título sozinho.';
        }
        if (
            a.exigeReconhecimento !== EXIGE_RECONHECIMENTO.NENHUM ||
            a.sinais.includes(SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO)
        ) {
            return 'Este título exige reconhecimento da diferença de data: confirme-o sozinho.';
        }
        return undefined;
    };

    /** Linhas elegíveis, a origem primeiro (quando elegível), depois por vencimento e documento. */
    public irmaos = (e: EntradaIrmaosConjunto): IrmaoConjunto[] => {
        const identicos = this.indiceIdenticos(e.pool);
        const codbarPorBoleto = new Map(
            e.pool.map((b) => [`${b.ddcCod}:${b.ditCod}`, b.codbar] as const),
        );
        const linhas: IrmaoConjunto[] = [];
        for (const d of e.desfechos) {
            const c = this.escolhido(d, e);
            if (!c) continue;
            linhas.push(this.linha(d, c, e.origem, identicos, codbarPorBoleto));
        }
        return linhas.sort(
            (a, b) =>
                Number(b.origem) - Number(a.origem) ||
                a.vencimentoTitulo.localeCompare(b.vencimentoTitulo) ||
                a.docCod.localeCompare(b.docCod, 'pt-BR', { numeric: true }) ||
                a.titCod.localeCompare(b.titCod, 'pt-BR', { numeric: true }),
        );
    };

    private escolhido = (
        d: DesfechoTitulo,
        e: EntradaIrmaosConjunto,
    ): CandidatoTitulo | undefined => {
        if (!SITUACOES_ELEGIVEIS.has(d.situacao)) return undefined;
        if (e.emLoteFinalizado.has(chaveDoTitulo(d))) return undefined;
        const c = d.candidatos.find((x) => x.confirmavel);
        if (!c) return undefined;
        const motivo = this.motivoInelegivel({
            origem: e.origem,
            titulo: d,
            avaliacao: c.avaliacao,
        });
        return motivo === undefined ? c : undefined;
    };

    private linha = (
        d: DesfechoTitulo,
        c: CandidatoTitulo,
        origem: OrigemConjunto,
        identicos: Map<string, Set<string>>,
        codbarPorBoleto: Map<string, string | undefined>,
    ): IrmaoConjunto => {
        const { deltaValor, deltaDias } = c.avaliacao;
        const avisos: AvisoConjunto[] = [];
        if (centavos(deltaValor) !== 0 && deltaDias > 0) {
            avisos.push(AVISO_CONJUNTO.FAIXA_AJUSTE_MANUAL);
        }
        const codbar = codbarPorBoleto.get(`${c.ddcCod}:${c.ditCod}`);
        const iguais = c.emissor
            ? identicos.get(this.chaveIdentico(c.emissor.chave, c.valorBoleto, c.vencimentoBoleto))
            : undefined;
        if (iguais && [...iguais].some((outro) => outro !== codbar)) {
            avisos.push(AVISO_CONJUNTO.ESCOLHIDO_SO_PELO_NUMERO);
        }
        const delta = Math.abs(centavos(deltaValor));
        return {
            filCod: d.filCod,
            docCod: d.docCod,
            titCod: d.titCod,
            ddcCod: c.ddcCod,
            ditCod: c.ditCod,
            origem: mesmoTitulo(d, origem),
            ...(d.numeroDocumento ? { numeroDocumento: d.numeroDocumento } : {}),
            ...(c.numeroBoleto ? { numeroBoleto: c.numeroBoleto } : {}),
            valorTitulo: d.valorTitulo,
            vencimentoTitulo: d.vencimentoTitulo,
            valorBoleto: c.valorBoleto,
            vencimentoBoleto: c.vencimentoBoleto,
            deltaValor,
            deltaDias,
            tier: c.avaliacao.resultado,
            ...(c.emissor
                ? {
                      emissor: {
                          banco: c.emissor.banco,
                          layout: c.emissor.layout,
                          mascarado: c.emissor.mascarado,
                      },
                  }
                : {}),
            avisos,
            ajusteAutomatico:
                deltaDias === 0 && delta > 0 && delta <= centavos(LIMITE_VALOR_MESMO_DIA),
        };
    };

    /** (emissor, valor em centavos, vencimento) → códigos de barras distintos do pool. */
    private indiceIdenticos = (pool: BoletoDda[]): Map<string, Set<string>> => {
        const indice = new Map<string, Set<string>>();
        for (const b of pool) {
            if (!b.codbar || !b.vencimento) continue;
            const emissor = this.codigoBarras.emissor(b.codbar);
            if (!emissor) continue;
            const k = this.chaveIdentico(emissor.chave, b.valor, b.vencimento);
            const codbars = indice.get(k) ?? new Set<string>();
            codbars.add(b.codbar);
            indice.set(k, codbars);
        }
        return indice;
    };

    private chaveIdentico = (emissorChave: string, valor: number, vencimento: string): string =>
        `${emissorChave}|${centavos(valor)}|${vencimento}`;
}
