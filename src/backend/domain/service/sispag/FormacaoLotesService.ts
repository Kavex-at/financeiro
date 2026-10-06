import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import {
    type FormacaoLotesResult,
    MODALIDADE,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import ContaPagadoraResolver, { type ContaPagadoraEscolhida } from './ContaPagadoraResolver.js';

/** Horizonte da formação automática: só títulos a vencer nos próximos N dias. */
const HORIZONTE_DIAS = 7;
/** Advisory lock EXCLUSIVO da formação (≠ ingestão 726354819, ≠ permutas). */
export const FORMACAO_LOCK_KEY = 615243789;

/**
 * FormacaoLotesService — cron pós-ingestão que MONTA lotes candidatos automaticamente.
 *
 * Regras (as mesmas da montagem manual): mesma filial (I4), SÓ títulos A VENCER
 * (≤7d; vencidos NÃO entram). Agrupa por FILIAL × DIA DE VENCIMENTO (ADR-0064). Cada run: (1) DESFAZ lotes automáticos que já têm título
 * vencido (libera os títulos); (2) forma lotes novos com os elegíveis ainda sem lote.
 * Os lotes nascem RASCUNHO e caem em "Lotes candidatos" para o analista revisar antes
 * de aprovar. NÃO toca em lotes manuais nem finalizados. Escreve só no Postgres (I1).
 */
@injectable()
export default class FormacaoLotesService {
    public constructor(
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(ContaPagadoraResolver) private readonly contaResolver: ContaPagadoraResolver,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
    ) {}

    public formar = async (input: { triggeredBy: string }): Promise<FormacaoLotesResult> =>
        this.db.withAdvisoryLock(
            FORMACAO_LOCK_KEY,
            () => this.run(input),
            async () => {
                throw new IngestLockBusyError('lot formation already in progress');
            },
        );

    private run = async (input: { triggeredBy: string }): Promise<FormacaoLotesResult> => {
        // 1) desfaz lotes automáticos RASCUNHO com título vencido (libera os títulos).
        const lotesDesfeitos = await this.loteRepo.desfazerAutomaticosVencidos();

        // 2) forma lotes novos com os elegíveis (a vencer ≤7d, não lotados). Cada grupo
        // (filial × vencimento) vira no máx. dois lotes: boletos e o resto, nunca misturados.
        const elegiveis = await this.tituloRepo.listElegiveisParaFormacao(HORIZONTE_DIAS);
        const grupos = this.agrupar(elegiveis);
        let lotesFormados = 0;
        let titulosLotados = 0;
        // Conta pagadora resolvida UMA vez por filial na rodada (G-13): lê o fin005 da filial,
        // não grava uma conta fixa.
        const contaPorFilial = new Map<number, ContaPagadoraEscolhida | undefined>();
        for (const titulos of grupos.values()) {
            for (const fatia of this.separarBoletos(titulos)) {
                if (fatia.length === 0) continue;
                const filCod = fatia[0].filCod;
                if (!contaPorFilial.has(filCod)) {
                    contaPorFilial.set(filCod, await this.contaResolver.resolverPadrao(filCod));
                }
                await this.montarGrupo(fatia, input.triggeredBy, contaPorFilial.get(filCod));
                lotesFormados += 1;
                titulosLotados += fatia.length;
            }
        }

        const result: FormacaoLotesResult = { lotesFormados, titulosLotados, lotesDesfeitos };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'automatic lot formation completed',
            data: { ...result, triggeredBy: input.triggeredBy },
        });
        return result;
    };

    /** Um lote por grupo, numa transação (raiz + itens). */
    private montarGrupo = async (
        titulos: TituloAPagar[],
        ator: string,
        conta: ContaPagadoraEscolhida | undefined,
    ): Promise<void> => {
        const primeiro = titulos[0];
        await this.db.withTransaction(async (tx) => {
            const lote = await this.loteRepo.criarLote(
                {
                    filCod: primeiro.filCod,
                    // G-13: conta que a filial tem no fin005; sem ela o lote nasce sem conta e a
                    // analista escolhe (o finalizar recusa lote sem conta pagadora).
                    ...(conta ? { banco: conta.banco, conta: conta.conta } : {}),
                    automatico: true,
                    criadoPor: ator,
                },
                tx,
            );
            await this.loteRepo.adicionarItens(
                lote.id,
                titulos.map((t) => ({
                    filCod: t.filCod,
                    docCod: t.docCod,
                    titCod: t.titCod,
                    credor: t.credor,
                    valor: t.valor,
                    vencimento: t.vencimento,
                    // A2: boleto auto-detectado (código de barras); senão "a definir".
                    modalidade: t.temBoleto ? MODALIDADE.BOLETO : undefined,
                    incluidoPor: ator,
                })),
                tx,
            );
            await this.loteRepo.tocarLote(lote.id, tx);
        });
    };

    /**
     * Chave de grupo: FILIAL × DIA DE VENCIMENTO (ADR-0064 — um lote por filial por data; I4
     * segue garantida porque a filial está na chave). O dia é o civil UTC do epoch do ERP
     * (`fromErpEpoch`), a mesma regra da janela de débito. Internacional saiu do escopo
     * (ADR-0021). A conta pagadora é a da filial no fin005 e o banco do favorecido é buscado ao
     * vivo só na remessa (anti-drift), não na montagem.
     */
    private agrupar = (titulos: TituloAPagar[]): Map<string, TituloAPagar[]> => {
        const grupos = new Map<string, TituloAPagar[]>();
        for (const t of titulos) {
            const dia =
                t.vencimento !== undefined ? this.calendar.fromErpEpoch(t.vencimento) : 'sem-venc';
            const key = `${t.filCod}:${dia}`;
            const atual = grupos.get(key);
            if (atual) atual.push(t);
            else grupos.set(key, [t]);
        }
        return grupos;
    };

    /**
     * Separa o grupo em BOLETOS (`temBoleto`) e o RESTO (ADR-0064): no máximo dois lotes, nunca
     * mistos, sem teto de quantidade. O teto de 25 era nosso (revisão humana), não do Conexos/CNAB.
     * Lote só de boletos também não passa pela conferência TED/PIX (ADR-0063).
     */
    private separarBoletos = (titulos: TituloAPagar[]): TituloAPagar[][] =>
        [
            titulos.filter((t) => t.temBoleto === true),
            titulos.filter((t) => t.temBoleto !== true),
        ].filter((parte) => parte.length > 0);
}
