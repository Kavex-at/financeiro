import { inject, injectable } from 'tsyringe';
import ConexosBaixaClient from '../../client/ConexosBaixaClient.js';
import ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import PermutaExecucaoRepository, {
    type ExecucaoRow,
    type ExecucaoStatus,
} from '../../repository/permutas/PermutaExecucaoRepository.js';
import LogService from '../LogService.js';

/** Situação viva do borderô no ERP (derivada do `getBordero`). */
export type BorderoSituacao =
    | 'EM_CADASTRO'
    | 'FINALIZADO'
    | 'CANCELADO'
    | 'ESTORNADO'
    | 'REMOVIDO'
    | 'INDISPONIVEL';

/** Status da PERMUTA em relação ao seu borderô no fin010 (tela de permutas). */
export type PermutaStatus = 'aguardando-finalizacao' | 'finalizado';

/** Vínculo permuta→borderô: borderô gerado pela baixa do adiantamento + status vivo. */
export interface PermutaBorderoVinculo {
    borCod: number;
    permutaStatus: PermutaStatus;
    situacao: BorderoSituacao;
}

/** Uma baixa (par adto→invoice) dentro do borderô — vinda da nossa trilha. */
export interface BaixaResumo {
    invoiceDocCod: string;
    adiantamentoDocCod: string;
    status: ExecucaoStatus;
    valorBaixado?: number;
    juros?: number;
    contaJuros?: number;
    bxaCodSeq?: number;
    /** Mensagem de erro da baixa (só quando `status='error'`) — vinda da trilha. */
    erroMensagem?: string;
    criadoEm: string;
}

/** Resumo de um borderô para a tela de gestão (trilha local + status vivo do ERP). */
export interface BorderoResumo {
    borCod: number;
    filCod: number;
    /** Situação VIVA no ERP (em aberto / finalizado / estornado / removido). */
    situacao: BorderoSituacao;
    finalizado: boolean;
    estornado: boolean;
    criadoPor?: string;
    criadoEm: string;
    totalBaixado: number;
    baixas: BaixaResumo[];
    /** Criado por ESTE sistema (tem trilha local)? Habilita as ações de escrita no front. */
    daTrilha: boolean;
}

/**
 * BorderoGestaoService — alimenta a aba de **gestão de borderôs** (Fase 3.1, READ-ONLY).
 *
 * Fonte: a nossa trilha de execução (`permuta_alocacao_execucao`) agrupada por `bor_cod` —
 * são os borderôs que ESTE sistema criou. Enriquece cada um com o **estado vivo do ERP**
 * (`ConexosBaixaClient.getBordero`): EM CADASTRO / FINALIZADO / ESTORNADO / REMOVIDO. As AÇÕES
 * de aprovação/exclusão/estorno (escrita) são uma fatia futura — aqui só listamos para revisão.
 */
@injectable()
export default class BorderoGestaoService {
    constructor(
        @inject(ConexosBaixaClient) private conexosBaixaClient: ConexosBaixaClient,
        @inject(ConexosCadastroClient) private conexosCadastroClient: ConexosCadastroClient,
        @inject(EnvironmentProvider) private environmentProvider: EnvironmentProvider,
        @inject(PermutaExecucaoRepository)
        private execucaoRepository: PermutaExecucaoRepository,
        @inject(LogService) private logService: LogService,
    ) {}

