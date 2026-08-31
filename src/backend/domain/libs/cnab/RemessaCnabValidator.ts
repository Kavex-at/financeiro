import { injectable } from 'tsyringe';

/** Por que um segmento J foi recusado. */
export const MOTIVO_J_INVALIDO = {
    /** Campo de barras em branco — o defeito que a ADR-0040 corrigiu. */
    BARRAS_AUSENTE: 'BARRAS_AUSENTE',
    /** Não são 44 dígitos: truncado, com letra, ou preenchido pela metade. */
    BARRAS_MALFORMADA: 'BARRAS_MALFORMADA',
    /** 44 dígitos, mas o dígito verificador do próprio código não fecha. */
    DV_INVALIDO: 'DV_INVALIDO',
} as const;
export type MotivoJInvalido = (typeof MOTIVO_J_INVALIDO)[keyof typeof MOTIVO_J_INVALIDO];

export interface SegmentoJInvalido {
    /** Linha do arquivo (1-indexed) — o que o operador precisa para achar no `.REM`. */
    linha: number;
    motivo: MotivoJInvalido;
    /** Barras MASCARADA. Nunca logar o número completo: identifica beneficiário e valor. */
    barrasMascarada: string;
}

export interface ResultadoValidacaoRemessa {
    totalLinhas: number;
    segmentosJ: number;
    segmentosJ52: number;
    segmentosA: number;
    segmentosO: number;
    invalidos: SegmentoJInvalido[];
    /** Observações que NÃO bloqueiam (ver `valor` abaixo). */
    avisos: string[];
}

/**
 * Posições do registro de detalhe CNAB 240 (FEBRABAN), 1-indexed → índices 0-based.
 * Medidas contra `.REM` reais da Columbia (61 segmentos J de produção, 2026-08-31).
 */
const POS = {
    /** pos 14 — código do segmento ('A' crédito/TED, 'J' boleto, 'O' tributo). */
    SEGMENTO: 13,
    /** pos 18-19 — no segmento J, '52' marca o registro COMPLEMENTAR (J-52), sem barras. */
    SUBTIPO_INI: 17,
    SUBTIPO_FIM: 19,
    /** pos 18-61 — código de barras do boleto (44 dígitos) no segmento J. */
    BARRAS_INI: 17,
    BARRAS_FIM: 61,
} as const;

/** Comprimento mínimo para uma linha ser registro de detalhe e não header/trailer curto. */
const LINHA_MINIMA = 62;

/**
 * Valida o `.REM` gerado pelo `fin015` ANTES de o arquivo virar entregável.
 *
 * Existe porque o defeito que a ADR-0040 corrigiu era invisível até o banco recusar: o
 * `.REM` saía com **segmento J sem código de barras** e ninguém tinha como saber. O arquivo
 * é autoverificável — o código de barras carrega o próprio dígito verificador e o layout é
 * posicional —, então dá para recusar localmente, sem banco e sem esperar o `.RET`.
 *
 * Rodando sobre 61 segmentos J reais de produção, esta validação achou **um** código com DV
 * inválido num arquivo já enviado ao banco (fil 2, `PG121101.REM`, R$ 37.567,14) — digitado
 * à mão no caminho manual. O caminho DDA não erra assim (o ERP copia do arquivo do banco),
 * mas o manual segue existindo enquanto a Columbia não migrar 100%.
 *
 * ⚠️ **Segmento O (tributo/concessionária) é ignorado de propósito**: arrecadação usa
 * 48 posições e regra de DV diferente (módulo 10 em alguns segmentos). Validá-lo com a
 * regra do boleto produziria falso positivo. Fica como gap consciente.
 */
