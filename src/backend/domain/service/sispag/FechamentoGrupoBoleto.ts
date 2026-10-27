import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import { GRUPO_BOLETO_EVENTO } from '../../interface/sispag/GrupoBoletoInterface.js';
import type { DivergenciaItem, ItemDecidido } from '../../interface/sispag/SincronizacaoLote.js';
import {
    ITEM_SITUACAO,
    type ItemLote,
    type LotePagamento,
    SISPAG_SYSTEM_ACTOR,
} from '../../interface/sispag/SispagInterface.js';
import EtapaBorderoGrupo from '../../libs/boleto/EtapaBorderoGrupo.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';

const chaveDe = (t: { filCod: number; docCod: string; titCod: string }): string =>
    `${t.filCod}:${t.docCod}:${t.titCod}`;

/**
 * FechamentoGrupoBoleto — o que a sincronização do lote faz DEPOIS de decidir os itens, para os
 * grupos de boleto (ADR-0077, I21r, I11i). A decisão por título é da `DecisaoStatusLote`; aqui só
 * se fecha o grupo, com o que ela decidiu:
 *
 *  - os N títulos `PAGO` ⇒ grupo `PAGO` (terminal, `GRUPO_PAGO`) e as marcas encerradas, numa
 *    transação;
 *  - os N `REJEITADO` (o J rejeitado) ⇒ `j_rejeitado_em` na execução e `Alerta`
 *    `sispag-bordero-grupo-pendente` (o borderô segue em cadastro no ERP, e o grupo só volta a uma
 *    remessa depois de a analista o resolver, PI-9);
 *  - divergência NOVA em título do grupo ⇒ evento `GRUPO_DIVERGENTE`, uma vez por grupo.
 *
 * Idempotente: roda também numa passada sem mudança (recupera uma queda entre gravar os itens e
 * fechar o grupo); `marcarPago`, `marcarJRejeitado` e o alerta (janela diária) toleram repetição.
 * Título não lido nesta passada não decide nada (I11c). Nenhuma escrita no ERP. Uma falha daqui
 * nunca derruba a sincronização: fica no log e a próxima passada refaz.
 */
