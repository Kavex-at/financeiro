import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

export interface TituloForaDaJanela {
    filCod: number;
    docCod: string;
    titCod: string;
    vencimento: string;
    /** Vencimento do boleto − vencimento do título, em dias civis. */
    deltaDias: number;
}

/**
 * Composição manual com título fora da janela `0 ≤ vencimentoBoleto − vencimentoTitulo ≤ 10`
 * dias civis (I21g, P0-2). HTTP 422.
 */
export default class GroupedBoletoDueWindowError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_FORA_DA_JANELA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details: { vencimentoBoleto: string; titulos: TituloForaDaJanela[] };

    public constructor(params: { vencimentoBoleto: string; titulos: TituloForaDaJanela[] }) {
        const resumo = params.titulos
            .map((t) => `${t.filCod}:${t.docCod}:${t.titCod} delta ${t.deltaDias}d`)
            .join('; ');
        super(
            `Grouped boleto due window violated (boleto due ${params.vencimentoBoleto}): ${resumo}`,
        );
        this.name = 'GroupedBoletoDueWindowError';
        const itens = params.titulos.map((t) => `${F.titulo(t)} vence em ${F.data(t.vencimento)}`);
        this.userMessage =
            `O boleto vence em ${F.data(params.vencimentoBoleto)} e ${itens.join('; ')}. ` +
            'Cada título precisa vencer no mesmo dia do boleto ou até 10 dias antes.';
        this.details = {
            vencimentoBoleto: params.vencimentoBoleto,
            titulos: params.titulos.map((t) => ({ ...t })),
        };
    }
}
