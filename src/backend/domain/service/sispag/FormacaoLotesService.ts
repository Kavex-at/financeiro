import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { GRUPO_BOLETO_ESTADO } from '../../interface/sispag/GrupoBoletoInterface.js';
import SituacaoGrupoBoleto, { type SituacaoGrupo } from '../../libs/boleto/SituacaoGrupoBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import {
    type FormacaoLotesResult,
    MODALIDADE,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import LotePagamentoRepository, {
    RESULTADO_OPERACAO_GRUPO,
} from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository, {
    type GrupoParaFormacao,
} from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';
import ContaPagadoraResolver, { type ContaPagadoraEscolhida } from './ContaPagadoraResolver.js';
import LeituraGrupoBoleto from './LeituraGrupoBoleto.js';

/** Horizonte da formação automática: só títulos a vencer nos próximos N dias. */
const HORIZONTE_DIAS = 7;
/** Advisory lock EXCLUSIVO da formação (≠ ingestão 726354819, ≠ permutas). */
export const FORMACAO_LOCK_KEY = 615243789;

/** Um lote a formar: títulos avulsos e grupos de boleto inteiros (ADR-0076, P1-4). */
interface FatiaDeLote {
    filCod: number;
    titulos: TituloAPagar[];
    grupos: GrupoParaFormacao[];
}

