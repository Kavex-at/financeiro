import { injectable } from 'tsyringe';
import { type EmissorBoleto, LAYOUT_EMISSOR } from '../../interface/sispag/SugestaoBoleto.js';
import FatorVencimentoBoleto from './FatorVencimentoBoleto.js';

const SO_DIGITOS = /^\d+$/;
const FATOR = new FatorVencimentoBoleto();

/**
 * Código de barras de boleto BANCÁRIO (44 dígitos, layout FEBRABAN):
 *
 *     BBB M D FFFF VVVVVVVVVV LLLLLLLLLLLLLLLLLLLLLLLLL
 *     banco(3) moeda(1) DV geral(1) fator venc.(4) valor(10) campo livre(25)
 *
 * O `fin124` guarda as barras (44). Quem paga à mão cola a LINHA DIGITÁVEL (47), então a aba de
 * boletos mostra as duas. A conversão é determinística: os campos 1–3 são pedaços das barras com
 * um DV módulo 10 cada, o campo 4 é o DV geral e o campo 5 é fator + valor.
 *
 * Arrecadação/concessionária (barras começando com 8) tem outro layout e não entra no DDA — cai
 * fora (`undefined`), em vez de devolver uma linha errada.
 */
@injectable()
export default class CodigoBarrasBoleto {
    /** 44 → 47 dígitos. `undefined` se não for um código de boleto bancário válido. */
    public paraLinhaDigitavel = (codbar?: string): string | undefined => {
        const barras = this.normalizar(codbar);
        if (!barras) return undefined;
        const livre = barras.slice(19, 44);
        const campo1 = barras.slice(0, 4) + livre.slice(0, 5);
        const campo2 = livre.slice(5, 15);
        const campo3 = livre.slice(15, 25);
        return (
            campo1 +
            this.modulo10(campo1) +
            campo2 +
            this.modulo10(campo2) +
            campo3 +
            this.modulo10(campo3) +
            barras.slice(4, 5) +
            barras.slice(5, 19)
        );
    };

    /**
     * 47 → 44 dígitos (inverso de `paraLinhaDigitavel`), conferindo os 3 DVs de campo e o DV
     * geral. Aceita também 44 dígitos (confere só o DV geral). `undefined` se inválido ou se for
     * arrecadação (inicia por 8). Nunca lança.
     */
    public paraBarras = (codigo?: string): string | undefined => {
        const c = (codigo ?? '').trim();
        if (!SO_DIGITOS.test(c) || c.startsWith('8')) return undefined;
        let barras: string;
        if (c.length === 44) {
            barras = c;
        } else if (c.length === 47) {
            const campos = [c.slice(0, 9), c.slice(10, 20), c.slice(21, 31)];
            const dvs = [c[9], c[20], c[31]];
            if (campos.some((campo, i) => this.modulo10(campo) !== dvs[i])) return undefined;
            barras =
                c.slice(0, 4) +
                c[32] +
                c.slice(33, 47) +
                c.slice(4, 9) +
                c.slice(10, 20) +
                c.slice(21, 31);
        } else {
            return undefined;
        }
        return this.dvGeralValido(barras) ? barras : undefined;
    };

    /**
     * Decodifica valor e vencimento do código (44 ou 47), conferindo os DVs (`paraBarras`).
     * `referencia` (data civil `YYYY-MM-DD`) escolhe o ciclo do fator de vencimento (definição única
     * em `FatorVencimentoBoleto`: ciclos de 9.000 dias, reinício em 22/02/2025). Fator `0000` =
     * sem vencimento (`semVencimento`, `vencimento` ausente).
     * Nunca lança; `undefined` se o código for inválido ou arrecadação.
     */
    public decodificar = (
        codigo: string | undefined,
        referencia: string,
    ):
        | {
              barras: string;
              banco: string;
              valorCentavos: number;
              vencimento?: string;
              /** Fator `0000`: o boleto não carrega vencimento (distinto de "não decodificável"). */
              semVencimento?: true;
          }
        | undefined => {
        const barras = this.paraBarras((codigo ?? '').replace(/[\s.]/g, ''));
        if (!barras) return undefined;
        const fator = barras.slice(5, 9);
        const base = {
            barras,
            banco: barras.slice(0, 3),
            valorCentavos: Number(barras.slice(9, 19)),
        };
        const decodificado = FATOR.decodificar(fator, referencia);
        if (decodificado === undefined) return base;
        if ('semVencimento' in decodificado) return { ...base, semVencimento: true };
        return { ...base, vencimento: decodificado.vencimento };
    };

