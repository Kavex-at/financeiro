import { injectable } from 'tsyringe';
import {
    type CounterpartTitle,
    type DuplicateCandidate,
    type DuplicateMatch,
    ITEM_ALERT_TYPE,
} from '../../interface/sispag/SispagInterface.js';

const DIA_MS = 86_400_000;

/** Um documento-contraparte e os títulos dele que casaram. */
interface Contraparte {
    filCod: number;
    docCod: string;
    titulos: DuplicateCandidate[];
}

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

        const fortes = new Map<string, Contraparte>();
        const fracas = new Map<string, Contraparte>();
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
            ...[...fortes.values()].map((c) =>
                this.achado(ITEM_ALERT_TYPE.DUPLICIDADE_FORTE, c, {
                    numeroNota: alvo.numeroNota,
                }),
            ),
            ...[...fracas.values()].map((c) =>
                this.achado(ITEM_ALERT_TYPE.DUPLICIDADE_FRACA, c, {
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

    private acumular = (mapa: Map<string, Contraparte>, t: DuplicateCandidate): void => {
        const chave = `${t.filCod}|${t.docCod}`;
        const atual = mapa.get(chave);
        if (atual) atual.titulos.push(t);
        else mapa.set(chave, { filCod: t.filCod, docCod: t.docCod, titulos: [t] });
    };

    private achado = (
        tipo: DuplicateMatch['tipo'],
        contraparte: Contraparte,
        evidencia: Record<string, unknown>,
    ): DuplicateMatch => {
        const ordenados = [...contraparte.titulos].sort((a, b) =>
            a.titCod.localeCompare(b.titCod, 'en'),
        );
        return {
            tipo,
            contraparteFilCod: contraparte.filCod,
            contraparteDocCod: contraparte.docCod,
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
