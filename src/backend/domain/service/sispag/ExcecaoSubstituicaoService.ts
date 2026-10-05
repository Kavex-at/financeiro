import { inject, injectable } from 'tsyringe';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import {
    type ChavePixFavorecido,
    type ContaFavorecido,
    DESTINO_MANUAL_TIPO,
    EXCECAO_ESTADO,
    EXCECAO_EVENTO,
    type ExcecaoDestino,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import { redactErrorMessage } from '../../libs/redact/redactErrorMessage.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';

/** O cadastro `cmn025` do favorecido, lido ao vivo: só o que o tipo da exceção compara. */
export interface CadastroDoFavorecido {
    contas?: ContaFavorecido[];
    chaves?: ChavePixFavorecido[];
}

export interface ResultadoSubstituicao {
    /** `false` = outra execução já tinha aposentado (idempotente). */
    aposentada: boolean;
    divergiu: boolean;
}

const soDigitos = (v: string | undefined): string => (v ?? '').replace(/\D/g, '');

/** Ator das transições automáticas (não há usuário: é o sistema que aposenta). */
export const ATOR_SISTEMA = 'sistema';

/**
 * ExcecaoSubstituicaoService — aposenta a exceção `APROVADA` quando o cadastro do Conexos passou a
 * ter destino válido (ADR-0061, I12c). Usado pelo resolver (ao resolver no finalizar/envio) e
 * pelo job `aposentar-excecoes-substituidas`: UMA só implementação, para as duas vias nunca
 * discordarem.
 *
 * - `APROVADA → SUBSTITUIDA` automático, com a trilha; a exceção NUNCA é usada (o cadastro vence).
 * - Se o valor do cadastro DIFERE da exceção: evento `DIVERGENCIA_CADASTRO` na trilha (valores só
 *   mascarados, I10h) e `Alerta` `sispag-excecao-divergencia` para revisão. Igual: só a
 *   substituição.
 * - Idempotente: outra execução que chegou antes faz a transição devolver estado inválido, e isso
 *   é "já aposentada", não erro.
 * - O alerta é best-effort (I5): falha na notificação não desfaz a aposentadoria.
 */
@injectable()
export default class ExcecaoSubstituicaoService {
    public constructor(
        @inject(ExcecaoDestinoRepository) private readonly repo: ExcecaoDestinoRepository,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(MaskDestino) private readonly mask: MaskDestino,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public aposentar = async (params: {
        excecao: ExcecaoDestino;
        cadastro: CadastroDoFavorecido;
        ator?: string;
    }): Promise<ResultadoSubstituicao> => {
        const { excecao, cadastro } = params;
        const ator = params.ator ?? ATOR_SISTEMA;
        const divergiu = this.diverge(excecao, cadastro);
        try {
            await this.repo.transition({
                id: excecao.id,
                de: EXCECAO_ESTADO.APROVADA,
                para: EXCECAO_ESTADO.SUBSTITUIDA,
                evento: EXCECAO_EVENTO.SUBSTITUICAO,
                ator,
                depois: { substituidaPorCadastro: true, divergiu },
            });
        } catch (error) {
            if (error instanceof ExcecaoEstadoInvalidoError) {
                return { aposentada: false, divergiu: false };
            }
            throw error;
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message:
                'exceção de destino aposentada: o cadastro do Conexos passou a ter destino válido',
            data: {
                excecaoId: excecao.id,
                pesCod: excecao.pesCod,
                tipo: excecao.destino.tipo,
                divergiu,
            },
        });
        if (divergiu) await this.registrarDivergencia(excecao, cadastro, ator);
        return { aposentada: true, divergiu };
    };

    /** Divergência = NENHUM destino ativo do cadastro é igual ao da exceção (por tipo). */
    private diverge = (excecao: ExcecaoDestino, cadastro: CadastroDoFavorecido): boolean => {
        const d = excecao.destino;
        if (d.tipo === DESTINO_MANUAL_TIPO.CONTA) {
            return !(cadastro.contas ?? []).some(
                (c) =>
                    soDigitos(String(c.banco)).padStart(3, '0') === d.bancoCod &&
                    soDigitos(c.agencia) === soDigitos(d.agencia) &&
                    soDigitos(c.conta) === soDigitos(d.conta) &&
                    soDigitos(c.dvConta) === soDigitos(d.contaDv),
            );
        }
        return !(cadastro.chaves ?? []).some((c) => soDigitos(c.chave) === soDigitos(d.chavePix));
    };

    private registrarDivergencia = async (
        excecao: ExcecaoDestino,
        cadastro: CadastroDoFavorecido,
        ator: string,
    ): Promise<void> => {
        try {
            await this.repo.appendAudit({
                excecaoId: excecao.id,
                evento: EXCECAO_EVENTO.DIVERGENCIA_CADASTRO,
                ator,
                depois: {
                    excecao: this.mask.destinoManual(excecao.destino),
                    cadastro: [
                        ...(cadastro.contas ?? []).map(this.mask.contaFavorecido),
                        ...(cadastro.chaves ?? []).map((c) =>
                            this.mask.chavePixRotulada(c.tipo, c.chave),
                        ),
                    ],
                },
            });
        } catch (error) {
            // A exceção já está SUBSTITUIDA: perder a trilha da divergência não pode perder o alerta.
            await this.logService
                .warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'trilha da divergência da exceção de destino não foi gravada',
                    data: {
                        excecaoId: excecao.id,
                        erro: redactErrorMessage(
                            error instanceof Error ? error.message : String(error),
                        ),
                    },
                })
                .catch(() => undefined);
        }
        try {
            await this.notificacao.emitir({
                tipo: ALERTA_TIPO.SISPAG_EXCECAO_DIVERGENCIA,
                alvo: `excecao:${excecao.id}`,
                severidade: ALERTA_SEVERIDADE.AVISO,
                janelaInicio: new Date(excecao.cadastradoEm),
                detalhe: {
                    excecaoId: excecao.id,
                    pesCod: excecao.pesCod,
                    tipo: excecao.destino.tipo,
                },
            });
        } catch (error) {
            await this.logService
                .warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'alerta de divergência da exceção de destino não foi emitido',
                    data: {
                        excecaoId: excecao.id,
                        erro: redactErrorMessage(
                            error instanceof Error ? error.message : String(error),
                        ),
                    },
                })
                .catch(() => undefined);
        }
    };
}
