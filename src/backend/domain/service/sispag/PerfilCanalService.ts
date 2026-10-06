import { inject, injectable } from 'tsyringe';
import ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosExtratoClient, { EXI_VLD_TIPO } from '../../client/ConexosExtratoClient.js';
import ConexosPagamentosRealizadosClient, {
    type BorderoPagamento,
} from '../../client/ConexosPagamentosRealizadosClient.js';
import {
    CHANNEL_CONFIDENCE,
    type ChannelConfidence,
    type ChannelPayment,
    type ChannelProfile,
    type StatementDebit,
} from '../../interface/sispag/SispagInterface.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import PerfilCanalFornecedorRepository from '../../repository/sispag/PerfilCanalFornecedorRepository.js';
import ChannelProfileCalculator from './ChannelProfileCalculator.js';

const DIA_MS = 86_400_000;
/** O `fin095` é lido em fatias de 30 dias por conta (mesma janela da probe). */
const FATIA_EXTRATO_MS = 30 * DIA_MS;
/** Leituras simultâneas de baixas por borderô (mesma da probe; o ERP limita sessões). */
const PARALELO_BAIXAS = 4;

/** Resumo de uma rodada — vira as métricas da `job_execucao` e o log de fim. */
export interface ResumoPerfilCanal {
    filiais: number;
    contas: number;
    debitos: number;
    borderos: number;
    baixas: number;
    perfis: number;
    porConfianca: Record<ChannelConfidence, number>;
    ambiguos: number;
    semDebito: number;
    semFavorecido: number;
    /** Leituras do Conexos que falharam (filial, conta ou borderô). >0 = rodada NÃO grava. */
    falhasLeitura: number;
    /** `true` quando os perfis foram gravados. */
    gravado: boolean;
    janelaInicio: number;
    janelaFim: number;
}

interface Janela {
    inicio: number;
    fim: number;
}

/** Contador de leituras que falharam, compartilhado entre as etapas de uma rodada. */
interface Falhas {
    n: number;
}

/**
 * PerfilCanalService — `calcularPerfilCanal` (ADR-0063, I13i). READ-ONLY no Conexos: lê borderôs
 * de pagamento finalizados e suas baixas (`fin010`), as contas da filial (`fin133`) e os débitos
 * do extrato (`fin095`); o casamento e a confiança são do `ChannelProfileCalculator` (puro). Grava
 * só o read model `perfil_canal_fornecedor`, numa transação.
 *
 * FALHA FECHADA: qualquer leitura que falhe deixa a rodada SEM gravar — um perfil calculado sobre
 * metade do histórico poderia virar ALTA (ou deixar de ser) por falta de dado, e o perfil anterior
 * é mais confiável que um parcial. O job transforma isso em run `error` e exit ≠ 0.
 */
@injectable()
export default class PerfilCanalService {
    public constructor(
        @inject(ConexosBaseClient) private readonly base: ConexosBaseClient,
        @inject(ConexosPagamentosRealizadosClient)
        private readonly pagamentos: ConexosPagamentosRealizadosClient,
        @inject(ConexosExtratoClient) private readonly extrato: ConexosExtratoClient,
        @inject(ChannelProfileCalculator) private readonly calculator: ChannelProfileCalculator,
        @inject(PerfilCanalFornecedorRepository)
        private readonly repo: PerfilCanalFornecedorRepository,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(BoundedConcurrency) private readonly bounded: BoundedConcurrency,
    ) {}