/**
 * FormacaoLotesService — cron pós-ingestão que MONTA lotes candidatos automaticamente.
 *
 * Regras (as mesmas da montagem manual): mesma filial (I4), SÓ títulos A VENCER
 * (≤7d; vencidos NÃO entram). Agrupa por FILIAL × DIA DE VENCIMENTO (ADR-0064). Cada run: (1) DESFAZ lotes automáticos que já têm título
 * vencido (libera os títulos); (2) forma lotes novos com os elegíveis ainda sem lote.
 * Os lotes nascem RASCUNHO e caem em "Lotes candidatos" para o analista revisar antes
 * de aprovar. NÃO toca em lotes manuais nem finalizados. Escreve só no Postgres (I1).
 *
 * Grupo de boleto confirmado (ADR-0076, P1-4, PI-8): UMA unidade. Entra inteiro no lote de
 * boletos da filial × VENCIMENTO DO BOLETO (janela medida pelo boleto), na mesma transação dos
 * avulsos daquele lote, ou não entra; título de grupo nunca entra avulso (a carteira elegível já
 * o exclui). Só grupo `DISPONIVEL` é lotado: órfão, retido ou com J rejeitado não resolvido fica
 * para a analista (I19j, I19r). L6 mede o vencido do grupo pelo boleto (repositório).
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
        @inject(GrupoBoletoRepository) private readonly grupoRepo: GrupoBoletoRepository,
        @inject(LeituraGrupoBoleto) private readonly leituraGrupo: LeituraGrupoBoleto,
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
        // "Hoje" é o dia civil de Brasília no formato do ERP: o título que vence hoje não é
        // vencido (R2) — comparar com o instante desfazia o lote dele a partir das 09:00 BRT.
        const hoje = new Date(this.calendar.toErpEpoch(this.calendar.todayBrt()));
        const lotesDesfeitos = await this.loteRepo.desfazerAutomaticosVencidos(hoje);

        // 2) forma lotes novos com os elegíveis (a vencer ≤7d, não lotados). Cada grupo
        // (filial × vencimento) vira no máx. dois lotes: boletos e o resto, nunca misturados.
        const elegiveis = await this.tituloRepo.listElegiveisParaFormacao(HORIZONTE_DIAS, hoje);
        const { lotaveis, naoLotados } = await this.gruposLotaveis(hoje);
        const fatias = this.fatiar(this.agrupar(elegiveis), lotaveis);
        let lotesFormados = 0;
        let titulosLotados = 0;
        let gruposLotados = 0;
        // Conta pagadora resolvida UMA vez por filial na rodada (G-13): lê o fin005 da filial,
        // não grava uma conta fixa.
        const contaPorFilial = new Map<number, ContaPagadoraEscolhida | undefined>();
        for (const fatia of fatias) {
            if (!contaPorFilial.has(fatia.filCod)) {
                contaPorFilial.set(
                    fatia.filCod,
                    await this.contaResolver.resolverPadrao(fatia.filCod),
                );
            }
            await this.montarLote(fatia, input.triggeredBy, contaPorFilial.get(fatia.filCod));
            lotesFormados += 1;
            titulosLotados +=
                fatia.titulos.length + fatia.grupos.reduce((n, g) => n + g.titulos.length, 0);
            gruposLotados += fatia.grupos.length;
        }

        const result: FormacaoLotesResult = {
            lotesFormados,
            titulosLotados,
            lotesDesfeitos,
            gruposLotados,
        };
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'formação automática de lotes concluída',
            data: { ...result, gruposNaoLotados: naoLotados, triggeredBy: input.triggeredBy },
        });
        return result;
    };

    /**
     * Grupos `CONFIRMADO` na janela do boleto que o cron pode lotar (situação `DISPONIVEL`). O
     * repositório já tira os com título em lote vivo, com marca ativa ou fora da carteira; aqui
     * caem o órfão pelo boleto (I19u) e o com J rejeitado não resolvido (I19r, PI-9). Os que ficam
     * de fora são contados por situação para o log da rodada.
     */
    private gruposLotaveis = async (
        hoje: Date,
    ): Promise<{
        lotaveis: GrupoParaFormacao[];
        naoLotados: Partial<Record<SituacaoGrupo, number>>;
    }> => {
        const candidatos = await this.tituloRepo.listGruposParaFormacao(HORIZONTE_DIAS, hoje);
        const lotaveis: GrupoParaFormacao[] = [];
        const naoLotados: Partial<Record<SituacaoGrupo, number>> = {};
        for (const candidato of candidatos) {
            const grupo = await this.grupoRepo.buscarPorId(candidato.grupoId);
            if (!grupo || grupo.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) continue;
            const orfao = await this.leituraGrupo.orfao(grupo);
            const situacao = await this.leituraGrupo.situacao(grupo, { orfao: orfao.orfao });
            if (SituacaoGrupoBoleto.podeSerLotadoPeloCron(situacao)) {
                lotaveis.push(candidato);
            } else {
                naoLotados[situacao] = (naoLotados[situacao] ?? 0) + 1;
            }
        }
        return { lotaveis, naoLotados };
    };

    /** Um lote por fatia, numa transação (raiz + itens avulsos + grupos inteiros). */
    private montarLote = async (
        fatia: FatiaDeLote,
        ator: string,
        conta: ContaPagadoraEscolhida | undefined,
    ): Promise<void> => {
        await this.db.withTransaction(async (tx) => {
            const lote = await this.loteRepo.criarLote(
                {
                    filCod: fatia.filCod,
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
                fatia.titulos.map((t) => ({
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
            for (const g of fatia.grupos) {
                const r = await this.loteRepo.adicionarGrupo(
                    {
                        loteId: lote.id,
                        grupoId: g.grupoId,
                        itens: g.titulos.map((t) => ({
                            filCod: t.filCod,
                            docCod: t.docCod,
                            titCod: t.titCod,
                            credor: t.credor,
                            valor: t.valor,
                            vencimento: t.vencimento,
                        })),
                        incluidoPor: ator,
                    },
                    tx,
                );
                if (r !== RESULTADO_OPERACAO_GRUPO.APLICADO) {
                    // Nunca parte do lote: desfaz a transação inteira (o lote recém-criado some).
                    throw new Error(
                        `grupo de boleto ${g.grupoId} não entrou no lote automático: ${r}`,
                    );
                }
            }
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
            const key = this.chave(t.filCod, t.vencimento);
            const atual = grupos.get(key);
            if (atual) atual.push(t);
            else grupos.set(key, [t]);
        }
        return grupos;
    };

    private chave = (filCod: number, vencimento?: number): string =>
        `${filCod}:${vencimento !== undefined ? this.calendar.fromErpEpoch(vencimento) : 'sem-venc'}`;

    /**
     * Separa cada (filial × dia) em BOLETOS (`temBoleto`) e o RESTO (ADR-0064): no máximo dois
     * lotes, nunca mistos, sem teto de quantidade. O teto de 25 era nosso (revisão humana), não do
     * Conexos/CNAB. Lote só de boletos também não passa pela conferência TED/PIX (ADR-0063). O
     * grupo de boleto vai para o lote de BOLETOS do dia do VENCIMENTO DO BOLETO (PI-8), criando-o
     * quando não há boleto avulso nesse dia.
     */
    private fatiar = (
        avulsos: Map<string, TituloAPagar[]>,
        grupos: GrupoParaFormacao[],
    ): FatiaDeLote[] => {
        const gruposPorChave = new Map<string, GrupoParaFormacao[]>();
        for (const g of grupos) {
            const key = this.chave(g.filCod, g.vencimentoBoleto);
            gruposPorChave.set(key, [...(gruposPorChave.get(key) ?? []), g]);
        }
        const fatias: FatiaDeLote[] = [];
        for (const [key, titulos] of avulsos) {
            const filCod = titulos[0]?.filCod ?? 0;
            const boletos = titulos.filter((t) => t.temBoleto === true);
            const resto = titulos.filter((t) => t.temBoleto !== true);
            const doDia = gruposPorChave.get(key) ?? [];
            gruposPorChave.delete(key);
            if (boletos.length > 0 || doDia.length > 0) {
                fatias.push({ filCod, titulos: boletos, grupos: doDia });
            }
            if (resto.length > 0) fatias.push({ filCod, titulos: resto, grupos: [] });
        }
        for (const doDia of gruposPorChave.values()) {
            const filCod = doDia[0]?.filCod;
            if (filCod !== undefined) fatias.push({ filCod, titulos: [], grupos: doDia });
        }
        return fatias;
    };
}
