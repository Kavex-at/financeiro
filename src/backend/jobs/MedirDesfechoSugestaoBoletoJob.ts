import { inject, injectable } from 'tsyringe';
import { DECISAO_SUGESTAO_BOLETO } from '../domain/interface/sispag/ConfirmacaoEmissorBoleto.js';
import { PAGO_POR_CONEXOS } from '../domain/interface/sispag/PagoPorConexos.js';
import type { TituloAPagar } from '../domain/interface/sispag/SispagInterface.js';
import type {
    DesfechoTitulo,
    SugestaoBoletoTitulo,
} from '../domain/interface/sispag/SugestaoBoleto.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import BoletoDdaRepository from '../domain/repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../domain/repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import MotorSugestaoBoleto from '../domain/service/sispag/MotorSugestaoBoleto.js';

/** Alvo declarado do banco (flag `--alvo=`). O job aborta se a conexão não for do alvo. */
export const ALVO_MEDICAO = { PRD: 'prd', LOCAL: 'local' } as const;
export type AlvoMedicao = (typeof ALVO_MEDICAO)[keyof typeof ALVO_MEDICAO];

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

export interface ResultadoMedicaoDesfecho {
    /** Instante e data civil (BRT) da execução. */
    executadoEm: string;
    dataCivil: string;
    /** epoch ms da última sincronização do pool DDA (para comparar antes × depois). */
    sincronizadoEm?: number;
    titulosAtivos: number;
    boletosNoPool: number;
    /** Títulos BOLETO, ativos, não pagos, `tem_boleto != true`, com vencimento. */
    elegiveis: number;
    comLinha: number;
    semLinha: number;
    /** Contagem por resultado do motor (CONHECIDO/FORTE/ATENCAO/VENCIDO_INFORMATIVO/CONFIRMADA/ORFA). */
    porResultado: Record<string, number>;
    elegiveisPorFilial: Record<string, number>;
    semLinhaPorFilial: Record<string, number>;
    /** Chaves `fil:doc:tit` sem linha (nunca barras nem linha digitável). */
    chavesSemLinha: string[];
    /**
     * Motor NOVO (ADR-0072, Task 16) sobre o MESMO snapshot: contagem por situação do título.
     * `semDesfecho` é o nº de títulos elegíveis sem desfecho (esperado 0).
     */
    porSituacao: Record<string, number>;
    semDesfecho: number;
    desfechos: number;
    /** Participação de `SO_FRACA` entre os elegíveis (0–1), para o limiar de ruído da Task 16. */
    participacaoSoFraca: number;
    porSituacaoPorFilial: Record<string, Record<string, number>>;
    /** `chaves` dos elegíveis sem desfecho. */
    chavesSemDesfecho: string[];
}

const chaveTitulo = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/**
 * Medição SOMENTE LEITURA do desfecho da sugestão por título (Tasks 1 e 16, ADR-0072). Só `SELECT`
 * pelos repositórios existentes + o motor PURO. Nunca resolve client do ERP nem `LogService`.
 */
@injectable()
export default class MedirDesfechoSugestaoBoletoJob {
    public constructor(
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(BoletoDdaRepository) private readonly boletoRepo: BoletoDdaRepository,
        @inject(SugestaoBoletoRepository) private readonly decisaoRepo: SugestaoBoletoRepository,
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(MotorSugestaoBoleto) private readonly motor: MotorSugestaoBoleto,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
    ) {}

    /** `local` só para host de loopback; qualquer outro host é `prd`. */
    public static classificarAlvo = (connectionString: string): AlvoMedicao => {
        try {
            const host = new URL(connectionString).hostname.toLowerCase();
            return HOSTS_LOCAIS.has(host) ? ALVO_MEDICAO.LOCAL : ALVO_MEDICAO.PRD;
        } catch {
            return ALVO_MEDICAO.PRD;
        }
    };