    /** Código FEBRABAN do banco emissor (ex.: `341` Itaú). */
    public bancoEmissor = (codbar?: string): string | undefined =>
        this.normalizar(codbar)?.slice(0, 3);

    /**
     * Forma exibível e persistível do código (ADR-0068, I15k): banco + 4 últimos dígitos. Nunca as
     * barras completas nem a linha digitável. `undefined` se não for boleto bancário válido.
     */
    public mascarar = (codbar?: string): string | undefined => {
        const barras = this.normalizar(codbar);
        return barras ? `${barras.slice(0, 3)}…${barras.slice(-4)}` : undefined;
    };

    /**
     * Conta emissora do boleto (ADR-0068, I15g). Posições no CAMPO LIVRE (25 dígitos =
     * `barras.slice(19)`), verificadas em 2026-10-13 contra barras reais do pool de PRD:
     *
     *  - Itaú 341:     carteira(3) nossoNúmero(8) DAC(1) agência(4) conta(5) DAC(1) '000'
     *  - Bradesco 237: agência(4) carteira(2) nossoNúmero(11) conta(7) '0'
     *  - demais bancos: layout NÃO verificado → chave genérica `banco:<primeiros 8 dígitos do campo
     *    livre>`. Confirmável por humano, mas `GENERICO` nunca é elegível a automático (I15i).
     *
     * Nunca lança: código inválido → `undefined`. Nenhuma saída contém as barras completas.
     */
    public emissor = (codbar?: string): EmissorBoleto | undefined => {
        const barras = this.normalizar(codbar);
        if (!barras) return undefined;
        const banco = barras.slice(0, 3);
        const livre = barras.slice(19);

        if (banco === '341') {
            const agencia = livre.slice(12, 16);
            const conta = livre.slice(16, 21);
            return {
                banco,
                layout: LAYOUT_EMISSOR.ITAU_341,
                chave: `${banco}:${agencia}:${conta}`,
                mascarado: `${banco} / ${agencia} / ***${conta.slice(-4)}`,
            };
        }
        if (banco === '237') {
            const agencia = livre.slice(0, 4);
            const conta = livre.slice(17, 24);
            return {
                banco,
                layout: LAYOUT_EMISSOR.BRADESCO_237,
                chave: `${banco}:${agencia}:${conta}`,
                mascarado: `${banco} / ${agencia} / ***${conta.slice(-4)}`,
            };
        }
        const prefixo = livre.slice(0, 8);
        return {
            banco,
            layout: LAYOUT_EMISSOR.GENERICO,
            chave: `${banco}:${prefixo}`,
            mascarado: `${banco} / ${prefixo.slice(0, 4)} / ****`,
        };
    };

    private normalizar = (codbar?: string): string | undefined => {
        const barras = (codbar ?? '').trim();
        if (barras.length !== 44 || !SO_DIGITOS.test(barras) || barras.startsWith('8')) {
            return undefined;
        }
        return barras;
    };

    /** DV geral módulo 11 (posição 5 das barras): pesos 2..9 da direita; 0/10/11 valem 1. */
    private dvGeralValido = (barras: string): boolean => {
        const semDv = barras.slice(0, 4) + barras.slice(5);
        let soma = 0;
        let peso = 2;
        for (let i = semDv.length - 1; i >= 0; i -= 1) {
            soma += Number(semDv[i]) * peso;
            peso = peso === 9 ? 2 : peso + 1;
        }
        const dv = 11 - (soma % 11);
        const esperado = dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
        return Number(barras[4]) === esperado;
    };

    /** DV módulo 10: pesos 2,1,2,1… da direita para a esquerda, somando os dígitos do produto. */
    private modulo10 = (campo: string): string => {
        let soma = 0;
        let peso = 2;
        for (let i = campo.length - 1; i >= 0; i -= 1) {
            const produto = Number(campo[i]) * peso;
            soma += produto > 9 ? produto - 9 : produto;
            peso = peso === 2 ? 1 : 2;
        }
        return String((10 - (soma % 10)) % 10);
    };
}
