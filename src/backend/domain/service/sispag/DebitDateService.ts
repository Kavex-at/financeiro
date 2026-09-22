import { inject, injectable } from 'tsyringe';
import DebitDateOutsideWindowError, {
    MOTIVO_FORA_DA_JANELA,
} from '../../errors/DebitDateOutsideWindowError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import {
    type ItemLote,
    type JanelaDataDebito,
    LOTE_STATUS,
    type LotePagamento,
    type TituloLimitante,
} from '../../interface/sispag/SispagInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';

/**
 * DebitDateService — janela da data de débito de um lote SISPAG (I8, ADR-0049).
 *
 *   janela(lote) = [ hoje_BRT , min(vencimento dos itens) ] ∩ diasUteisBancarios
 *
 * - Limite inferior = R1 do ERP (débito ≥ hoje). "Hoje" é Brasília, nunca meia-noite UTC.
 * - Limite superior = R2 do ERP (nenhum título vence antes do débito). Usa o snapshot
 *   `ItemLote.vencimento` — o mesmo dado de onde sai o `itsDtaPgto` no import. Se o vencimento
 *   mudou no ERP depois da inclusão, quem decide é o `finalizarLote` (fail-closed).
 * - O dia civil de um vencimento é o dia UTC (`fromErpEpoch`): o ERP grava 00:00Z/15:00Z do dia
 *   pretendido, e converter para BRT encolheria a janela em um dia.
 * - Na dúvida, fecha: item sem vencimento torna a janela vazia.
 *
 * Fonte única do calendário: a rota expõe a janela já recortada e a tela só exibe.
 */
