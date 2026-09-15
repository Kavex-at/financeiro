import { inject, injectable } from 'tsyringe';
import type { DeclaracaoEntry } from '../../client/ConexosCadastroClient.js';
import type Adiantamento from '../../interface/permutas/Adiantamento.js';
import type DeclaracaoImportacao from '../../interface/permutas/DeclaracaoImportacao.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
    type MotivoBloqueio,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type Invoice from '../../interface/permutas/Invoice.js';
import { GATE, type GateResult } from '../../interface/permutas/PermutaCandidata.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import ToleranciaResiduo from '../../interface/permutas/ToleranciaResiduo.js';
import CasamentoInvoiceService from './CasamentoInvoiceService.js';

export interface AvaliarElegibilidadeInput {
    adiantamento: Adiantamento;
    /** Declarações do processo (D.I/DUIMP) — XOR decidido aqui (Gate 4). */
    declaracoes: DeclaracaoEntry[];
    /** INVOICEs FINALIZADAS do processo (casamento P0-6). */
    invoices: Invoice[];
}

/**
 * Avaliação de elegibilidade de uma PermutaCandidata.
 * Estado + motivo + casamento + declaração resolvida (sem aging/variação — esses
 * são compostos pelo orquestrador). `aging` fica para o `EleicaoPermutasService`.
 */
export type ElegibilidadeResult = Pick<
    PermutaCandidata,
    | 'priCod'
    | 'adiantamento'
    | 'invoiceCasada'
    | 'invoicesCandidatas'
    | 'declaracaoImportacao'
    | 'estadoElegibilidade'
    | 'motivoBloqueio'
    | 'gatesAvaliados'
>;

/**
 * ElegibilidadeService — ação `avaliarElegibilidade` (regra `elegibilidade-permuta`).
 *
 * Ontology: `ontology/business-rules/elegibilidade-permuta.md` + state-machine.
 * Aplica os 4 gates (PROFORMA / valorPermutar > R$1,00 / TOTALMENTE PAGO / D.I XOR DUIMP)
 * e o casamento 1:1. ELEGIVEL ⇔ 4 gates verdes E exatamente 1 invoice casada.
 * Caso contrário → BLOQUEADA com motivo, EXCETO o adiantamento pago cujo saldo
 * já foi consumido numa permuta anterior, que vai a JA_PERMUTADO (T6/ADR-0043 —
 * estado concluído, não reprovação). Estados como constantes tipadas (P3).
 *
 * Tolerância de resíduo (ADR-0046 D1): saldo ≤ R$1,00 conta como sem saldo (Gate 2);
 * o Gate 3 lê o `pago` já hidratado com a mesma tolerância (em aberto ≤ R$1,00) pelo
 * `EleicaoPermutasService`. Prioridade dos motivos (ADR-0046 D2): uma só, em
 * `motivoDoGateFalho` — a falta de D.I nunca mascara pagamento nem saldo.
 */
@injectable()
export default class ElegibilidadeService {
    constructor(
        @inject(CasamentoInvoiceService)
        private casamentoInvoiceService: CasamentoInvoiceService,
    ) {}

