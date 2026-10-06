import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    DESTINO_MANUAL_TIPO,
    type PendenciaCadastro,
} from '../../interface/sispag/SispagInterface.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import PendenciaCadastroRepository from '../../repository/sispag/PendenciaCadastroRepository.js';
import LogService from '../LogService.js';

/** Leituras simultâneas do cadastro na reconferência da fila (mesmo teto do painel). */
const CONEXOS_FANOUT_LIMIT = 4;

/** Resultado da reconferência de UMA pendência. */
type Reconferencia = 'RESOLVIDA' | 'ABERTA' | 'INDISPONIVEL';

/**
 * PendenciaCadastroService — a fila "Pendências de cadastro" (ADR-0063, I13k), para quem tem
 * `sispag:cadastro`. Toda leitura RECONFERE no cadastro do Conexos (`cmn025`) cada pendência
 * ABERTA: a que passou a ter o dado vira RESOLVIDA (ator `sistema`, evento na trilha) e sai da
 * lista. Leitura que falha não resolve nem derruba a fila (falha fechada, I13b): a pendência segue
 * ABERTA e aparece.
 *
 * NÃO existe resolução manual: não há método público que leve ABERTA → RESOLVIDA por pedido de
 * alguém — a única saída é o cadastro corrigido no Conexos. Nada é escrito no ERP.
 */
@injectable()
export default class PendenciaCadastroService {
    public constructor(
        @inject(PendenciaCadastroRepository) private readonly repo: PendenciaCadastroRepository,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(ExcecaoDestinoRepository) private readonly excecoes: ExcecaoDestinoRepository,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public listarAbertas = async (): Promise<PendenciaCadastro[]> => {
        const abertas = await this.repo.listAbertas();
        if (abertas.length === 0) return [];
        const settled = await this.bounded.run(abertas, this.reconferir, CONEXOS_FANOUT_LIMIT);
        const resultados: Reconferencia[] = settled.map((s) =>
            s.status === 'fulfilled' ? s.value : 'INDISPONIVEL',
        );
        const ainda = abertas.filter((_p, i) => resultados[i] !== 'RESOLVIDA');
        const resolvidas = resultados.filter((r) => r === 'RESOLVIDA').length;
        const indisponiveis = resultados.filter((r) => r === 'INDISPONIVEL').length;
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'pendências de cadastro reconferidas',
            data: { abertas: abertas.length, resolvidas, indisponiveis, restantes: ainda.length },
        });
        return Promise.all(ainda.map(this.comExcecao));
    };

    /** Lê o cadastro do favorecido e resolve a pendência quando o dado apareceu. */
    private reconferir = async (p: PendenciaCadastro): Promise<Reconferencia> => {
        let temDado: boolean;
        try {
            temDado =
                p.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX
                    ? (await this.sispag.listChavesPixFavorecido(p.pesCod, p.filCod)).length > 0
                    : (await this.sispag.listContasFavorecido(p.pesCod, p.filCod)).length > 0;
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'pendência de cadastro não reconferida: leitura do cadastro falhou',
                data: {
                    pendenciaId: p.id,
                    pesCod: p.pesCod,
                    tipo: p.tipo,
                    erro: error instanceof Error ? error.name : 'erro',
                },
            });
            return 'INDISPONIVEL';
        }
        if (temDado) {
            await this.repo.resolverDoFavorecido(p.pesCod, p.tipo);
            return 'RESOLVIDA';
        }
        await this.repo.tocarConferencia(p.id);
        return 'ABERTA';
    };

    /** `comExcecaoAprovada` derivado: o pagamento segue pela exceção, o cadastro segue por corrigir. */
    private comExcecao = async (p: PendenciaCadastro): Promise<PendenciaCadastro> => {
        try {
            const aprovada = await this.excecoes.findAprovada(p.pesCod, p.tipo);
            return { ...p, comExcecaoAprovada: aprovada !== null };
        } catch {
            return p;
        }
    };
}