    public calcular = async (input: {
        jobRunId: string;
        agora?: Date;
    }): Promise<ResumoPerfilCanal> => {
        const config = (await this.environmentProvider.getEnvironmentVars()).sispagVerificacao;
        const fim = (input.agora ?? new Date()).getTime();
        const janela: Janela = { inicio: fim - config.perfilJanelaMeses * 30 * DIA_MS, fim };
        const falhas: Falhas = { n: 0 };

        const filiais = (await this.base.getFiliais()).map((f) => Number(f.filCod));
        const contas = await this.lerContas(filiais, falhas);
        const debitos = await this.lerDebitos(contas, janela, falhas);
        const { baixas, borderos } = await this.lerBaixas(filiais, janela, falhas);

        const resultado = this.calculator.calcular({
            baixas,
            debitos,
            limiares: {
                minPagamentos: config.perfilMinPagamentos,
                minMeses: config.perfilMinMeses,
                minParticipacao: config.perfilMinParticipacao,
            },
            janela,
        });

        const gravado = falhas.n === 0 && resultado.perfis.length > 0;
        if (gravado) {
            await this.repo.upsertRodada(
                resultado.perfis.map((p) => ({ ...p, jobRunId: input.jobRunId })),
                input.jobRunId,
            );
        }
        return {
            filiais: filiais.length,
            contas: contas.size,
            debitos: debitos.length,
            borderos,
            baixas: baixas.length,
            perfis: resultado.perfis.length,
            porConfianca: this.contarConfianca(resultado.perfis),
            ambiguos: resultado.ambiguos,
            semDebito: resultado.semDebito,
            semFavorecido: resultado.semFavorecido,
            falhasLeitura: falhas.n,
            gravado,
            janelaInicio: janela.inicio,
            janelaFim: janela.fim,
        };
    };

    /**
     * Contas financeiras com movimento de banco, dedup por `gerNum` (o fin095 devolve o MESMO
     * extrato para qualquer filial, ADR-0032). Valor = a filial usada no header da leitura.
     */
    private lerContas = async (filiais: number[], falhas: Falhas): Promise<Map<number, number>> => {
        const contas = new Map<number, number>();
        for (const filCod of filiais) {
            try {
                for (const c of await this.extrato.listContas(filCod)) {
                    if (!contas.has(c.gerNum) && (c.qtdeBanco ?? 1) > 0)
                        contas.set(c.gerNum, filCod);
                }
            } catch {
                falhas.n += 1;
            }
        }
        return contas;
    };

    /** Débitos do extrato de cada conta, em fatias de 30 dias. */
    private lerDebitos = async (
        contas: Map<number, number>,
        janela: Janela,
        falhas: Falhas,
    ): Promise<StatementDebit[]> => {
        const debitos: StatementDebit[] = [];
        for (const [gerNum, filCod] of contas) {
            for (let ini = janela.inicio; ini < janela.fim; ini += FATIA_EXTRATO_MS + 1) {
                try {
                    const lancamentos = await this.extrato.listLancamentos({
                        filCod,
                        gerNum,
                        de: new Date(ini),
                        ate: new Date(Math.min(ini + FATIA_EXTRATO_MS, janela.fim)),
                        exiVldTipo: EXI_VLD_TIPO.DEBITO,
                    });
                    for (const l of lancamentos) {
                        debitos.push({
                            valor: l.valor,
                            data: l.dataLancamento.getTime(),
                            ...(l.historico ? { historico: l.historico } : {}),
                        });
                    }
                } catch {
                    falhas.n += 1;
                }
            }
        }
        return debitos;
    };

    /** Baixas a pagar (fin010) de cada borderô finalizado na janela. */
    private lerBaixas = async (
        filiais: number[],
        janela: Janela,
        falhas: Falhas,
    ): Promise<{ baixas: ChannelPayment[]; borderos: number }> => {
        const baixas: ChannelPayment[] = [];
        let borderos = 0;
        for (const filCod of filiais) {
            let lista: BorderoPagamento[];
            try {
                lista = await this.pagamentos.listBorderosPagamento(filCod, janela.inicio);
            } catch {
                falhas.n += 1;
                continue;
            }
            borderos += lista.length;
            const settled = await this.bounded.run(
                lista,
                (b) => this.pagamentos.listBaixasPagamento(filCod, b),
                PARALELO_BAIXAS,
            );
            for (const s of settled) {
                if (s.status === 'fulfilled') baixas.push(...s.value);
                else falhas.n += 1;
            }
        }
        return { baixas, borderos };
    };

    private contarConfianca = (perfis: ChannelProfile[]): Record<ChannelConfidence, number> => {
        const porConfianca: Record<ChannelConfidence, number> = {
            [CHANNEL_CONFIDENCE.ALTA]: 0,
            [CHANNEL_CONFIDENCE.MEDIA]: 0,
            [CHANNEL_CONFIDENCE.BAIXA]: 0,
        };
        for (const p of perfis) porConfianca[p.confianca] += 1;
        return porConfianca;
    };
}
