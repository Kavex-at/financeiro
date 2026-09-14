import { inject, injectable } from 'tsyringe';
import type {
    MetricasCicloFiltro,
    MetricasCicloLeitura,
} from '../../interface/metricas/MetricaCiclo.js';
import MetricasCicloRepository from '../../repository/metricas/MetricasCicloRepository.js';

/** `YYYY-MM-DD`, sem hora. */
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;
/** `YYYY-MM-DDTHH:MM`, sem segundos. */
const SEM_SEGUNDOS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * MetricasCicloService — leitura das métricas do ciclo para a tela e para o report (ADR-0045).
 *
 * A única regra que mora aqui é a leitura das datas do filtro. A janela fecha sexta **20:00**. Quem
 * pede `fim=2026-09-18` quer a semana que termina nesse dia; lido como `00:00`, o filtro
 * `janela_fim <= fim` descartaria justamente essa semana e devolveria vazio, sem erro nenhum. Foi o
 * que acontecia com o `metrics.py` lendo a view direto (gap K1). Então data sem hora vira o dia
 * inteiro: início às 00:00:00, fim às 23:59:59.
 */
@injectable()
export default class MetricasCicloService {
    public constructor(
        @inject(MetricasCicloRepository)
        private readonly repository: MetricasCicloRepository,
    ) {}

    public ler = async (filtro: MetricasCicloFiltro): Promise<MetricasCicloLeitura> => {
        const normalizado: MetricasCicloFiltro = {
            ...(filtro.inicio !== undefined
                ? { inicio: this.normalizar(filtro.inicio, 'inicio') }
                : {}),
            ...(filtro.fim !== undefined ? { fim: this.normalizar(filtro.fim, 'fim') } : {}),
        };

        const [serieInicio, metricas] = await Promise.all([
            this.repository.serieInicio(),
            this.repository.listar(normalizado),
        ]);
        return { serieInicio, metricas };
    };

    private normalizar = (valor: string, limite: 'inicio' | 'fim'): string => {
        if (SO_DATA.test(valor)) return `${valor}T${limite === 'inicio' ? '00:00:00' : '23:59:59'}`;
        if (SEM_SEGUNDOS.test(valor)) return `${valor}:00`;
        return valor;
    };
}
