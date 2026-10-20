import type { MotivoGrupoInelegivel } from '../interface/sispag/GrupoBoletoInterface.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

export interface GrupoInelegivelNaRemessa {
    grupoId: string;
    codigoMascarado?: string;
    motivo: MotivoGrupoInelegivel | string;
    titulo?: { filCod: number; docCod: string; titCod: string };
}

/**
 * Gerar remessa: algum grupo do lote está inelegível AO VIVO (título pago/não liberado, soma,
 * boleto fora do pool, par revogado). Barra a remessa ANTES de qualquer escrita (I21p(1), PI-5;
 * espelho de I14a/I17g(1)). HTTP 409.
 */
export default class GroupedBoletoNotEligibleAtRemittanceError
    extends Error
    implements HandlerError
{
    public readonly code = 'GRUPO_BOLETO_INELEGIVEL_NA_REMESSA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: { loteId: string; grupos: GrupoInelegivelNaRemessa[] };

    public constructor(params: { loteId: string; grupos: GrupoInelegivelNaRemessa[] }) {
        const grupos = params.grupos.map((g) => ({
            ...g,
            ...(g.codigoMascarado !== undefined
                ? { codigoMascarado: F.mascarar(g.codigoMascarado) }
                : {}),
        }));
        super(
            `Lote ${params.loteId}: grouped boleto(s) not eligible at remittance: ${grupos.map((g) => `${g.grupoId} ${g.motivo}`).join('; ')}`,
        );
        this.name = 'GroupedBoletoNotEligibleAtRemittanceError';
        const itens = grupos.map((g) => {
            const boleto = g.codigoMascarado !== undefined ? ` ${g.codigoMascarado}` : '';
            const titulo = g.titulo !== undefined ? `, título ${F.titulo(g.titulo)}` : '';
            return `boleto agrupado${boleto}${titulo}: ${F.motivo(g.motivo)}`;
        });
        this.userMessage =
            `A remessa não foi gerada: ${itens.join('; ')}. Nada foi enviado ao Conexos. ` +
            'Retire ou anule o grupo e gere de novo.';
        this.details = { loteId: params.loteId, grupos };
    }
}
