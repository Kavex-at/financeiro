import { injectable } from 'tsyringe';
import {
    DESTINO_APROVACAO,
    DESTINO_MANUAL_TIPO,
    type DestinoAprovacao,
    type DestinoManual,
    type ItemLote,
    MODALIDADE,
} from '../../interface/sispag/SispagInterface.js';

/** As flags que decidem se o destino digitado do item vale (as mesmas do resolver). */
export interface FlagsAprovacao {
    ted: boolean;
    destinoManual: boolean;
}

type ItemComAprovacao = Pick<
    ItemLote,
    'modalidade' | 'destinoManual' | 'destinoManualAprovadoPor' | 'destinoManualAprovadoEm'
>;

/**
 * DestinoAprovacaoRule — a ÚNICA regra de aprovação do destino digitado (ADR-0054 D10/D11),
 * usada pela API (selo), pelo `finalizarLote` e pelo envio.
 *
 * ```
 * conta (TED) digitada          → exige aprovação; aprovada = há linha APROVACAO da gravação vigente
 * chave PIX (CPF/CNPJ) digitada → não exige (D11: só o dono do documento registra a chave)
 * ```
 *
 * `bloqueia` responde se o item NÃO pode seguir: conta digitada que VALE (flag manual + flag TED,
 * modalidade TED — a mesma condição do `DestinoPagamentoResolver`) e ainda pendente. Com as flags
 * desligadas o destino digitado é ignorado, então nada bloqueia (paridade com o `main`).
 */
@injectable()
export default class DestinoAprovacaoRule {
    public exige = (destino: DestinoManual): boolean => destino.tipo === DESTINO_MANUAL_TIPO.CONTA;

    public estado = (item: ItemComAprovacao): DestinoAprovacao | undefined => {
        const destino = item.destinoManual;
        if (!destino) return undefined;
        if (!this.exige(destino)) return DESTINO_APROVACAO.NAO_EXIGIDA;
        return item.destinoManualAprovadoPor !== undefined
            ? DESTINO_APROVACAO.APROVADO
            : DESTINO_APROVACAO.PENDENTE;
    };

    public bloqueia = (item: ItemComAprovacao, flags: FlagsAprovacao): boolean =>
        flags.destinoManual &&
        flags.ted &&
        item.modalidade === MODALIDADE.TED &&
        this.estado(item) === DESTINO_APROVACAO.PENDENTE;
}
