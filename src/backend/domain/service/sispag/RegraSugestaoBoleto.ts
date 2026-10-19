import { injectable } from 'tsyringe';
import {
    type AvaliacaoSugestao,
    type AvaliacaoSugestaoEntrada,
    RESULTADO_SUGESTAO,
    type ResultadoSugestao,
    SINAL_SUGESTAO,
    type SinalSugestao,
    TIER_SUGESTAO,
} from '../../interface/sispag/SugestaoBoleto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Limites GLOBAIS (seguros) da sugestão — I15c, decididos pelo maintainer (Q-B, 2026-10-14).
 * Constantes de código, não por tenant; ajustáveis por ADR curta. A confirmação de um par NUNCA os
 * alarga (I15d).
 */
/** |Δvalor| máximo, em reais, quando o boleto vence no MESMO dia do título. */
export const LIMITE_VALOR_MESMO_DIA = 0.05;
/** Valor igual: boleto vencendo de 1 a 5 dias DEPOIS do título (e não antes da data de débito). */
export const DIAS_DEPOIS_MIN = 1;
export const DIAS_DEPOIS_MAX = 5;

/**
 * Envelope de PLAUSIBILIDADE da `ATENCAO` (decisão do implementador, não do maintainer — ver
 * `ontology/_inbox/sispag-sugestao-boleto-dda-gap.md`): fora dele o par é `SEM_RELACAO`. Não é
 * limite de segurança: tudo que cai aqui e fora dos limites globais é só `ATENCAO`.
 * Calibrado nos casos medidos (+R$ 0,01, +1,6 %, +R$ 10,00, +1 a +3 dias).
 */
export const ENVELOPE_VALOR_ABSOLUTO = 10;
export const ENVELOPE_VALOR_PERCENTUAL = 2;
export const ENVELOPE_DIAS = 10;

/**
 * Texto estático da regra de candidato para a tela — um único lugar, vindo das constantes acima.
 * A aba "Boletos DDA" mostra isto no lugar do antigo "mesmo valor e vencimento em ±N dias".
 */
export const REGRA_CANDIDATO_TEXTO = `candidato = diferença de até R$ ${LIMITE_VALOR_MESMO_DIA.toFixed(2).replace('.', ',')} no mesmo dia, ou valor igual com vencimento de ${DIAS_DEPOIS_MIN} a ${DIAS_DEPOIS_MAX} dias depois do título (nunca antes da data de débito)`;

const centavos = (valor: number): number => Math.round(valor * 100);

/** Memo de `Date.parse` por data civil: o motor avalia ~10⁵ pares sobre poucas datas distintas. */
const EPOCH_POR_DATA = new Map<string, number>();
const LIMITE_MEMO_DATAS = 20_000;

const epochDaData = (civil: string): number => {
    let epoch = EPOCH_POR_DATA.get(civil);
    if (epoch === undefined) {
        epoch = Date.parse(`${civil}T00:00:00Z`);
        if (EPOCH_POR_DATA.size >= LIMITE_MEMO_DATAS) EPOCH_POR_DATA.clear();
        EPOCH_POR_DATA.set(civil, epoch);
    }
    return epoch;
};

const diasEntre = (de: string, ate: string): number =>
    Math.round((epochDaData(ate) - epochDaData(de)) / DAY_MS);

/**
 * Faixa de valor (centavos, inclusiva) em que um título pode ser candidato de um boleto de
 * `valorCentavos`. Serve para indexar por valor sem O(n × m); a regra decide o resto.
 */
export const faixaDeCandidatos = (valorCentavos: number): [number, number] => {
    const absoluto = centavos(ENVELOPE_VALOR_ABSOLUTO);
    const pct = ENVELOPE_VALOR_PERCENTUAL / 100;
    return [
        Math.floor(Math.min(valorCentavos - absoluto, valorCentavos / (1 + pct))),
        Math.ceil(Math.max(valorCentavos + absoluto, valorCentavos / (1 - pct))),
    ];
};

/** Só dígitos, sem zeros à esquerda; vazio = sem número (nunca penaliza). */
const digitos = (numero?: string): string => (numero ?? '').replace(/\D/g, '').replace(/^0+/, '');

/**
 * Regra PURA de par título × boleto (I15c–I15f, I15h). Sem I/O, sem estado, sem relógio: a data de
 * débito entra como argumento e todas as datas são datas civis (UTC meia-noite, BRT).
 *
 * Valores comparados em centavos inteiros. Deltas SEMPRE com sinal, boleto − título.
 */
