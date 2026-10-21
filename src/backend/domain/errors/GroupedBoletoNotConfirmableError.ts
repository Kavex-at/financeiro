import type { MotivoGrupoInelegivel } from '../interface/sispag/GrupoBoletoInterface.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

/**
 * Confirmar grupo: o grupo como um todo não é confirmável (I21a/b/h, I15q) por um motivo que não é
 * de um título nem da soma — boleto fora do pool, vinculado pelo ERP, já confirmado 1:1, vencido,
 * código inválido, par impossível, menos de dois títulos, credores diferentes — ou, na origem
 * `SUGERIDO`, a sugestão recalculada não é mais o conjunto enviado. HTTP 409; só a máscara sai.
 */
export default class GroupedBoletoNotConfirmableError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_NAO_CONFIRMAVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: {
        ddcCod: number;
        ditCod: number;
        codigoMascarado?: string;
        motivos: MotivoGrupoInelegivel[];
        sugestaoMudou: boolean;
    };

    public constructor(params: {
        ddcCod: number;
        ditCod: number;
        codigoMascarado?: string;
        motivos?: MotivoGrupoInelegivel[];
        sugestaoMudou?: boolean;
    }) {
        const motivos = [...(params.motivos ?? [])];
        const sugestaoMudou = params.sugestaoMudou === true;
        const mascara =
            params.codigoMascarado !== undefined ? F.mascarar(params.codigoMascarado) : undefined;
        super(
            `Grouped boleto ${params.ddcCod}/${params.ditCod} not confirmable: ${
                sugestaoMudou ? 'suggestion changed' : motivos.join(',')
            }`,
        );
        this.name = 'GroupedBoletoNotConfirmableError';
        const boleto = `O grupo do boleto${mascara !== undefined ? ` ${mascara}` : ''}`;
        this.userMessage = sugestaoMudou
            ? `${boleto} não é mais a sugestão do sistema: os títulos do mesmo credor e vencimento ` +
              'mudaram. Atualize a lista; se quiser este conjunto, componha o grupo à mão.'
            : `${boleto} não pode ser confirmado (${F.lista(motivos.map(F.motivo))}).`;
        this.details = {
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
            ...(mascara !== undefined ? { codigoMascarado: mascara } : {}),
            motivos,
            sugestaoMudou,
        };
    }
}