    public avaliarElegibilidade = (input: AvaliarElegibilidadeInput): ElegibilidadeResult => {
        const { adiantamento, declaracoes, invoices } = input;

        const gate4 = this.evaluateDeclaracaoXor(declaracoes);
        const gatesAvaliados: GateResult[] = [
            // Gate 1 — tipo PROFORMA: garantido pela eleição (caminho PROFORMA +
            // adiantamento=SIM). Registrado para auditoria (I5).
            { gate: GATE.PROFORMA, passed: true, detail: 'eleito via path PROFORMA' },
            // Gate 2 — valorPermutar > R$1,00 (resíduo de centavos conta como zero, ADR-0046 D1).
            {
                gate: GATE.VALOR_PERMUTAR,
                passed: !ToleranciaResiduo.semSaldoPermutar(adiantamento.valorPermutar),
                detail: `valorPermutar=${adiantamento.valorPermutar ?? 0}`,
            },
            // Gate 3 — TOTALMENTE PAGO (em aberto ≤ R$1,00, hidratado pela eleição).
            { gate: GATE.TOTALMENTE_PAGO, passed: adiantamento.pago === true },
            // Gate 4 — D.I XOR DUIMP.
            { gate: GATE.DI_XOR_DUIMP, passed: gate4.passed, detail: gate4.detail },
        ];

        const base = {
            priCod: adiantamento.priCod,
            adiantamento,
            ...(gate4.declaracao !== undefined ? { declaracaoImportacao: gate4.declaracao } : {}),
            gatesAvaliados,
        };

        // Algum gate (2/3/4) falhou → motivo ESPECÍFICO do gate reprovado, em vez
        // do genérico `falha-gate`. Prioridade pela causa-raiz (ADR-0046 D2): NÃO
        // PAGO (gate 3) → SEM SALDO / JÁ PERMUTADO (gate 2) → SEM D.I / D.I+DUIMP
        // (gate 4). O saldo a permutar deriva do valor pago, então um não-pago
        // também zera o gate 2; mostrar "não pago" é o acionável.
        const algumGateFalhou = gatesAvaliados.some((g) => !g.passed);
        if (algumGateFalhou) {
            // T6 (ADR-0043) — o motivo é resolvido UMA vez e o estado é DERIVADO
            // dele. A regra de prioridade não é duplicada: se `motivoDoGateFalho`
            // concluiu `ja-permutado` (pago + gate 2 reprovado + já houve permuta),
            // o estado é JA_PERMUTADO — estado CONCLUÍDO, não reprovação. Qualquer
            // outro motivo segue BLOQUEADA.
            const motivo = this.motivoDoGateFalho(gatesAvaliados, adiantamento, gate4.motivo);
            return {
                ...base,
                estadoElegibilidade:
                    motivo === MOTIVO_BLOQUEIO.JA_PERMUTADO
                        ? ESTADO_ELEGIBILIDADE.JA_PERMUTADO
                        : ESTADO_ELEGIBILIDADE.BLOQUEADA,
                motivoBloqueio: motivo,
            };
        }

        // Casamento de invoice (P0-6): 1 → casada; 0 → sem-invoice; >1 → composto-nm.
        const casamento = this.casamentoInvoiceService.casarInvoice(invoices);
        if (casamento.motivoBloqueio !== undefined) {
            // N:M (`composto-nm` / `multiplas-invoices`): os 4 gates passaram, só
            // falta o analista escolher a invoice → CASAMENTO_MANUAL (ADR-0005),
            // NÃO bloqueada. O motivo segue informativo (qual sabor de N:M). Os
            // demais motivos (`sem-invoice`, etc.) continuam reprovação → BLOQUEADA.
            const isNm =
                casamento.motivoBloqueio === MOTIVO_BLOQUEIO.COMPOSTO_NM ||
                casamento.motivoBloqueio === MOTIVO_BLOQUEIO.MULTIPLAS_INVOICES;
            return {
                ...base,
                estadoElegibilidade: isNm
                    ? ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL
                    : ESTADO_ELEGIBILIDADE.BLOQUEADA,
                motivoBloqueio: casamento.motivoBloqueio,
                // N:M: leva as invoices candidatas do processo p/ persistir e deixar
                // o analista escolher uma na tela (ADR-0005).
                ...(isNm ? { invoicesCandidatas: invoices } : {}),
            };
        }

        // 4 gates verdes E 1 invoice casada → ELEGIVEL (I3 / T1).
        return {
            ...base,
            ...(casamento.invoiceCasada !== undefined
                ? { invoiceCasada: casamento.invoiceCasada }
                : {}),
            estadoElegibilidade: ESTADO_ELEGIBILIDADE.ELEGIVEL,
        };
    };