@injectable()
export default class FechamentoGrupoBoleto {
    public constructor(
        @inject(GrupoBoletoRepository) private readonly grupoRepo: GrupoBoletoRepository,
        @inject(GrupoBoletoExecucaoRepository)
        private readonly execucoes: GrupoBoletoExecucaoRepository,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueios: BloqueioDuplicidadeRepository,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public fechar = async (p: {
        lote: LotePagamento;
        itens: ItemDecidido[];
        /** Divergências NOVAS desta passada (I11f). */
        divergencias?: DivergenciaItem[];
        agora: Date;
    }): Promise<void> => {
        const porGrupo = new Map<string, ItemLote[]>();
        for (const i of p.lote.itens) {
            if (i.grupoBoletoId === undefined) continue;
            porGrupo.set(i.grupoBoletoId, [...(porGrupo.get(i.grupoBoletoId) ?? []), i]);
        }
        if (porGrupo.size === 0) return;
        const decididos = new Map(p.itens.map((i) => [chaveDe(i), i]));
        const novas = new Set((p.divergencias ?? []).map((d) => chaveDe(d.chave)));
        for (const [grupoId, itens] of porGrupo) {
            try {
                await this.fecharGrupo({ ...p, grupoId, itens, decididos, novas });
            } catch (erro) {
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'fechamento do boleto agrupado falhou — a próxima passada refaz',
                    data: {
                        loteId: p.lote.id,
                        grupoId,
                        motivo: erro instanceof Error ? erro.message : String(erro),
                    },
                });
            }
        }
    };

    private fecharGrupo = async (p: {
        lote: LotePagamento;
        grupoId: string;
        itens: ItemLote[];
        decididos: ReadonlyMap<string, ItemDecidido>;
        novas: ReadonlySet<string>;
        agora: Date;
    }): Promise<void> => {
        const { lote, grupoId, itens, agora } = p;
        const doGrupo = itens.map((i) => p.decididos.get(chaveDe(i)));
        const completo = doGrupo.every((d): d is ItemDecidido => d !== undefined && d.tituloLido);
        if (!completo) return;
        const decidos = doGrupo as ItemDecidido[];

        if (itens.some((i) => p.novas.has(chaveDe(i)))) await this.registrarDivergencia(p);
        if (decidos.every((d) => d.situacao === ITEM_SITUACAO.PAGO)) {
            await this.fecharPago(lote, grupoId, agora);
        } else if (decidos.every((d) => d.situacao === ITEM_SITUACAO.REJEITADO)) {
            await this.fecharRejeitado(lote, grupoId, itens, agora);
        }
    };

    private fecharPago = async (
        lote: LotePagamento,
        grupoId: string,
        agora: Date,
    ): Promise<void> => {
        const exec = await this.execucoes.ultimaPorGrupo(grupoId);
        await this.db.withTransaction(async (tx) => {
            const r = await this.grupoRepo.marcarPago(
                {
                    grupoId,
                    observadoEm: agora,
                    loteId: lote.id,
                    ...(exec?.borCod !== undefined ? { borCod: exec.borCod } : {}),
                },
                tx,
            );
            // Só a primeira vez encerra as marcas: repetir a passada não mexe em nada.
            if (r.resultado !== 'APLICADO') return;
            await this.bloqueios.encerrarDoGrupo(
                {
                    grupoId,
                    motivo: 'boleto agrupado pago no Conexos',
                    ator: SISPAG_SYSTEM_ACTOR,
                },
                tx,
            );
        });
        // Mesma causa do rejeitado: a execução do lote pago não pode ficar `importado`.
        if (exec?.loteId === lote.id) await this.concluirExecucao(exec.id, exec.etapa);
    };

    private fecharRejeitado = async (
        lote: LotePagamento,
        grupoId: string,
        itens: ItemLote[],
        agora: Date,
    ): Promise<void> => {
        const ultima = await this.execucoes.ultimaPorGrupo(grupoId);
        // Só a execução DESTE lote: uma passada tardia sobre o lote antigo não pode marcar nem
        // concluir a execução de uma remessa posterior do mesmo grupo.
        const exec = ultima?.loteId === lote.id ? ultima : undefined;
        if (exec) {
            await this.execucoes.marcarJRejeitado(exec.id, agora);
            await this.concluirExecucao(exec.id, exec.etapa);
        }
        const grupo = await this.grupoRepo.buscarPorId(grupoId);
        const bordero = exec?.borCod !== undefined ? ` ${exec.borCod}` : '';
        const nativeBatch = exec?.flpCod ?? lote.nativeFlpCod;
        const nativeBatchLabel = nativeBatch !== undefined ? ` ${nativeBatch}` : '';
        try {
            await this.notificacao.emitir({
                tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE,
                alvo: grupoId,
                severidade: ALERTA_SEVERIDADE.ERRO,
                // Janela diária: rodar a passada de novo no mesmo dia não duplica o alerta.
                janelaInicio: BankingCalendar.withClock(() => agora).startOfTodayBrt(),
                detalhe: {
                    grupoId,
                    loteId: lote.id,
                    filCod: lote.filCod,
                    ...(exec?.borCod !== undefined ? { borCod: exec.borCod } : {}),
                    ...(grupo?.codbarMascarado !== undefined
                        ? { codigoMascarado: grupo.codbarMascarado }
                        : {}),
                    titulos: itens.map((i) => `${i.docCod}/${i.titCod}`),
                    acao:
                        `O banco rejeitou o pagamento do boleto agrupado. Confira o lote nativo${nativeBatchLabel} ` +
                        `no Conexos (fin015), o vínculo do item e o borderô${bordero} (fin010). ` +
                        'Regularize a situação com a analista ou responsável pelo ERP antes de pôr o grupo ' +
                        'num lote novo. O grupo não volta sozinho a uma remessa.',
                },
            });
        } catch (erro) {
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao emitir o alerta do borderô do grupo rejeitado',
                data: {
                    grupoId,
                    motivo: erro instanceof Error ? erro.message : String(erro),
                },
            });
        }
    };

    /**
     * A remessa já foi gerada: a preparação do borderô acabou. Sem isto a execução ficava
     * `importado` (não terminal) e a remessa seguinte do grupo rejeitado batia no índice de uma
     * execução não terminal por grupo e virava `indeterminado` (HML v7, 2026-10-27).
     */
    private concluirExecucao = async (id: string, etapa: string): Promise<void> => {
        let atual = etapa as Parameters<typeof EtapaBorderoGrupo.caminhoAteConcluido>[0];
        for (const proxima of EtapaBorderoGrupo.caminhoAteConcluido(atual)) {
            if (!(await this.execucoes.registrarEtapa(id, atual, proxima))) return;
            atual = proxima;
        }
    };

    private registrarDivergencia = async (p: {
        lote: LotePagamento;
        grupoId: string;
        itens: ItemLote[];
        novas: ReadonlySet<string>;
    }): Promise<void> => {
        const [grupo, exec] = await Promise.all([
            this.grupoRepo.buscarPorId(p.grupoId),
            this.execucoes.ultimaPorGrupo(p.grupoId),
        ]);
        await this.grupoRepo.registrarEvento({
            grupoId: p.grupoId,
            tipo: GRUPO_BOLETO_EVENTO.GRUPO_DIVERGENTE,
            ator: SISPAG_SYSTEM_ACTOR,
            filCod: p.lote.filCod,
            loteId: p.lote.id,
            ...(exec?.borCod !== undefined ? { borCod: exec.borCod } : {}),
            ...(grupo?.codbarMascarado !== undefined
                ? { codigoMascarado: grupo.codbarMascarado }
                : {}),
            dados: {
                titulos: p.itens.length,
                divergentes: p.itens.filter((i) => p.novas.has(chaveDe(i))).length,
            },
        });
    };
}