@injectable()
export default class DebitDateService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
    ) {}

    /** Janela de um lote FINALIZADO — o que a tela mostra ao abrir "Gerar remessa". */
    public getWindow = async (loteId: string): Promise<JanelaDataDebito> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote) {
            throw new LoteEstadoInvalidoError({
                loteId,
                statusAtual: 'INEXISTENTE',
                acao: 'gerar remessa',
            });
        }
        if (lote.status !== LOTE_STATUS.FINALIZADO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'gerar remessa',
                motivo: 'Só um lote FINALIZADO pode virar remessa. Finalize o lote antes.',
            });
        }
        return this.computeWindow(lote);
    };

    /** Janela calculada sobre um lote já carregado. Não lê nada e não escreve nada. */
    public computeWindow = (lote: LotePagamento): JanelaDataDebito => {
        const hoje = this.calendar.todayBrt();
        const congelada = this.congelada(lote, hoje);
        const base = { hoje, naoUteis: [] as string[], ...(congelada ? { congelada } : {}) };

        const semVencimento = lote.itens.find((i) => i.vencimento === undefined);
        if (semVencimento) {
            return {
                ...base,
                limitante: this.limitante(semVencimento),
                vazia: { motivo: MOTIVO_FORA_DA_JANELA.TITULO_SEM_VENCIMENTO },
            };
        }
        const maisCedo = this.itemMaisCedo(lote.itens);
        if (!maisCedo) {
            // Lote sem itens: quem barra é o gate de estado do `gerarRemessa`; aqui não há
            // limite superior a respeitar, então a janela também não existe.
            return { ...base, vazia: { motivo: MOTIVO_FORA_DA_JANELA.TITULO_SEM_VENCIMENTO } };
        }
        const limitante = this.limitante(maisCedo.item);
        const menorVencimento = maisCedo.civil;

        if (menorVencimento < hoje) {
            return { ...base, limitante, vazia: { motivo: MOTIVO_FORA_DA_JANELA.TITULO_VENCIDO } };
        }
        const min = this.calendar.isBusinessDay(hoje) ? hoje : this.calendar.nextBusinessDay(hoje);
        if (min > menorVencimento) {
            return { ...base, limitante, vazia: { motivo: MOTIVO_FORA_DA_JANELA.SEM_DIA_UTIL } };
        }
        let max = menorVencimento;
        while (!this.calendar.isBusinessDay(max)) max = this.calendar.addDays(max, -1);

        const naoUteis: string[] = [];
        for (let d = min; d <= max; d = this.calendar.addDays(d, 1)) {
            if (!this.calendar.isBusinessDay(d)) naoUteis.push(d);
        }
        const amanha = this.calendar.nextBusinessDay(hoje);
        return {
            ...base,
            naoUteis,
            min,
            max,
            sugerida: min,
            ...(amanha <= max ? { amanha } : {}),
            limitante,
        };
    };

    /**
     * I8a — `dataDebito` pertence à janela? Devolve a própria data; senão lança
     * `DebitDateOutsideWindowError`. Chamado ANTES de qualquer escrita.
     */
    public validate = (lote: LotePagamento, dataDebito: string): string => {
        const w = this.computeWindow(lote);
        if (w.vazia) {
            throw new DebitDateOutsideWindowError({
                dataDebito,
                motivo: w.vazia.motivo,
                ...(w.limitante ? { limitante: w.limitante } : {}),
            });
        }
        const detalhe = {
            dataDebito,
            ...(w.min !== undefined ? { min: w.min } : {}),
            ...(w.max !== undefined ? { max: w.max } : {}),
            ...(w.limitante ? { limitante: w.limitante } : {}),
        };
        if (dataDebito < w.hoje) {
            throw new DebitDateOutsideWindowError({
                ...detalhe,
                motivo: MOTIVO_FORA_DA_JANELA.ANTES_DE_HOJE,
            });
        }
        const menorVencimento = w.limitante?.vencimento;
        if (menorVencimento !== undefined && dataDebito > menorVencimento) {
            throw new DebitDateOutsideWindowError({
                ...detalhe,
                motivo: MOTIVO_FORA_DA_JANELA.DEPOIS_DO_VENCIMENTO,
            });
        }
        // Entre hoje e o vencimento só sobra o que não é dia útil (inclusive o intervalo
        // [hoje, min) quando hoje é fim de semana, e (max, vencimento] quando ele cai num).
        if (!this.calendar.isBusinessDay(dataDebito)) {
            throw new DebitDateOutsideWindowError({
                ...detalhe,
                motivo: MOTIVO_FORA_DA_JANELA.NAO_UTIL,
            });
        }
        return dataDebito;
    };

    /** A data pedida, validada; sem pedido, o primeiro dia útil da janela. */
    public resolve = (lote: LotePagamento, dataDebito?: string): string => {
        if (dataDebito !== undefined) return this.validate(lote, dataDebito);
        const w = this.computeWindow(lote);
        if (w.vazia || w.sugerida === undefined) {
            throw new DebitDateOutsideWindowError({
                motivo: w.vazia?.motivo ?? MOTIVO_FORA_DA_JANELA.SEM_DIA_UTIL,
                ...(w.limitante ? { limitante: w.limitante } : {}),
            });
        }
        return w.sugerida;
    };

    private congelada = (
        lote: LotePagamento,
        hoje: string,
    ): JanelaDataDebito['congelada'] | undefined => {
        if (lote.nativeFlpCod === undefined || lote.dataDebito === undefined) return undefined;
        return {
            data: lote.dataDebito,
            nativeFlpCod: lote.nativeFlpCod,
            motivo: lote.dataDebito < hoje ? 'no_passado' : 'lote_nativo_criado',
        };
    };

    private itemMaisCedo = (itens: ItemLote[]): { item: ItemLote; civil: string } | undefined => {
        let melhor: { item: ItemLote; civil: string } | undefined;
        for (const item of itens) {
            if (item.vencimento === undefined) continue;
            const civil = this.calendar.fromErpEpoch(item.vencimento);
            if (!melhor || civil < melhor.civil) melhor = { item, civil };
        }
        return melhor;
    };

    private limitante = (item: ItemLote): TituloLimitante => ({
        itemId: `${item.filCod}:${item.docCod}:${item.titCod}`,
        ...(item.credor ? { credor: item.credor } : {}),
        documento: `${item.docCod}/${item.titCod}`,
        ...(item.vencimento !== undefined
            ? { vencimento: this.calendar.fromErpEpoch(item.vencimento) }
            : {}),
    });
}
