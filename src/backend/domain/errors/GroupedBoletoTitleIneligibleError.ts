import type { MotivoGrupoInelegivel } from '../interface/sispag/GrupoBoletoInterface.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

export interface TituloInelegivelGrupo {
    filCod: number;
    docCod: string;
    titCod: string;
    motivo: MotivoGrupoInelegivel;
}

/**
 * Confirmar ou incluir: algum título falha a I21c (alçada, pago, inativo, forma, DDA do ERP,
 * decisão 1:1, retenção, lote comprometido, outro grupo) — ou um título de grupo `CONFIRMADO` foi
 * incluído avulso. HTTP 409, com o motivo tipado de cada título.
 */
export default class GroupedBoletoTitleIneligibleError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_TITULO_INELEGIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: { grupoId?: string; titulos: TituloInelegivelGrupo[] };

    public constructor(params: { grupoId?: string; titulos: TituloInelegivelGrupo[] }) {
        const resumo = params.titulos
            .map((t) => `${t.filCod}:${t.docCod}:${t.titCod} ${t.motivo}`)
            .join('; ');
        super(`Grouped boleto title not eligible: ${resumo}`);
        this.name = 'GroupedBoletoTitleIneligibleError';
        const itens = params.titulos.map((t) => `${F.titulo(t)}: ${F.motivo(t.motivo)}`);
        this.userMessage =
            `${params.titulos.length > 1 ? 'Os títulos não podem' : 'O título não pode'} entrar no ` +
            `grupo de boleto (${itens.join('; ')}).`;
        this.details = {
            ...(params.grupoId !== undefined ? { grupoId: params.grupoId } : {}),
            titulos: params.titulos.map((t) => ({ ...t })),
        };
    }
}