    /**
     * Exclui UMA baixa específica de um borderô EM CADASTRO (antes de aprovar) — Fase 3.1.
     * Gated pela escrita (CONEXOS_WRITE_ENABLED). Exclui no ERP (`fin010/baixas/...`) e remove
     * a linha da nossa trilha. `bxaCodSeq`/`filCod` vêm da trilha (não confia no cliente).
     */
    public excluirBaixa = async (params: {
        borCod: number;
        invoiceDocCod: string;
        executadoPor: string;
    }): Promise<{
        borCod: number;
        invoiceDocCod: string;
        excluido: boolean;
        borderoExcluido: boolean;
    }> => {
        const { borCod, invoiceDocCod, executadoPor } = params;
        const env = await this.environmentProvider.getEnvironmentVars();
        if (!env.conexosWriteEnabled) {
            throw new Error('escrita no Conexos desabilitada (CONEXOS_WRITE_ENABLED=false)');
        }
        const row = await this.execucaoRepository.findByBorCodInvoice(borCod, invoiceDocCod);
        if (!row)
            throw new Error(
                `baixa não encontrada na trilha: borderô ${borCod} / invoice ${invoiceDocCod}`,
            );
        if (row.bxaCodSeq === undefined) {
            throw new Error(
                `baixa ${borCod}/${invoiceDocCod} sem bxaCodSeq — não dá para excluir no ERP`,
            );
        }

        await this.conexosBaixaClient.excluirBaixa({
            filCod: row.filCod,
            borCod,
            invoiceDocCod: Number(invoiceDocCod),
            titCod: 1,
            bxaCodSeq: row.bxaCodSeq,
        });
        await this.execucaoRepository.deleteByBorCodInvoice(borCod, invoiceDocCod);

        // Se foi a ÚLTIMA baixa, o borderô fica vazio → tenta apagar o borderô no ERP também.
        // BEST-EFFORT: a baixa já foi removida (ação principal); uma falha aqui NÃO derruba a
        // operação — apenas loga e segue (o borderô some da nossa lista de qualquer forma).
        let borderoExcluido = false;
        if ((await this.execucaoRepository.countByBorCod(borCod)) === 0) {
            try {
                await this.conexosBaixaClient.excluirBordero({ filCod: row.filCod, borCod });
                borderoExcluido = true;
                await this.execucaoRepository.deleteBorderoCache(row.filCod, borCod); // some do cache na hora
            } catch (err) {
                await this.logService.warn({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message:
                        'baixa excluída, mas falha ao apagar o borderô vazio no ERP (best-effort)',
                    data: { borCod, erro: err instanceof Error ? err.message : String(err) },
                });
            }
        }

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'baixa excluída do borderô (fin010)',
            data: {
                borCod,
                invoiceDocCod,
                bxaCodSeq: row.bxaCodSeq,
                borderoExcluido,
                executadoPor,
            },
        });
        return { borCod, invoiceDocCod, excluido: true, borderoExcluido };
    };

    /**
     * Exclui o BORDERÔ INTEIRO (em cadastro) — caminho inverso de excluir baixa a baixa. Remove
     * cada baixa no ERP e depois o próprio borderô (`moduleBordero.delete`), além de limpar a
     * trilha. Gated (CONEXOS_WRITE_ENABLED). Só borderô EM CADASTRO (não finalizado/estornado).
     */
    public excluirBordero = async (params: {
        borCod: number;
        executadoPor: string;
    }): Promise<{ borCod: number; excluido: boolean; baixasExcluidas: number }> => {
        const { borCod, executadoPor } = params;
        await this.assertWriteEnabled();
        const filCod = await this.requireOwnBorderoFilCod(borCod);

        // O estado (em cadastro/finalizado) é validado pela LISTA no front (fonte confiável) e,
        // em última instância, pelo próprio ERP (que recusa excluir baixa de borderô finalizado —
        // FIN_IMPOSSIVEL_ALTERAR). NÃO usamos o GET de detalhe aqui: ele é incoerente
        // (borDtaFinalizado persiste após estorno → falso "finalizado").

        // Enumera as baixas DO ERP (fonte da verdade — funciona p/ borderôs fora da trilha),
        // remove cada uma e depois o próprio borderô.
        const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
        for (const b of baixas) {
            await this.conexosBaixaClient.excluirBaixa({
                filCod,
                borCod,
                docTip: b.docTip,
                invoiceDocCod: b.docCod,
                titCod: b.titCod,
                bxaCodSeq: b.bxaCodSeq,
            });
        }
        await this.conexosBaixaClient.excluirBordero({ filCod, borCod });
        await this.execucaoRepository.deleteByBorCod(borCod); // limpa a trilha (no-op se não houver)
        await this.execucaoRepository.deleteBorderoCache(filCod, borCod); // some do cache na hora

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô excluído inteiro (fin010)',
            data: { borCod, baixasExcluidas: baixas.length, executadoPor },
        });
        return { borCod, excluido: true, baixasExcluidas: baixas.length };
    };

    /**
     * FINALIZA (aprova) o borderô — confirma a baixa no ERP. Gated; só EM CADASTRO. A trilha é
     * preservada (o borderô passa a FINALIZADO na lista, status vivo do ERP).
     */
    public finalizarBordero = async (params: {
        borCod: number;
        executadoPor: string;
    }): Promise<{ borCod: number; finalizado: boolean }> => {
        const filCod = await this.guardAcaoBordero(params.borCod);
        await this.assertBorderoTemItens(filCod, params.borCod);
        await this.conexosBaixaClient.finalizarBordero({ filCod, borCod: params.borCod });
        // Reflete no cache na hora (sem esperar o próximo refresh).
        await this.execucaoRepository.updateBorderoCacheSituacao(filCod, params.borCod, {
            borVldFinalizado: 1,
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô finalizado/aprovado (fin010)',
            data: { borCod: params.borCod, executadoPor: params.executadoPor },
        });
        return { borCod: params.borCod, finalizado: true };
    };

    /**
     * CANCELA o borderô (em cadastro) — desfaz sem excluir (vira CANCELADO no ERP). Gated; só EM CADASTRO.
     */
    public cancelarBordero = async (params: {
        borCod: number;
        executadoPor: string;
    }): Promise<{ borCod: number; cancelado: boolean }> => {
        const filCod = await this.guardAcaoBordero(params.borCod);
        await this.conexosBaixaClient.cancelarBordero({ filCod, borCod: params.borCod });
        await this.execucaoRepository.updateBorderoCacheSituacao(filCod, params.borCod, {
            borVldFinalizado: 2,
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô cancelado (fin010)',
            data: { borCod: params.borCod, executadoPor: params.executadoPor },
        });
        return { borCod: params.borCod, cancelado: true };
    };

    /**
     * ESTORNA o borderô FINALIZADO — desfaz a finalização; o borderô VOLTA para EM CADASTRO no ERP
     * (pode ser finalizado de novo). Gated; só FINALIZADO. A trilha é preservada.
     */
    public estornarBordero = async (params: {
        borCod: number;
        executadoPor: string;
    }): Promise<{ borCod: number; estornado: boolean }> => {
        const filCod = await this.guardEstornoBordero(params.borCod);
        await this.conexosBaixaClient.estornarBordero({ filCod, borCod: params.borCod });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô estornado (fin010) — volta para em cadastro',
            data: { borCod: params.borCod, executadoPor: params.executadoPor },
        });
        return { borCod: params.borCod, estornado: true };
    };

    /**
     * I-Write-7 — recusa APROVAR um borderô sem item. O ERP já rejeita ("ESTE BORDERÔ NÃO POSSUI
     * ITENS"), mas só depois do POST e com um texto que não diz o que fazer; aqui o analista recebe
     * a saída certa (excluir o casco) sem gastar a ida ao ERP. A contagem vem do ERP (`listBaixas`),
     * NÃO da trilha: a trilha guarda também linhas `error` — que têm `bor_cod` mas nenhuma baixa no
     * borderô — então contá-las daria o casco como "cheio" e o guard passaria batido (borderô 18538).
     */
    private assertBorderoTemItens = async (filCod: number, borCod: number): Promise<void> => {
        const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
        if (baixas.length === 0) {
            throw new Error(
                `Borderô ${borCod} não possui baixas — não há o que aprovar. Ele ficou vazio porque ` +
                    'a baixa falhou depois de criá-lo; use "Excluir" para removê-lo.',
            );
        }
    };

    /** Lança se a escrita no Conexos estiver desabilitada (gate de todas as ações). */
    private assertWriteEnabled = async (): Promise<void> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (!env.conexosWriteEnabled) {
            throw new Error('escrita no Conexos desabilitada (CONEXOS_WRITE_ENABLED=false)');
        }
    };

    /**
     * AUTORIZAÇÃO server-side (Regis-Review P0 security — confused-deputy): só age sobre borderôs
     * CRIADOS POR ESTE SISTEMA (presentes na trilha `permuta_alocacao_execucao`). O `filCod` vem da
     * TRILHA — nunca do request — então um admin (ou JWT roubado) NÃO consegue mexer em borderô de
     * terceiro via API passando um filCod arbitrário. Lança erro `FORBIDDEN:` (→ 403 no route).
     */
    private requireOwnBorderoFilCod = async (borCod: number): Promise<number> => {
        const baixas = await this.execucaoRepository.listByBorCod(borCod);
        const filCod = baixas[0]?.filCod;
        if (filCod === undefined) {
            throw new Error(
                `FORBIDDEN: borderô ${borCod} não foi criado por este sistema — ação não permitida`,
            );
        }
        return filCod;
    };

    /**
     * Guard comum de aprovar/cancelar/estornar: escrita habilitada + AUTORIZAÇÃO (borderô da trilha)
     * + filCod da trilha. O ESTADO (em cadastro/finalizado) é validado pela LISTA no front e pelo
     * próprio ERP (recusa transições inválidas com mensagem clara, traduzida no route).
     */
    private guardAcaoBordero = (borCod: number): Promise<number> =>
        this.assertWriteEnabled().then(() => this.requireOwnBorderoFilCod(borCod));

    /** Guard do estorno — idêntico (o ERP recusa estornar o que não está finalizado). */
    private guardEstornoBordero = (borCod: number): Promise<number> =>
        this.guardAcaoBordero(borCod);

    /**
     * Lista os borderôs de permuta a partir do CACHE local (`permuta_bordero`) — rápido, sem bater
     * no ERP a cada abertura. Enriquece cada borderô com as baixas da nossa trilha. `live=true`
     * (botão Atualizar) faz um refresh ao vivo no Conexos antes de ler. Se o cache estiver vazio
     * (primeira carga), popula ao vivo uma vez.
     */
    public listarBorderos = async (opts?: {
        live?: boolean;
        limit?: number;
    }): Promise<BorderoResumo[]> => {
        // Default: 500 mais recentes (perf — milhares de borderôs no ERP; o usuário pagina 50/pág).
        const limit = opts?.limit ?? 500;
        if (opts?.live) await this.refreshCache();
        let cache = await this.execucaoRepository.listBorderoCache(limit);
        if (cache.length === 0 && !opts?.live) {
            await this.refreshCache();
            cache = await this.execucaoRepository.listBorderoCache(limit);
        }

        // Baixas da trilha por borCod (detalhe: invoice/adto/juros).
        const trilhaPorBor = new Map<number, ExecucaoRow[]>();
        for (const r of await this.execucaoRepository.listComBordero()) {
            if (r.borCod === undefined) continue;
            const lista = trilhaPorBor.get(r.borCod) ?? [];
            lista.push(r);
            trilhaPorBor.set(r.borCod, lista);
        }

        const resumos = cache.map((item) => {
            const baixasRows = trilhaPorBor.get(item.borCod) ?? [];
            const situacao = this.situacaoDoItem(item);
            const baixas: BaixaResumo[] = baixasRows.map((r) => ({
                invoiceDocCod: r.invoiceDocCod,
                adiantamentoDocCod: r.adiantamentoDocCod,
                status: r.status,
                ...(r.valorBaixado !== undefined ? { valorBaixado: r.valorBaixado } : {}),
                ...(r.juros !== undefined ? { juros: r.juros } : {}),
                ...(r.contaJuros !== undefined ? { contaJuros: r.contaJuros } : {}),
                ...(r.bxaCodSeq !== undefined ? { bxaCodSeq: r.bxaCodSeq } : {}),
                ...(r.erroMensagem !== undefined ? { erroMensagem: r.erroMensagem } : {}),
                criadoEm: r.criadoEm.toISOString(),
            }));
            const totalTrilha = baixas.reduce((acc, b) => acc + (b.valorBaixado ?? 0), 0);
            const totalBaixado =
                baixas.length > 0
                    ? Math.round(totalTrilha * 100) / 100
                    : (item.vlrTotalLiquido ?? 0);
            const criadoPor = baixasRows[0]?.executadoPor ?? item.usnDesNomeCad ?? undefined;
            const criadoEm =
                baixasRows.map((r) => r.criadoEm.toISOString()).sort()[0] ??
                (item.borDtaMvto ? new Date(item.borDtaMvto).toISOString() : '');
            return {
                borCod: item.borCod,
                filCod: item.filCod,
                situacao,
                finalizado: situacao === 'FINALIZADO',
                estornado: situacao === 'ESTORNADO',
                ...(criadoPor !== undefined ? { criadoPor } : {}),
                criadoEm,
                totalBaixado,
                baixas,
                daTrilha: baixasRows.length > 0,
            } satisfies BorderoResumo;
        });
        // Mais NOVO → mais velho: por data (criadoEm) desc; empate pelo maior borCod.
        return resumos.sort(
            (a, b) => (b.criadoEm ?? '').localeCompare(a.criadoEm ?? '') || b.borCod - a.borCod,
        );
    };

    /**
     * Baixas DE UM borderô lidas DO ERP (`fin010/baixas/list`) — para ver o detalhe de borderôs
     * lançados direto no Conexos (sem trilha local). O ERP expõe o lado invoice + valor líquido; o
     * lado-permuta (adiantamento/juros) não vem nesse list (fica só nos criados por nós).
     */
    public listarBaixasErp = async (params: {
        borCod: number;
        filCod: number;
    }): Promise<Array<{ invoiceDocCod: string; bxaCodSeq: number; valorLiquido?: number }>> => {
        const baixas = await this.conexosBaixaClient.listBaixas(params);
        return baixas.map((b) => ({
            invoiceDocCod: String(b.docCod),
            bxaCodSeq: b.bxaCodSeq,
            ...(b.bxaMnyLiquidoPermuta !== undefined
                ? { valorLiquido: b.bxaMnyLiquidoPermuta }
                : {}),
        }));
    };

    /**
     * REFRESH do cache de borderôs a partir do ERP — busca `fin010/list` (borVldTipo=2) de TODAS
     * as filiais e regrava `permuta_bordero`. Chamado pela ingestão e pelo botão "Atualizar".
     */
    public refreshCache = async (): Promise<void> => {
        const filiais = await this.conexosCadastroClient.listFiliais();
        const itensPorFilial = await Promise.all(
            filiais.map((f) =>
                this.conexosBaixaClient
                    .listBorderos({ filCod: f.filCod, pageSize: 1000 })
                    .catch(async (err) => {
                        await this.logService.warn({
                            type: LOG_TYPE.BUSINESS_WARN,
                            message: 'falha ao listar borderôs do ERP (filial segue vazia)',
                            data: {
                                filCod: f.filCod,
                                erro: err instanceof Error ? err.message : String(err),
                            },
                        });
                        return [];
                    }),
            ),
        );
        // Dedup por (filCod, borCod): o número do borderô é POR FILIAL — filiais diferentes podem ter
        // o mesmo número (ex.: 1824 na filial 1 e na 4). Dedupar só por borCod perdia um deles.
        const byBor = new Map<string, (typeof itensPorFilial)[number][number]>();
        for (const it of itensPorFilial.flat()) byBor.set(`${it.filCod}:${it.borCod}`, it);

        // Resgate dos borderôs DA NOSSA TRILHA que caíram fora do top-1000 recente da filial: filiais
        // com muitos borderôs empurram os antigos pra fora da janela por borCod, e o UNION `da_trilha`
        // do listBorderoCache NÃO os recupera (ele faz JOIN com este cache). Busca os faltantes por
        // `borCod#IN` (preciso, sem janela de recência), por filial, e mescla — garante que todo
        // borderô lançado pelo nosso painel apareça no histórico desde a primeira baixa.
        const faltantesPorFilial = new Map<number, Set<number>>();
        for (const r of await this.execucaoRepository.listComBordero()) {
            if (r.borCod === undefined || byBor.has(`${r.filCod}:${r.borCod}`)) continue;
            const set = faltantesPorFilial.get(r.filCod) ?? new Set<number>();
            set.add(r.borCod);
            faltantesPorFilial.set(r.filCod, set);
        }
        if (faltantesPorFilial.size > 0) {
            const extrasPorFilial = await Promise.all(
                [...faltantesPorFilial.entries()].map(([filCod, borCods]) =>
                    this.conexosBaixaClient
                        .listBorderos({ filCod, borCods: [...borCods] })
                        .catch(async (err) => {
                            await this.logService.warn({
                                type: LOG_TYPE.BUSINESS_WARN,
                                message:
                                    'falha ao resgatar borderôs da trilha p/ o cache (filial segue)',
                                data: {
                                    filCod,
                                    erro: err instanceof Error ? err.message : String(err),
                                },
                            });
                            return [];
                        }),
                ),
            );
            for (const it of extrasPorFilial.flat()) byBor.set(`${it.filCod}:${it.borCod}`, it);
        }

        await this.execucaoRepository.replaceBorderoCache(
            [...byBor.values()].map((it) => ({
                borCod: it.borCod,
                filCod: it.filCod,
                ...(it.borVldFinalizado !== undefined
                    ? { borVldFinalizado: it.borVldFinalizado }
                    : {}),
                borCodEstornado: it.borCodEstornado ?? null,
                ...(it.vlrTotalLiquido !== undefined
                    ? { vlrTotalLiquido: it.vlrTotalLiquido }
                    : {}),
                ...(it.borDtaMvto !== undefined ? { borDtaMvto: it.borDtaMvto } : {}),
                usnDesNomeCad: it.usnDesNomeCad ?? null,
            })),
        );
    };

    /**
     * STATUS PERMUTA→BORDERÔ (tela de permutas, consulta lazy). Para cada adiantamento com baixa
     * `settled` na trilha, resolve o status VIVO do borderô vinculado no fin010:
     *   - FINALIZADO   → `finalizado` (permuta concluída; continua aparecendo).
     *   - EM CADASTRO  → `aguardando-finalizacao` (baixado, falta finalizar o borderô).
     *   - CANCELADO/ESTORNADO/REMOVIDO/indisponível → OMITIDO → a permuta volta a "pendente"
     *     (reabre p/ execução), alinhado à idempotência viva do reconciliar.
     * Busca PRECISA por `borCod#IN` (não perde por paginação do fin010/list).
     */
    public statusPorAdiantamento = async (): Promise<Record<string, PermutaBorderoVinculo>> => {
        const rows = await this.execucaoRepository.listComBordero();
        // Um adto pode ter VÁRIOS borderôs settled (re-baixa após cancelar/estornar). Guardo TODOS
        // e, no fim, escolho o que está VÁLIDO no ERP (em cadastro/finalizado) — não o "último".
        const borCodsByAdto = new Map<string, Set<number>>();
        const borCodsPorFilial = new Map<number, Set<number>>();
        for (const r of rows) {
            if (r.status !== 'settled' || r.borCod === undefined) continue;
            const set = borCodsByAdto.get(r.adiantamentoDocCod) ?? new Set<number>();
            set.add(r.borCod);
            borCodsByAdto.set(r.adiantamentoDocCod, set);
            const fset = borCodsPorFilial.get(r.filCod) ?? new Set<number>();
            fset.add(r.borCod);
            borCodsPorFilial.set(r.filCod, fset);
        }
        if (borCodsByAdto.size === 0) return {};

        // Status vivo dos borderôs envolvidos (1 chamada por filial, filtrada por borCod#IN).
        const sitByBor = new Map<number, BorderoSituacao>();
        await Promise.all(
            [...borCodsPorFilial.entries()].map(async ([filCod, set]) => {
                try {
                    const itens = await this.conexosBaixaClient.listBorderos({
                        filCod,
                        borCods: [...set],
                    });
                    for (const it of itens) sitByBor.set(it.borCod, this.situacaoDoItem(it));
                } catch (err) {
                    await this.logService.warn({
                        type: LOG_TYPE.BUSINESS_WARN,
                        message: 'falha ao resolver status permuta→borderô (filial segue)',
                        data: { filCod, erro: err instanceof Error ? err.message : String(err) },
                    });
                }
            }),
        );

        const out: Record<string, PermutaBorderoVinculo> = {};
        for (const [adto, borCods] of borCodsByAdto) {
            // Entre os borderôs do adto, pega o VÁLIDO mais recente (maior borCod). Cancelado/
            // estornado/removido é ignorado → se nenhum válido, a permuta volta a "pendente".
            let escolhido: { borCod: number; situacao: BorderoSituacao } | undefined;
            for (const borCod of [...borCods].sort((a, b) => b - a)) {
                const situacao = sitByBor.get(borCod);
                if (situacao === 'FINALIZADO' || situacao === 'EM_CADASTRO') {
                    escolhido = { borCod, situacao };
                    break; // maior borCod válido = o atual
                }
            }
            if (!escolhido) continue;
            out[adto] = {
                borCod: escolhido.borCod,
                permutaStatus:
                    escolhido.situacao === 'FINALIZADO' ? 'finalizado' : 'aguardando-finalizacao',
                situacao: escolhido.situacao,
            };
        }
        return out;
    };

    /**
     * Situação OPERACIONAL do borderô (decisão Yuri 2026-06-24 — estorno removido da UI):
     * `borCodEstornado != null` ⇒ ESTORNADO — beco sem saída no ERP (não cancela/exclui). A tela
     * de borderôs marca como estornado (ações desabilitadas) e a PERMUTA é LIBERADA p/ novo
     * lançamento (`statusPorAdiantamento` ignora estornado → volta a pendente). Senão:
     * `borVldFinalizado` 1 = FINALIZADO, 2 = CANCELADO, 0/undefined = EM CADASTRO.
     */
    private situacaoDoItem = (item: {
        borVldFinalizado?: number;
        borCodEstornado?: number | null;
    }): BorderoSituacao => {
        if (item.borCodEstornado != null) return 'ESTORNADO';
        if (item.borVldFinalizado === 1) return 'FINALIZADO';
        if (item.borVldFinalizado === 2) return 'CANCELADO';
        return 'EM_CADASTRO';
    };
}
