import { injectable } from 'tsyringe';
import {
    type CounterpartTitle,
    type DuplicateCandidate,
    type DuplicateMatch,
    ITEM_ALERT_TYPE,
} from '../../interface/sispag/SispagInterface.js';

const DIA_MS = 86_400_000;

export interface DuplicateDetectionOptions {
    /** Janela da FRACA, em dias para cada lado do vencimento (config do tenant; default 15). */
    janelaFracaDias: number;
}

/**
 * DuplicateDetector — duplicidade de título a pagar (ADR-0063, I13c–e). PURO: sem I/O.
 *
 * ```
 * contraparte(alvo, outro) só se:
 *     mesma filial (gap Q2)  ∧  outro (filCod, docCod) ≠ alvo (filCod, docCod)  (I13e, parcelas)
 *     ∧  mesmo favorecido (não vazio)
 * FORTE: mesma NF normalizada, não vazia — qualquer tipo de documento, inclusive pago (I13c)
 * FRACA: mesmo valor em centavos e vencimentos a ≤ N dias — e o documento NÃO é FORTE (I13d)
 * ```
 *
 * O resultado é por DOCUMENTO da contraparte e tipo: os títulos dele que casaram vão juntos em
 * `contraparteTitulos`. É a chave que mantém a justificativa estável na re-verificação (I13h).
 */
@injectable()
export default class DuplicateDetector {
    /** `docEspNumero` → só dígitos, sem zeros à esquerda. `''` = sem número (não casa). */
    public normalizarNota = (numero: string | number | null | undefined): string =>
        numero === null || numero === undefined
            ? ''
            : String(numero).replace(/\D/g, '').replace(/^0+/, '');

    public detectar = (
        alvo: DuplicateCandidate,
        universo: readonly DuplicateCandidate[],
        opcoes: DuplicateDetectionOptions,
    ): DuplicateMatch[] => {
        const favorecido = alvo.favorecido?.trim();
        if (!favorecido) return [];
        const janelaMs = opcoes.janelaFracaDias * DIA_MS;

        const fortes = new Map<string, DuplicateCandidate[]>();
        const fracas = new Map<string, DuplicateCandidate[]>();
        for (const outro of universo) {
            if (outro.filCod !== alvo.filCod) continue;
            if (outro.docCod === alvo.docCod) continue;
            if (outro.favorecido?.trim() !== favorecido) continue;
            if (alvo.numeroNota !== '' && outro.numeroNota === alvo.numeroNota) {
                this.acumular(fortes, outro);
            } else if (this.casaFraca(alvo, outro, janelaMs)) {
                this.acumular(fracas, outro);
            }
        }
        // I13d: documento que já é FORTE não gera também FRACA.
        for (const doc of fortes.keys()) fracas.delete(doc);

        return [
            ...[...fortes.entries()].map(([, titulos]) =>
                this.achado(ITEM_ALERT_TYPE.DUPLICIDADE_FORTE, titulos, {
                    numeroNota: alvo.numeroNota,
                }),
            ),
            ...[...fracas.entries()].map(([, titulos]) =>
                this.achado(ITEM_ALERT_TYPE.DUPLICIDADE_FRACA, titulos, {
                    valorCentavos: alvo.valorCentavos,
                    vencimento: alvo.vencimento,
                    janelaDias: opcoes.janelaFracaDias,
                }),
            ),
        ];
    };

    private casaFraca = (
        alvo: DuplicateCandidate,
        outro: DuplicateCandidate,
        janelaMs: number,
    ): boolean =>
        alvo.valorCentavos > 0 &&
        outro.valorCentavos === alvo.valorCentavos &&
        alvo.vencimento !== undefined &&
        outro.vencimento !== undefined &&
        Math.abs(outro.vencimento - alvo.vencimento) <= janelaMs;

    private acumular = (mapa: Map<string, DuplicateCandidate[]>, t: DuplicateCandidate): void => {
        const chave = `${t.filCod}|${t.docCod}`;
        const atual = mapa.get(chave);
        if (atual) atual.push(t);
        else mapa.set(chave, [t]);
    };

    private achado = (
        tipo: DuplicateMatch['tipo'],
        titulos: DuplicateCandidate[],
        evidencia: Record<string, unknown>,
    ): DuplicateMatch => {
        const ordenados = [...titulos].sort((a, b) => a.titCod.localeCompare(b.titCod, 'en'));
        const primeiro = ordenados[0] as DuplicateCandidate;
        return {
            tipo,
            contraparteFilCod: primeiro.filCod,
            contraparteDocCod: primeiro.docCod,
            contraparteTitulos: ordenados.map(
                (t): CounterpartTitle => ({
                    titCod: t.titCod,
                    valor: t.valorCentavos / 100,
                    ...(t.vencimento !== undefined ? { vencimento: t.vencimento } : {}),
                    pago: t.pago,
                }),
            ),
            evidencia,
        };
    };
}
