import { injectable } from 'tsyringe';
import {
    CHANNEL_CONFIDENCE,
    CHANNEL_GROUP,
    type ChannelConfidence,
    type ChannelGroup,
    type ChannelPayment,
    type ChannelProfile,
    type ChannelThresholds,
    type StatementDebit,
} from '../../interface/sispag/SispagInterface.js';

const DIA_MS = 86_400_000;
/** Distância máxima entre a data da baixa e a do débito para casar (medido na probe). */
const JANELA_CASAMENTO_MS = 1.5 * DIA_MS;
/** Confiança MEDIA: abaixo da ALTA mas ainda informativa (só ALTA gera alerta). */
const MEDIA_MIN_PAGAMENTOS = 3;
const MEDIA_MIN_PARTICIPACAO = 0.9;

/**
 * Vocabulário do HISTÓRICO do extrato → grupo de canal. Heurística de implementação, não
 * ontologia: são as palavras do banco da Columbia medidas na `probe-canal-por-fornecedor.ts`
 * (2026-10-05). A ORDEM importa — a primeira regra que casa vence (o "SISPAG PAG TIT" é boleto
 * porque `PAG TIT` vem antes do `SISPAG` sem canal). Tributo e SISPAG sem canal caem em OUTROS.
 */
export const HISTORICO_CANAL_REGRAS: ReadonlyArray<readonly [ChannelGroup, RegExp]> = [
    [CHANNEL_GROUP.TED_PIX, /\bPIX\b/],
    [CHANNEL_GROUP.TED_PIX, /\bTED\b|\bDOC\b|TRANSF|\bTEF\b/],
    [CHANNEL_GROUP.BOLETO, /BOLETO|\bTIT(ULO)?S?\b|COBRAN|PAG(TO)? ?TIT|\bBLQ\b|CODIGO DE BARRAS/],
    [CHANNEL_GROUP.OUTROS, /DARF|\bGPS\b|FGTS|GARE|GNRE|\bDAS\b|TRIBUT|IMPOSTO|SEFAZ|RECEITA FED/],
    [CHANNEL_GROUP.OUTROS, /\bSISPAG\b/],
];

export interface ChannelProfileInput {
    baixas: readonly ChannelPayment[];
    debitos: readonly StatementDebit[];
    limiares: ChannelThresholds;
    janela: { inicio: number; fim: number };
}

export interface ChannelProfileResult {
    perfis: ChannelProfile[];
    /** Baixas com MAIS de um débito possível — descartadas (não dá para afirmar o canal). */
    ambiguos: number;
    /** Baixas sem débito que case. */
    semDebito: number;
    /** Baixas sem `pesCod` — sem chave, não entram em perfil nenhum (gap Q4). */
    semFavorecido: number;
}

interface Acumulado {
    credor?: string;
    contagens: Record<ChannelGroup, number>;
    meses: Set<string>;
}

/**
 * ChannelProfileCalculator — `PerfilCanalFornecedor` (ADR-0063, I13i). PURO: sem I/O.
 *
 * Casa cada baixa a pagar (`fin010`) com um débito do extrato (`fin095`) de MESMO valor (centavo a
 * centavo) e data a ±1,5 dia. Só casamento ÚNICO conta; com mais de um débito possível a baixa é
 * descartada (e o primeiro débito é consumido, como na probe, para não ser reaproveitado). O canal
 * vem do histórico do débito. Confiança ALTA só com os limiares do tenant (pagamentos, meses
 * distintos, participação do grupo dominante). O perfil é por `pesCod`.
 *
 * Replica a `probe-canal-por-fornecedor.ts` de propósito: a validação ground-truth compara as duas.
 */
@injectable()
export default class ChannelProfileCalculator {
    public grupoDoHistorico = (historico?: string): ChannelGroup => {
        const texto = (historico ?? '').toUpperCase();
        for (const [grupo, regra] of HISTORICO_CANAL_REGRAS) {
            if (regra.test(texto)) return grupo;
        }
        return CHANNEL_GROUP.OUTROS;
    };

