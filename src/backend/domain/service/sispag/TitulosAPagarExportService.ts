import { inject, injectable } from 'tsyringe';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import Clock from '../../libs/clock/Clock.js';
import PlanilhaXlsxWriter from '../../libs/xlsx/PlanilhaXlsxWriter.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type {
    CelulaExport,
    ColunaExport,
    ContextoExport,
    PlanilhaExport,
} from '../../interface/sispag/RemessaTitulosExport.js';
import type { ChaveTitulo, TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';

const FMT_MOEDA = '#,##0.00';
const FMT_DATA = 'dd/mm/yyyy';
const DAY_MS = 24 * 60 * 60 * 1000;

const COLUNAS: ColunaExport[] = [
    { header: 'Filial', key: 'filial', width: 7 },
    { header: 'Credor', key: 'credor', width: 36 },
    { header: 'Documento', key: 'documento', width: 26 },
    { header: 'Valor', key: 'valor', width: 14, numFmt: FMT_MOEDA },
    { header: 'Moeda', key: 'moeda', width: 7 },
    { header: 'Vencimento', key: 'vencimento', width: 12, numFmt: FMT_DATA },
    { header: 'Dias p/ vencer', key: 'diasParaVencer', width: 13 },
    { header: 'Boleto DDA', key: 'boleto', width: 11 },
    { header: 'Aprovação', key: 'aprovacao', width: 11 },
    { header: 'Pronto p/ remessa', key: 'prontoParaRemessa', width: 16 },
    { header: 'Lote', key: 'lote', width: 22 },
    { header: 'Banco', key: 'banco', width: 18 },
];

/** O que a carteira sabe do lote de um título: rascunho (ADR-0050) ou comprometido (ADR-0064). */
interface LoteDoTitulo {
    rotulo: string;
}

const chaveDe = (t: ChaveTitulo): string => `${t.filCod}:${t.docCod}:${t.titCod}`;

const simNao = (v?: boolean): string | null => (v === undefined ? null : v ? 'Sim' : 'Não');

/**
 * TitulosAPagarExportService — planilha (.xlsx) dos títulos a pagar que a aba "Títulos a pagar"
 * mostra com o filtro atual. A tela manda as chaves; os valores vêm da carteira persistida
 * (`titulo_a_pagar` ativa, sem os pagos — o mesmo recorte do painel) e dos lotes locais. READ-ONLY,
 * sem Conexos. Chave que não está mais na carteira é ignorada e contada no log.
 */
@injectable()
export default class TitulosAPagarExportService {
    public constructor(
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(LogService) private readonly logService: LogService,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(PlanilhaXlsxWriter) private readonly writer: PlanilhaXlsxWriter,
        @inject(Clock) private readonly clock: Clock,
    ) {}

    /** Monta e serializa a planilha; o log diz quem exportou, quanto e em quanto tempo. */
    public exportar = async (
        chaves: ChaveTitulo[],
        contexto: ContextoExport,
    ): Promise<{ filename: string; buffer: Buffer }> => {
        const inicio = this.clock.now();
        const { ignorados, ...planilha } = await this.montar(chaves);
        const buffer = await this.writer.serializar(planilha);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'títulos a pagar exportados',
            data: {
                ...contexto,
                pedidos: chaves.length,
                titulos: planilha.linhas.length,
                ignorados,
                durationMs: this.clock.now() - inicio,
            },
        });
        return { filename: `sispag-titulos-a-pagar-${this.calendar.todayBrt()}.xlsx`, buffer };
    };

    /** Projeta os títulos pedidos na planilha, na ordem pedida (a da tela), + linha de totais. */
    public montar = async (
        chaves: ChaveTitulo[],
    ): Promise<PlanilhaExport & { ignorados: number }> => {
        const [ativos, emRascunho, comprometidos] = await Promise.all([
            this.tituloRepo.listAtivos(),
            this.loteRepo.listTitulosEmRascunho(),
            this.loteRepo.listTitulosEmLotesComprometidos(),
        ]);
        const carteira = new Map(ativos.filter((t) => !t.pago).map((t) => [chaveDe(t), t]));
        const loteDe = new Map<string, LoteDoTitulo>();
        for (const t of emRascunho) {
            loteDe.set(chaveDe(t), {
                rotulo: t.automatico ? 'Rascunho (automático)' : 'Rascunho (manual)',
            });
        }
        // Comprometido vence o rascunho; a query vem do mais antigo ao mais recente.
        for (const t of comprometidos) {
            loteDe.set(chaveDe(t), {
                rotulo: t.status === 'FINALIZADO' ? 'Finalizado' : 'Remessa gerada',
            });
        }

        const vistos = new Set<string>();
        const titulos: TituloAPagar[] = [];
        for (const c of chaves) {
            const k = chaveDe(c);
            const t = carteira.get(k);
            if (!t || vistos.has(k)) continue;
            vistos.add(k);
            titulos.push(t);
        }

        const hoje = this.calendar.toErpEpoch(this.calendar.todayBrt());
        const linhas = titulos.map((t) => this.linha(t, loteDe.get(chaveDe(t)), hoje));
        const centavos = titulos.reduce((acc, t) => acc + Math.round(t.valor * 100), 0);
        return {
            titulo: 'Títulos a pagar',
            colunas: COLUNAS,
            linhas,
            totais: {
                filial: 'TOTAL',
                documento: `${linhas.length} título(s)`,
                valor: centavos / 100,
            },
            ignorados: chaves.length - titulos.length,
        };
    };

    private linha = (
        t: TituloAPagar,
        lote: LoteDoTitulo | undefined,
        hoje: number,
    ): Record<string, CelulaExport> => {
        // Dia do ERP pelo relógio UTC (o ERP grava 15:00Z do dia pretendido).
        const dia = t.vencimento !== undefined ? this.calendar.fromErpEpoch(t.vencimento) : null;
        const vencimento = dia ? new Date(this.calendar.toErpEpoch(dia)) : null;
        return {
            filial: t.filCod,
            credor: t.credor ?? null,
            documento: `${t.docCod}/${t.titCod}`,
            valor: t.valor,
            moeda: t.moeda ?? null,
            vencimento,
            diasParaVencer: vencimento ? Math.round((vencimento.getTime() - hoje) / DAY_MS) : null,
            boleto: t.temBoleto ? 'Sim' : 'Não',
            aprovacao: t.liberado ? 'Aprovado' : 'Bloqueado',
            prontoParaRemessa: simNao(t.prontoParaRemessa),
            lote: lote?.rotulo ?? null,
            banco: t.banco ?? null,
        };
    };
}