    public executar = async (): Promise<ResultadoMedicaoDesfecho> => {
        const [titulos, boletos, pares, rejeitadas, confirmadas, emLotes, sincronizadoEm] =
            await Promise.all([
                this.tituloRepo.listAtivos(),
                this.boletoRepo.listBoletos({}),
                this.decisaoRepo.listarParesVigentes(),
                this.decisaoRepo.listarChaveadas(DECISAO_SUGESTAO_BOLETO.REJEITADA),
                this.decisaoRepo.listarChaveadas(DECISAO_SUGESTAO_BOLETO.CONFIRMADA),
                this.loteRepo.listTitulosEmLotesAbertos(),
                this.boletoRepo.ultimaSincronizacao(),
            ]);
        const datasDebito = new Map<string, string>();
        const vistos = new Set<string>();
        for (const item of emLotes) {
            const k = chaveTitulo(item);
            if (vistos.has(k)) continue;
            vistos.add(k);
            if (item.dataDebito) datasDebito.set(k, item.dataDebito);
        }
        const { sugestoes, desfechos } = this.motor.analisar({
            titulos,
            boletos,
            paresVigentes: pares.map((p) => ({ pesCod: p.pesCod, emissorChave: p.emissorChave })),
            rejeitadas,
            confirmadas,
            datasDebito,
        });
        return this.resumir({
            titulos,
            boletos: boletos.length,
            sugestoes,
            desfechos,
            sincronizadoEm,
        });
    };

    private resumir = (a: {
        titulos: TituloAPagar[];
        boletos: number;
        sugestoes: SugestaoBoletoTitulo[];
        desfechos: DesfechoTitulo[];
        sincronizadoEm: number | undefined;
    }): ResultadoMedicaoDesfecho => {
        const elegiveis = a.titulos.filter(this.elegivel);
        const comLinha = new Set(a.sugestoes.map(chaveTitulo));
        const porResultado: Record<string, number> = {};
        for (const s of a.sugestoes) {
            const r = s.orfa
                ? 'ORFA'
                : s.estado === 'CONFIRMADA'
                  ? 'CONFIRMADA'
                  : s.avaliacao.resultado;
            porResultado[r] = (porResultado[r] ?? 0) + 1;
        }
        const elegiveisPorFilial: Record<string, number> = {};
        const semLinhaPorFilial: Record<string, number> = {};
        const chavesSemLinha: string[] = [];
        for (const t of elegiveis) {
            const f = String(t.filCod);
            elegiveisPorFilial[f] = (elegiveisPorFilial[f] ?? 0) + 1;
            if (!comLinha.has(chaveTitulo(t))) {
                semLinhaPorFilial[f] = (semLinhaPorFilial[f] ?? 0) + 1;
                chavesSemLinha.push(chaveTitulo(t));
            }
        }
        const semLinha = chavesSemLinha.length;
        const comDesfecho = new Set(a.desfechos.map(chaveTitulo));
        const chavesSemDesfecho = elegiveis
            .map(chaveTitulo)
            .filter((k) => !comDesfecho.has(k))
            .sort();
        const porSituacao: Record<string, number> = {};
        const porSituacaoPorFilial: Record<string, Record<string, number>> = {};
        const chavesElegiveis = new Set(elegiveis.map(chaveTitulo));
        for (const d of a.desfechos) {
            if (!chavesElegiveis.has(chaveTitulo(d))) continue;
            porSituacao[d.situacao] = (porSituacao[d.situacao] ?? 0) + 1;
            const f = String(d.filCod);
            const dessa = porSituacaoPorFilial[f] ?? {};
            dessa[d.situacao] = (dessa[d.situacao] ?? 0) + 1;
            porSituacaoPorFilial[f] = dessa;
        }
        return {
            executadoEm: this.calendar.now().toISOString(),
            dataCivil: this.calendar.todayBrt(),
            ...(a.sincronizadoEm != null ? { sincronizadoEm: a.sincronizadoEm } : {}),
            titulosAtivos: a.titulos.length,
            boletosNoPool: a.boletos,
            elegiveis: elegiveis.length,
            comLinha: elegiveis.length - semLinha,
            semLinha,
            porResultado,
            elegiveisPorFilial,
            semLinhaPorFilial,
            chavesSemLinha: chavesSemLinha.sort(),
            porSituacao,
            semDesfecho: chavesSemDesfecho.length,
            desfechos: a.desfechos.length,
            participacaoSoFraca:
                elegiveis.length === 0 ? 0 : (porSituacao.SO_FRACA ?? 0) / elegiveis.length,
            porSituacaoPorFilial,
            chavesSemDesfecho,
        };
    };

    private elegivel = (t: TituloAPagar): boolean =>
        !t.pago &&
        t.ativo !== false &&
        t.temBoleto !== true &&
        t.formaPagamentoConexos === PAGO_POR_CONEXOS.BOLETO &&
        t.vencimento != null;
}