    public calcular = (input: ChannelProfileInput): ChannelProfileResult => {
        const porValor = new Map<string, StatementDebit[]>();
        for (const d of input.debitos) {
            const chave = this.chaveValor(d.valor);
            const lista = porValor.get(chave);
            if (lista) lista.push(d);
            else porValor.set(chave, [d]);
        }
        const usados = new Set<StatementDebit>();
        const acumulados = new Map<string, Acumulado>();
        let ambiguos = 0;
        let semDebito = 0;
        let semFavorecido = 0;

        for (const baixa of input.baixas) {
            if (!(baixa.valor > 0)) continue;
            const pesCod = baixa.pesCod?.trim();
            if (!pesCod) {
                semFavorecido += 1;
                continue;
            }
            const candidatos = (porValor.get(this.chaveValor(baixa.valor)) ?? []).filter(
                (d) => !usados.has(d) && Math.abs(d.data - baixa.data) <= JANELA_CASAMENTO_MS,
            );
            const achado = candidatos[0];
            if (!achado) {
                semDebito += 1;
                continue;
            }
            usados.add(achado);
            if (candidatos.length > 1) {
                ambiguos += 1;
                continue;
            }
            const acc = this.acumulado(acumulados, pesCod, baixa.credor);
            acc.contagens[this.grupoDoHistorico(achado.historico)] += 1;
            acc.meses.add(new Date(baixa.data).toISOString().slice(0, 7));
        }

        const perfis = [...acumulados.entries()].map(([pesCod, acc]) =>
            this.perfil(pesCod, acc, input),
        );
        return { perfis, ambiguos, semDebito, semFavorecido };
    };

    private chaveValor = (valor: number): string => Math.abs(valor).toFixed(2);

    private acumulado = (
        mapa: Map<string, Acumulado>,
        pesCod: string,
        credor: string | undefined,
    ): Acumulado => {
        let acc = mapa.get(pesCod);
        if (!acc) {
            acc = {
                contagens: {
                    [CHANNEL_GROUP.BOLETO]: 0,
                    [CHANNEL_GROUP.TED_PIX]: 0,
                    [CHANNEL_GROUP.OUTROS]: 0,
                },
                meses: new Set(),
            };
            mapa.set(pesCod, acc);
        }
        if (!acc.credor && credor) acc.credor = credor;
        return acc;
    };

    private perfil = (
        pesCod: string,
        acc: Acumulado,
        input: ChannelProfileInput,
    ): ChannelProfile => {
        const n = Object.values(acc.contagens).reduce((a, v) => a + v, 0);
        // Desempate estável na ordem BOLETO → TED_PIX → OUTROS (a mesma da probe).
        const [grupoDominante, qtd] = (
            Object.entries(acc.contagens) as Array<[ChannelGroup, number]>
        ).reduce((melhor, atual) => (atual[1] > melhor[1] ? atual : melhor));
        const participacao = n > 0 ? Number((qtd / n).toFixed(4)) : 0;
        return {
            pesCod,
            ...(acc.credor ? { credor: acc.credor } : {}),
            contagens: { ...acc.contagens },
            pagamentosUnicos: n,
            mesesDistintos: acc.meses.size,
            grupoDominante,
            participacao,
            confianca: this.confianca(n, acc.meses.size, qtd / n, input.limiares),
            janelaInicio: input.janela.inicio,
            janelaFim: input.janela.fim,
        };
    };

    private confianca = (
        n: number,
        meses: number,
        share: number,
        limiares: ChannelThresholds,
    ): ChannelConfidence => {
        if (
            n >= limiares.minPagamentos &&
            meses >= limiares.minMeses &&
            share >= limiares.minParticipacao
        ) {
            return CHANNEL_CONFIDENCE.ALTA;
        }
        if (n >= MEDIA_MIN_PAGAMENTOS && share >= MEDIA_MIN_PARTICIPACAO) {
            return CHANNEL_CONFIDENCE.MEDIA;
        }
        return CHANNEL_CONFIDENCE.BAIXA;
    };
}
