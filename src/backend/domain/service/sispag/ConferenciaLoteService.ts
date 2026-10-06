import { inject, injectable } from 'tsyringe';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ReturnReasonRequiredError from '../../errors/ReturnReasonRequiredError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { LOTE_STATUS, type LotePagamento } from '../../interface/sispag/SispagInterface.js';
import ConferenciaLoteRule from '../../libs/sispag/ConferenciaLoteRule.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import LogService from '../LogService.js';
import LotePagamentoService from './LotePagamentoService.js';

export interface ConferenciaInput {
    loteId: string;
    versao: number;
    /** Username canônico AUTENTICADO (`req.user.sub`) — nunca do body. */
    ator: string;
}

/**
 * ConferenciaLoteService — conferência por 2ª pessoa do lote com TED/PIX (ADR-0063, I13l):
 *   L12 `conferirLote` (FINALIZADO → FINALIZADO, grava `conferidoPor/Em`);
 *   L13 `devolverLote` (FINALIZADO → RASCUNHO, motivo obrigatório, limpa conferência e finalização).
 * Padrão de 2ª pessoa do `ExcecaoDestinoService` (I12b): a permissão `sispag:conferir` é da rota; a
 * segregação de funções é regra do backend (`ConferenciaLoteRule`). Local, sem ERP.
 */
@injectable()
export default class ConferenciaLoteService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly repo: LotePagamentoRepository,
        @inject(ConferenciaLoteRule) private readonly rule: ConferenciaLoteRule,
        @inject(LotePagamentoService) private readonly lotes: LotePagamentoService,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public conferirLote = async (input: ConferenciaInput): Promise<LotePagamento> => {
        const lote = await this.exigirFinalizadoComTedPix(input.loteId, 'conferir');
        if (lote.conferidoPor) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'conferir',
                motivo: `Este lote já foi conferido por ${lote.conferidoPor}.`,
            });
        }
        this.rule.exigirOutraPessoa(lote, input.ator);
        const n = await this.repo.conferir({
            loteId: input.loteId,
            versaoEsperada: input.versao,
            ator: input.ator,
        });
        if (n === 0) await this.conflito(input, 'conferir');
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'SISPAG lote: conferido por segunda pessoa',
            data: { loteId: input.loteId, ator: input.ator },
        });
        return this.reler(input.loteId);
    };

    public devolverLote = async (
        input: ConferenciaInput & { motivo: string },
    ): Promise<LotePagamento> => {
        const motivo = input.motivo.trim();
        if (motivo === '') throw new ReturnReasonRequiredError({ loteId: input.loteId });
        const lote = await this.exigirFinalizadoComTedPix(input.loteId, 'devolver');
        this.rule.exigirOutraPessoa(lote, input.ator);
        const n = await this.repo.devolver({
            loteId: input.loteId,
            versaoEsperada: input.versao,
            ator: input.ator,
            motivo,
        });
        if (n === 0) await this.conflito(input, 'devolver');
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'SISPAG lote: devolvido pelo conferente',
            data: { loteId: input.loteId, ator: input.ator },
        });
        return this.reler(input.loteId);
    };

    private exigirFinalizadoComTedPix = async (
        loteId: string,
        acao: string,
    ): Promise<LotePagamento> => {
        const lote = await this.repo.getLoteComItens(loteId);
        if (!lote) {
            throw new LoteEstadoInvalidoError({
                loteId,
                statusAtual: 'inexistente',
                acao,
                motivo: 'Lote não encontrado.',
            });
        }
        if (lote.status !== LOTE_STATUS.FINALIZADO) {
            throw new LoteEstadoInvalidoError({
                loteId,
                statusAtual: lote.status,
                acao,
                motivo: 'Só um lote FINALIZADO é conferido ou devolvido.',
            });
        }
        if (!this.rule.exigeConferencia(lote)) {
            throw new LoteEstadoInvalidoError({
                loteId,
                statusAtual: lote.status,
                acao,
                motivo: 'Lote só de boleto não passa por conferência.',
            });
        }
        return lote;
    };

    /** Zero linhas: distingue conflito de versão de estado que mudou no meio (relendo). */
    private conflito = async (input: ConferenciaInput, acao: string): Promise<never> => {
        const atual = await this.repo.getLoteComItens(input.loteId);
        if (atual && atual.versao !== input.versao) {
            throw new LoteVersaoConflitoError({
                loteId: input.loteId,
                versaoEsperada: input.versao,
            });
        }
        throw new LoteEstadoInvalidoError({
            loteId: input.loteId,
            statusAtual: atual?.status ?? 'inexistente',
            acao,
        });
    };

    private reler = async (loteId: string): Promise<LotePagamento> => {
        const lote = await this.lotes.getLote(loteId);
        if (!lote) {
            throw new LoteEstadoInvalidoError({
                loteId,
                statusAtual: 'inexistente',
                acao: 'conferir',
                motivo: 'Lote não encontrado.',
            });
        }
        return lote;
    };
}