    /**
     * Mapeia o gate reprovado para um motivo ESPECÍFICO (em vez do genérico
     * `falha-gate`). Prioridade pela causa-raiz quando mais de um gate falha
     * (ADR-0046 D2):
     *   1. gate 3 → `nao-pago`
     *   2. gate 2 → `ja-permutado` | `sem-saldo-permutar`
     *   3. gate 4 → `data-base-indisponivel` (nenhuma declaração) | `di-duimp-ambos`
     *   4. fallback `falha-gate`
     * Esta ordem é a ÚNICA fonte da regra de prioridade — o estado (BLOQUEADA
     * vs. JA_PERMUTADO) é derivado do motivo resolvido aqui, nunca recalculado
     * no call site (ADR-0043). A falta de D.I/DUIMP nunca mascara pagamento nem
     * saldo: um adto pago, sem saldo e já permutado é JA_PERMUTADO mesmo sem D.I.
     *
     * Gate 2 (VALOR_PERMUTAR) reprovado chega aqui só quando o adiantamento já
     * está pago (gate 3 tem prioridade). Nesse ponto distingue-se a causa do
     * saldo zerado pelo `valorPermutado` (`mnyTitPermuta` do detalhe): se já
     * houve permuta (`> 0`) → `JA_PERMUTADO` (estado concluído, não erro);
     * senão → `SEM_SALDO_PERMUTAR` (nunca teve saldo).
     */
    private motivoDoGateFalho = (
        gates: GateResult[],
        adiantamento: Adiantamento,
        motivoGate4?: MotivoBloqueio,
    ): MotivoBloqueio => {
        const falhou = (gate: GateResult['gate']): boolean =>
            gates.some((g) => g.gate === gate && !g.passed);
        if (falhou(GATE.TOTALMENTE_PAGO)) return MOTIVO_BLOQUEIO.NAO_PAGO;
        if (falhou(GATE.VALOR_PERMUTAR)) {
            return (adiantamento.valorPermutado ?? 0) > 0
                ? MOTIVO_BLOQUEIO.JA_PERMUTADO
                : MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR;
        }
        if (falhou(GATE.DI_XOR_DUIMP)) {
            return motivoGate4 === MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL
                ? MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL
                : MOTIVO_BLOQUEIO.DI_DUIMP_AMBOS;
        }
        return MOTIVO_BLOQUEIO.FALHA_GATE;
    };

    /**
     * Gate 4 — D.I XOR DUIMP (regra `di-xor-duimp`, I2):
     *   - exatamente 1 variante → passa, resolve a declaração.
     *   - nenhuma → bloqueia (`data-base-indisponivel`).
     *   - ambas → anomalia XOR → bloqueia (`falha-gate`).
     */
    private evaluateDeclaracaoXor = (
        declaracoes: DeclaracaoEntry[],
    ): {
        passed: boolean;
        detail: string;
        declaracao?: DeclaracaoImportacao;
        motivo?: MotivoBloqueio;
    } => {
        const temDi = declaracoes.some((d) => d.variante === 'DI');
        const temDuimp = declaracoes.some((d) => d.variante === 'DUIMP');

        if (temDi !== temDuimp) {
            const entry = declaracoes.find((d) => d.variante === (temDi ? 'DI' : 'DUIMP'));
            const declaracao: DeclaracaoImportacao | undefined = entry
                ? {
                      variante: entry.variante,
                      priCod: entry.priCod,
                      ...(entry.dataBase !== undefined ? { dataBase: entry.dataBase } : {}),
                  }
                : undefined;
            return {
                passed: true,
                detail: temDi ? 'DI' : 'DUIMP',
                ...(declaracao !== undefined ? { declaracao } : {}),
            };
        }

        if (!temDi && !temDuimp) {
            return {
                passed: false,
                detail: 'sem D.I nem DUIMP',
                motivo: MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL,
            };
        }

        // ambas → anomalia XOR.
        return {
            passed: false,
            detail: 'D.I e DUIMP presentes (anomalia XOR)',
            motivo: MOTIVO_BLOQUEIO.FALHA_GATE,
        };
    };
}
