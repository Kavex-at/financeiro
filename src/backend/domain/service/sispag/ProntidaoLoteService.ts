import { inject, injectable } from 'tsyringe';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { LOTE_STATUS, type LotePagamento } from '../../interface/sispag/SispagInterface.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import LogService from '../LogService.js';
import ProntidaoLoteResolver from './ProntidaoLoteResolver.js';
import SituacaoPagamentoService from './SituacaoPagamentoService.js';

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/**
 * ProntidaoLoteService (ADR-0076, I20a): anexa `prontidao` a cada lote RASCUNHO da listagem. Lê só
 * o Postgres (carteira gravada, contexto da situação, ledger de ajuste), nunca o Conexos: a lista
 * com 40 lotes continua rápida e a finalização é quem relê ao vivo.
 */
@injectable()
export default class ProntidaoLoteService {
    public constructor(
        @inject(ProntidaoLoteResolver) private readonly resolver: ProntidaoLoteResolver,
        @inject(SituacaoPagamentoService) private readonly situacao: SituacaoPagamentoService,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /**
     * Uma falha ao montar o contexto não derruba a listagem: os lotes saem sem `prontidao` (a tela
     * não os conta como prontos) e fica um WARN.
     */
    public comProntidao = async (lotes: LotePagamento[]): Promise<LotePagamento[]> => {
        const rascunhos = lotes.filter((l) => l.status === LOTE_STATUS.RASCUNHO);
        if (rascunhos.length === 0) return lotes;
        try {
            const chaves = rascunhos.flatMap((l) =>
                l.itens.map((i) => ({ filCod: i.filCod, docCod: i.docCod, titCod: i.titCod })),
            );
            const [{ situacoes, fontesIndisponiveis }, emAjuste] = await Promise.all([
                this.situacao.avaliarGravados(chaves),
                this.loteRepo.titulosComAjusteNaoTerminalNosLotes(rascunhos.map((l) => l.id)),
            ]);
            const ajustePorLote = new Map<string, Set<string>>();
            for (const a of emAjuste) {
                const lista = ajustePorLote.get(a.loteId) ?? new Set<string>();
                lista.add(chaveDe(a));
                ajustePorLote.set(a.loteId, lista);
            }
            return lotes.map((l) =>
                l.status === LOTE_STATUS.RASCUNHO
                    ? {
                          ...l,
                          prontidao: this.resolver.avaliar(l, {
                              situacoes,
                              fontesIndisponiveis,
                              emAjuste: ajustePorLote.get(l.id) ?? new Set(),
                          }),
                      }
                    : l,
            );
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'prontidão dos lotes indisponível: listagem segue sem ela',
                data: { erro: error instanceof Error ? error.message : String(error) },
            });
            return lotes;
        }
    };
}