@injectable()
export default class RemessaCnabValidator {
    /**
     * Dígito verificador geral do código de barras (posição 5), módulo 11 com pesos 2..9
     * da direita para a esquerda. Resto 0, 1 ou DV > 9 ⇒ DV vale 1 (regra FEBRABAN).
     */
    public dvBarrasValido = (barras: string): boolean => {
        if (!/^\d{44}$/.test(barras)) return false;
        const semDv = barras.slice(0, 4) + barras.slice(5);
        let peso = 2;
        let soma = 0;
        for (let i = semDv.length - 1; i >= 0; i -= 1) {
            soma += Number(semDv[i]) * peso;
            peso = peso === 9 ? 2 : peso + 1;
        }
        const dv = 11 - (soma % 11);
        const esperado = dv === 0 || dv === 1 || dv > 9 ? 1 : dv;
        return Number(barras[4]) === esperado;
    };

    /** Valor em reais embutido no código de barras (pos 10-19, centavos). */
    public valorDasBarras = (barras: string): number => Number(barras.slice(9, 19)) / 100;

    /** Mascara o miolo — o número completo identifica beneficiário, valor e vencimento. */
    private mascarar = (barras: string): string =>
        barras.length <= 8
            ? '*'.repeat(barras.length)
            : `${barras.slice(0, 4)}${'x'.repeat(barras.length - 8)}${barras.slice(-4)}`;

    /**
     * Veredito sobre o campo de barras de UM segmento J. `undefined` = íntegro.
     * Extraído de `validar` para manter o laço legível (e o Biome quieto).
     */
    private avaliarBarras = (barras: string, numero: number): SegmentoJInvalido | undefined => {
        const limpo = barras.trim();
        if (limpo === '' || /^0+$/.test(limpo)) {
            return {
                linha: numero,
                motivo: MOTIVO_J_INVALIDO.BARRAS_AUSENTE,
                barrasMascarada: this.mascarar(limpo),
            };
        }
        if (!/^\d{44}$/.test(barras)) {
            return {
                linha: numero,
                motivo: MOTIVO_J_INVALIDO.BARRAS_MALFORMADA,
                barrasMascarada: this.mascarar(limpo),
            };
        }
        if (!this.dvBarrasValido(barras)) {
            return {
                linha: numero,
                motivo: MOTIVO_J_INVALIDO.DV_INVALIDO,
                barrasMascarada: this.mascarar(barras),
            };
        }
        return undefined;
    };

    public validar = (conteudo: string): ResultadoValidacaoRemessa => {
        const linhas = conteudo.split(/\r?\n/).filter((l) => l.length >= LINHA_MINIMA);
        const invalidos: SegmentoJInvalido[] = [];
        const avisos: string[] = [];
        const contagem = { J: 0, J52: 0, A: 0, O: 0 };

        conteudo.split(/\r?\n/).forEach((linha, idx) => {
            if (linha.length < LINHA_MINIMA) return;
            const segmento = linha[POS.SEGMENTO];
            if (segmento === 'A' || segmento === 'O') {
                contagem[segmento] += 1;
                return;
            }
            if (segmento !== 'J') return;
            // O boleto emite DOIS registros: o J (com as barras) e o J-52 (complemento com
            // CNPJ do favorecido/pagador). Contar os dois juntos faz metade dos segmentos
            // parecer "sem barras" — foi exatamente o falso positivo da primeira medição.
            if (linha.slice(POS.SUBTIPO_INI, POS.SUBTIPO_FIM) === '52') {
                contagem.J52 += 1;
                return;
            }
            contagem.J += 1;

            const barras = linha.slice(POS.BARRAS_INI, POS.BARRAS_FIM);
            const problema = this.avaliarBarras(barras, idx + 1);
            if (problema) {
                invalidos.push(problema);
                return;
            }
            // Boleto de valor ABERTO (barras com valor zerado) é legítimo — quem preenche é
            // quem paga. Não bloqueia; só registra, porque num lote SISPAG é incomum.
            if (this.valorDasBarras(barras) === 0) {
                avisos.push(`linha ${idx + 1}: código de barras com valor zerado (boleto aberto?)`);
            }
        });

        return {
            totalLinhas: linhas.length,
            segmentosJ: contagem.J,
            segmentosJ52: contagem.J52,
            segmentosA: contagem.A,
            segmentosO: contagem.O,
            invalidos,
            avisos,
        };
    };
}