@injectable()
export default class RegraSugestaoBoleto {
    public avaliar = (entrada: AvaliacaoSugestaoEntrada): AvaliacaoSugestao => {
        const { titulo, boleto, dataDebito, parConfirmado, ordemDps } = entrada;
        const tituloCentavos = centavos(titulo.valor);
        const deltaCentavos = centavos(boleto.valor) - tituloCentavos;
        const deltaDias = diasEntre(titulo.vencimento, boleto.vencimento);
        const deltaPercentual =
            tituloCentavos === 0
                ? 0
                : Math.round((deltaCentavos / tituloCentavos) * 100 * 10_000) / 10_000;

        const sinais: SinalSugestao[] = [];
        // Dias em que o boleto já estará vencido na data de débito (I15o): derivado, nunca gravado.
        const debitoAteBoleto = diasEntre(dataDebito, boleto.vencimento);
        const diasAtraso = -debitoAteBoleto;
        const resposta = (resultado: ResultadoSugestao): AvaliacaoSugestao => ({
            resultado,
            deltaValor: deltaCentavos / 100,
            deltaPercentual,
            deltaDias,
            sinais,
            confirmavel: CONFIRMAVEIS.has(resultado),
            diasVencidoNoDebito: Number.isNaN(diasAtraso) ? 0 : Math.max(0, diasAtraso),
        });

        if (Number.isNaN(deltaDias) || Number.isNaN(diasEntre(titulo.vencimento, dataDebito))) {
            return resposta(RESULTADO_SUGESTAO.SEM_RELACAO);
        }

        const numeroIgual = this.numeroIgual(titulo.numeroDocumento, boleto.numero);

        // Fora do envelope não é candidato — e número igual NÃO resgata (I15f).
        if (this.foraDoEnvelope(deltaCentavos, deltaDias, tituloCentavos)) {
            if (numeroIgual) {
                sinais.push(SINAL_SUGESTAO.NUMERO_IGUAL, SINAL_SUGESTAO.COLISAO_NUMERO);
            }
            return resposta(RESULTADO_SUGESTAO.SEM_RELACAO);
        }

        sinais.push(...this.sinaisDeValorEData(deltaCentavos, deltaDias));
        // Aviso derivado (I15o): só dentro do envelope; não muda tier, deltas nem confirmabilidade.
        if (deltaDias < 0) sinais.push(SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO);

        const venceAntesDoDebito = debitoAteBoleto < 0;
        const dentroDosLimites =
            !venceAntesDoDebito && this.dentroDosLimites(deltaCentavos, deltaDias);

        if (numeroIgual) {
            sinais.push(SINAL_SUGESTAO.NUMERO_IGUAL);
            // Número igual com valor/data fora do limite é colisão (I15f); não sobe o tier.
            if (!dentroDosLimites) sinais.push(SINAL_SUGESTAO.COLISAO_NUMERO);
        }

        // Âncoras DPS (I15p): só dentro do envelope, nunca sobem o tier nem alargam limite.
        sinais.push(...this.sinaisDps(titulo.dps, boleto.numero, ordemDps === true));

        // O par é evidência exibida; só promove FORTE → CONHECIDO dentro dos limites (I15d).
        if (parConfirmado) sinais.push(SINAL_SUGESTAO.EMISSOR_CONFIRMADO);

        // I15h: boleto vencido na data de débito é só informativo — nunca CONHECIDO nem FORTE.
        if (venceAntesDoDebito) return resposta(RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO);
        if (!dentroDosLimites) return resposta(RESULTADO_SUGESTAO.ATENCAO);
        return resposta(parConfirmado ? TIER_SUGESTAO.CONHECIDO : TIER_SUGESTAO.FORTE);
    };

    private numeroIgual = (doTitulo?: string, doBoleto?: string): boolean =>
        digitos(doTitulo) !== '' && digitos(doTitulo) === digitos(doBoleto);

    /** O boleto do emissor de NFS-e numera como `<DPS>000` (I15p(1)); a ordem vem do motor (I15p(2)). */
    private sinaisDps = (dps: string | undefined, doBoleto: string | undefined, ordem: boolean) => {
        const sinais: SinalSugestao[] = [];
        if (digitos(dps) !== '' && `${digitos(dps)}000` === digitos(doBoleto)) {
            sinais.push(SINAL_SUGESTAO.DPS_IGUAL);
        }
        if (ordem) sinais.push(SINAL_SUGESTAO.ORDEM_DPS);
        return sinais;
    };

    private foraDoEnvelope = (
        deltaCentavos: number,
        deltaDias: number,
        tituloCentavos: number,
    ): boolean => {
        const tolerancia = Math.max(
            centavos(ENVELOPE_VALOR_ABSOLUTO),
            Math.round((tituloCentavos * ENVELOPE_VALOR_PERCENTUAL) / 100),
        );
        return Math.abs(deltaCentavos) > tolerancia || Math.abs(deltaDias) > ENVELOPE_DIAS;
    };

    private sinaisDeValorEData = (deltaCentavos: number, deltaDias: number): SinalSugestao[] => {
        const sinais: SinalSugestao[] = [];
        if (deltaCentavos === 0) sinais.push(SINAL_SUGESTAO.VALOR_IGUAL);
        else if (Math.abs(deltaCentavos) <= centavos(LIMITE_VALOR_MESMO_DIA)) {
            sinais.push(SINAL_SUGESTAO.VALOR_ATE_5_CENTAVOS);
        }
        if (deltaDias === 0) sinais.push(SINAL_SUGESTAO.MESMO_DIA);
        else if (deltaDias >= DIAS_DEPOIS_MIN) sinais.push(SINAL_SUGESTAO.DIAS_DEPOIS);
        return sinais;
    };

    /** (a) |Δvalor| ≤ R$ 0,05 no mesmo dia; ou (b) valor igual e 1–5 dias depois (I15c). */
    private dentroDosLimites = (deltaCentavos: number, deltaDias: number): boolean => {
        const mesmoDiaComCentavos =
            Math.abs(deltaCentavos) <= centavos(LIMITE_VALOR_MESMO_DIA) && deltaDias === 0;
        const valorIgualDiasDepois =
            deltaCentavos === 0 && deltaDias >= DIAS_DEPOIS_MIN && deltaDias <= DIAS_DEPOIS_MAX;
        return mesmoDiaComCentavos || valorIgualDiasDepois;
    };
}

const CONFIRMAVEIS: ReadonlySet<ResultadoSugestao> = new Set<ResultadoSugestao>([
    RESULTADO_SUGESTAO.CONHECIDO,
    RESULTADO_SUGESTAO.FORTE,
    RESULTADO_SUGESTAO.ATENCAO,
]);
