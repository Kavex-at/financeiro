import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import ErpPerguntaError from '../../errors/ErpPerguntaError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import RemessaEmDuvidaError from '../../errors/RemessaEmDuvidaError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { ContaPagadora } from '../../interface/sispag/Fin015Write.js';
import { LOTE_STATUS, type LotePagamento } from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import LogService from '../LogService.js';

/** Código FEBRABAN a partir do `bncCod` interno do Conexos. */
const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };

/** Modalidade nativa do fin015: 1 = crédito em conta / transferência. */
const MODALIDADE_NATIVA: Record<string, number> = {
    CREDITO_CONTA: 1,
    TED: 1,
    PIX: 1,
    BOLETO: 7,
};

export interface GerarRemessaInput {
    loteId: string;
    ator: string;
    /** Estável por tentativa do usuário — é o que impede duas remessas para o mesmo lote. */
    idempotencyKey?: string;
    correlationId?: string;
    /** Força dry-run mesmo com escrita habilitada (preview sem tocar o ERP). */
    dryRunOverride?: boolean;
}

export interface GerarRemessaResult {
    status: 'gerada' | 'dry-run' | 'skipped';
    dryRun: boolean;
    writeEnabled: boolean;
    loteId: string;
    nativeFlpCod?: number;
    nativeGabCod?: number;
    arquivo?: string;
    numRemessa?: number;
    conteudo?: string;
    itens: number;
    valorTotal: number;
}

/**
 * RemessaService — orquestra a geração da remessa `.REM` de um `lote_pagamento` FINALIZADO,
 * dirigindo o lote NATIVO do Conexos (fin015).
 *
 * Sequência: `criarLote` → `importarTitulos` → `finalizarLote` → `gerarRemessa` → baixa o arquivo.
 *
 * ── POR QUE TANTA CERIMÔNIA ─────────────────────────────────────────────────────────────
 * As três escritas do fin015 NÃO são idempotentes: cada chamada cria registro novo. Um retry
 * após timeout gera um SEGUNDO LOTE DE PAGAMENTO — dinheiro saindo duas vezes. Por isso:
 *   - ledger write-ahead (`remessa_execucao`) grava a intenção ANTES do primeiro POST;
 *   - `settled` curto-circuita (nunca gera segunda remessa);
 *   - `reconciling` órfão é FAIL-CLOSED (`RemessaEmDuvidaError`) — exige olho humano;
 *   - o `flpCod` é persistido assim que o ERP o devolve, para achar o órfão depois.
 * Espelha `GerarSolicitacaoNumerarioService` (Recebimentos).
 *
 * ── INVARIANTES APRENDIDAS AO VIVO ──────────────────────────────────────────────────────
 *   - Filial do TÍTULO = filial do LOTE. O parser do `.RET` exige as duas iguais; item
 *     cross-filial NUNCA concilia (provado em HML, lote 26).
 *   - Título VENCIDO não entra: `finalizarLote` compara `itsDtaPgto` do item com a data de
 *     débito do lote. Com R1 (débito ≥ hoje) isso exclui atrasados.
 *   - Conta pagadora vem do `fin005` da FILIAL. `ccoCod` não é global.
 *   - A identidade do título vai VERBATIM do grid de pendentes.
 */
@injectable()
export default class RemessaService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(RemessaExecucaoRepository) private readonly ledger: RemessaExecucaoRepository,
        @inject(ConexosSispagWriteClient) private readonly write: ConexosSispagWriteClient,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public gerarRemessa = async (input: GerarRemessaInput): Promise<GerarRemessaResult> => {
        const lote = await this.loteRepo.getLoteComItens(input.loteId);
        if (!lote) {
            throw new LoteEstadoInvalidoError({
                loteId: input.loteId,
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
        if (lote.itens.length === 0) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'gerar remessa',
                motivo: 'O lote está vazio.',
            });
        }

        const env = await this.environmentProvider.getEnvironmentVars();
        const writeEnabled = env.conexosWriteEnabled;
        // `sispagLiveWriteEnabled` é o kill-switch DESTA frente: conter um bug do SISPAG
        // pelo `conexosDryRun` global desligaria Permutas e Recebimentos junto.
        const dryRun =
            !writeEnabled ||
            !env.sispagLiveWriteEnabled ||
            env.conexosDryRun ||
            input.dryRunOverride === true;

        // Chave estável por LOTE: duas tentativas para o mesmo lote colidem de propósito.
        const key = input.idempotencyKey ?? `remessa:${lote.id}`;
        const valorTotal = lote.itens.reduce((acc, i) => acc + Number(i.valor ?? 0), 0);

        // ── Idempotência ────────────────────────────────────────────────────
        const anterior = await this.ledger.findByIdempotencyKey(key);
        if (anterior?.status === 'settled') {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'remessa já gerada — curto-circuito idempotente',
                data: { loteId: lote.id, nativeFlpCod: anterior.nativeFlpCod },
            });
            return {
                status: 'skipped',
                dryRun: false,
                writeEnabled,
                loteId: lote.id,
                ...(anterior.nativeFlpCod !== undefined ? { nativeFlpCod: anterior.nativeFlpCod } : {}),
                ...(anterior.nativeGabCod !== undefined ? { nativeGabCod: anterior.nativeGabCod } : {}),
                itens: lote.itens.length,
                valorTotal,
            };
        }
        // FAIL-CLOSED: execução anterior em voo que nunca confirmou.
        if (anterior && !anterior.dryRun && anterior.status === 'reconciling') {
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'remessa EM DÚVIDA (reconciling órfão) — NÃO re-POSTada',
                data: { loteId: lote.id, key, nativeFlpCod: anterior.nativeFlpCod, etapa: anterior.etapa },
            });
            throw new RemessaEmDuvidaError({
                loteId: lote.id,
                idempotencyKey: key,
                ...(anterior.nativeFlpCod !== undefined
                    ? { nativeFlpCod: anterior.nativeFlpCod }
                    : {}),
                ...(anterior.etapa !== undefined ? { etapa: anterior.etapa } : {}),
                // Sem `flpCod` o operador precisa de coordenadas para varrer o fin015:
                // é a janela entre o `criarLote` responder e o ledger gravar.
                ...(anterior.filCod !== undefined ? { filCod: anterior.filCod } : {}),
                ...(anterior.bncCod !== undefined ? { bncCod: anterior.bncCod } : {}),
                ...(anterior.criadoEm !== undefined ? { criadoEm: anterior.criadoEm } : {}),
            });
        }

        // ── Conta pagadora da FILIAL (nunca fixa) ───────────────────────────
        const contas = await this.sispag.listContasCorrentes(lote.filCod);
        const cc = lote.conta
            ? contas.find((c) => `${c.numeroConta}-${c.dvConta ?? ''}` === lote.conta)
            : undefined;
        const escolhida = cc ?? contas[0];
        if (!escolhida) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'gerar remessa',
                motivo: `Nenhuma conta pagadora cadastrada no fin005 para a filial ${lote.filCod}.`,
            });
        }
        const bncCod = escolhida.bncCod;
        const contaFmt = `${escolhida.numeroConta}-${escolhida.dvConta ?? ''}`;
        const contaPagadora: ContaPagadora = {
            bncCod,
            bncNumCodbanco: FEBRABAN_POR_BNCCOD[bncCod] ?? 341,
            ccoCod: escolhida.ccoCod,
            ccoNumConta: Number(escolhida.numeroConta),
            ccoEspDvconta: String(escolhida.dvConta ?? ''),
            ccoEspAgcod: String(escolhida.agencia ?? ''),
            conta: contaFmt,
            layoutConta: `AG:${escolhida.agencia}/CT:${contaFmt}`,
        };
        const dataDebito = this.hojeUtc();

        // ── DRY-RUN: monta e loga, sem tocar o ERP ──────────────────────────
        if (dryRun) {
            await this.ledger.beginExecution({
                idempotencyKey: key,
                ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
                loteId: lote.id,
                filCod: lote.filCod,
                bncCod,
                dryRun: true,
                executadoPor: input.ator,
            });
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'remessa DRY-RUN (nenhuma escrita no Conexos)',
                data: {
                    loteId: lote.id,
                    filCod: lote.filCod,
                    contaPagadora,
                    dataDebito,
                    itens: lote.itens.length,
                    valorTotal,
                },
            });
            return {
                status: 'dry-run',
                dryRun: true,
                writeEnabled,
                loteId: lote.id,
                itens: lote.itens.length,
                valorTotal,
            };
        }

        // ── ESCRITA REAL ────────────────────────────────────────────────────
        await this.ledger.beginExecution({
            idempotencyKey: key,
            ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
            loteId: lote.id,
            filCod: lote.filCod,
            bncCod,
            dryRun: false,
            executadoPor: input.ator,
        });

        // REAPROVEITA o lote nativo de uma tentativa anterior que falhou.
        //
        // Sem isto, cada retry criava OUTRO lote no ERP: a falha marca o ledger como
        // `error`, o que não bloqueia (só `settled` e `reconciling` bloqueiam), e a
        // sequência recomeça do `criarLote`. Dois cliques na tela = dois lotes órfãos,
        // que foi exatamente o que aconteceu em HML (flp 1 e flp 2).
        //
        // O lote nativo vazio é reaproveitável com segurança: ele só ganha itens no
        // passo seguinte, e a falha anterior aconteceu ANTES de qualquer import.
        let flpCod: number | undefined = anterior?.nativeFlpCod;
        try {
            if (flpCod !== undefined) {
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message: 'reaproveitando lote nativo de tentativa anterior',
                    data: { loteId: lote.id, flpCod, etapaAnterior: anterior?.etapa },
                });
            } else {
                // (1) lote nativo
                const criado = await this.write.criarLote({
                    filCod: lote.filCod,
                    conta: contaPagadora,
                    dataDebito,
                });
                flpCod = criado.flpCod;
            }
            // Persistido ANTES do próximo POST: se morrer aqui, é a pista do lote órfão.
            await this.ledger.setNativeFlpCod(key, flpCod);
            await this.loteRepo.setChavesNativas({
                loteId: lote.id,
                nativeFilCod: lote.filCod,
                nativeBncCod: bncCod,
                nativeFlpCod: flpCod,
                ccoCod: escolhida.ccoCod,
                ...(escolhida.gerNum !== undefined ? { gerNum: escolhida.gerNum } : {}),
            });

            // (2) importar: identidade VERBATIM do grid de pendentes do ERP.
            // Se algum título não for elegível, isto lança ANTES de qualquer escrita no
            // lote — e o lote nativo vazio fica registrado no ledger para ser reusado na
            // próxima tentativa, em vez de virar órfão.
            const itens = await this.montarItensImport(lote, bncCod, flpCod);
            await this.ledger.setRequestPayload(key, { itens: itens.length, flpCod });
            await this.write.importarTitulos({
                filCod: lote.filCod,
                bncCod,
                flpCod,
                itens,
            });
            await this.ledger.setEtapa(key, 'finalizar');

            // (3) finalizar (o ERP valida R1 e a regra do itsDtaPgto)
            await this.write.finalizarLote({ filCod: lote.filCod, bncCod, flpCod });
            await this.ledger.setEtapa(key, 'gerar_remessa');

            // (4) gerar a remessa. `seqNum`/nome vêm do próprio ERP — a numeração é controle
            // bancário e não pode ser inventada.
            const sugerido = await this.write.sugerirRemessa({
                filCod: lote.filCod,
                bncCod,
                ccoCod: escolhida.ccoCod,
            });
            await this.write.gerarRemessa({
                filCod: lote.filCod,
                bncCod,
                flpCod,
                grbCodSeq: 1,
                seqNum: sugerido.numRemessa,
                gabEspNomeArquivo: sugerido.nomeArquivo,
            });

            // (5) localizar o arquivo PELO NOME. Nunca pelo "primeiro com conteúdo": o ERP
            // recicla `flpCod` e a lista pode conter arquivos órfãos de lotes antigos.
            const arquivos = await this.write.listarArquivosRemessa({
                filCod: lote.filCod,
                bncCod,
                flpCod,
            });
            const arquivo = arquivos.find((a) => a.nomeArquivo === sugerido.nomeArquivo);
            if (!arquivo) {
                throw new Error(
                    `remessa gerada mas o arquivo "${sugerido.nomeArquivo}" não foi encontrado entre ${arquivos.length} do lote`,
                );
            }

            await this.loteRepo.setRemessaGerada({
                loteId: lote.id,
                gabCod: arquivo.gabCod,
                arquivo: sugerido.nomeArquivo,
                numRemessa: sugerido.numRemessa,
            });
            await this.loteRepo.transicionarStatus({
                id: lote.id,
                de: [LOTE_STATUS.FINALIZADO],
                para: LOTE_STATUS.REMESSA_GERADA,
                versaoEsperada: lote.versao,
            });
            await this.ledger.settle(key, { nativeGabCod: arquivo.gabCod });

            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'remessa gerada',
                data: {
                    loteId: lote.id,
                    flpCod,
                    gabCod: arquivo.gabCod,
                    arquivo: sugerido.nomeArquivo,
                    itens: itens.length,
                    valorTotal,
                },
            });

            return {
                status: 'gerada',
                dryRun: false,
                writeEnabled,
                loteId: lote.id,
                nativeFlpCod: flpCod,
                nativeGabCod: arquivo.gabCod,
                arquivo: sugerido.nomeArquivo,
                numRemessa: sugerido.numRemessa,
                ...(arquivo.conteudo !== undefined ? { conteudo: arquivo.conteudo } : {}),
                itens: itens.length,
                valorTotal,
            };
        } catch (e) {
            const mensagem = e instanceof Error ? e.message : String(e);
            await this.ledger.fail(key, { mensagem });
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao gerar remessa',
                data: { loteId: lote.id, flpCod, mensagem },
            });
            throw e;
        }
    };

    /**
     * Monta os itens de import a partir do grid de pendentes do ERP. A identidade tem que ir
     * VERBATIM (o grid cruza filiais; reescrever `filCod` devolve `Not Found: FinTituloPag`),
     * enriquecida com a modalidade escolhida e o destino do favorecido (`cmn025`).
     */
    private montarItensImport = async (
        lote: LotePagamento,
        bncCod: number,
        flpCod: number,
    ): Promise<Array<Record<string, unknown>>> => {
        // As chaves do lote deixam o cliente parar assim que achar todas, em vez de varrer
        // o grid inteiro — e garantem que ele NÃO pare na primeira página se faltar alguma.
        const chavesDesejadas = new Set(lote.itens.map((i) => `${i.docCod}:${i.titCod}`));
        const pendentes = await this.write.listarTitulosPendentes({
            filCod: lote.filCod,
            bncCod,
            flpCod,
            pageSize: 500,
            chavesDesejadas,
        });
        const porChave = new Map(pendentes.map((p) => [`${p.docCod}:${p.titCod}`, p]));
        const febraban = FEBRABAN_POR_BNCCOD[bncCod] ?? 341;
        const itens: Array<Record<string, unknown>> = [];

        for (const item of lote.itens) {
            const pendente = porChave.get(`${item.docCod}:${item.titCod}`);
            if (!pendente) {
                throw new Error(
                    `título ${item.docCod}/${item.titCod} não está mais elegível no Conexos — pode já ter sido pago ou entrado em outro lote`,
                );
            }
            if (Number(pendente.raw.filCod) !== lote.filCod) {
                throw new Error(
                    `título ${item.docCod}/${item.titCod} é da filial ${pendente.raw.filCod}, mas o lote é da ${lote.filCod}. Item cross-filial nunca concilia o retorno.`,
                );
            }

            const pesCod = pendente.raw.pesCod;
            const contas = pesCod != null
                ? await this.sispag.listContasFavorecido(String(pesCod), lote.filCod)
                : [];
            const noBanco = contas.filter((c) => c.banco === febraban);
            const destino = noBanco.find((c) => c.padrao) ?? noBanco[0];
            if (!destino) {
                throw new Error(
                    `favorecido de ${item.docCod}/${item.titCod} não tem conta ativa no banco ${febraban}. Cadastre a conta ou escolha outra forma de pagamento.`,
                );
            }

            const valor = Number(pendente.raw.titMnyValor ?? item.valor ?? 0);
            const selecao = {
                op: 1,
                bncCodFin015: bncCod,
                titVldReflexoDdaAssoc: 0,
                titVldReflexoDdaDesassoc: 0,
            };
            itens.push({
                ...pendente.raw,
                filCodLote: lote.filCod,
                bncCod,
                flpCod,
                itsVldModalidade: MODALIDADE_NATIVA[item.modalidade ?? 'CREDITO_CONTA'] ?? 1,
                pctCodSeq: destino.pctCodSeq,
                itsNumBanco: destino.banco,
                agencia: destino.agencia ?? '',
                pctEspNumAgencia: destino.agencia ?? '',
                conta: destino.conta ?? '',
                itsEspNomeFav: pendente.raw.dpeNomPessoa ?? item.credor,
                itsMnyValor: valor,
                itsMnyVlrPgto: valor,
                titMnyLiquido: valor,
                itsDtaPgto: Number(pendente.raw.titDtaVencimento ?? 0),
                vldOk: 1,
                vldImporta: 1,
                titEspCodbar: pendente.raw.titEspCodbar ?? '',
                avisos: '[]',
                ...selecao,
            });
        }
        return itens;
    };

    /** Meia-noite UTC de hoje — R1 exige data de débito ≥ hoje. */
    private hojeUtc = (): number => {
        const d = new Date();
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    /**
     * Conteúdo do `.REM` já gerado de um lote. Busca PELO NOME registrado — nunca "o primeiro
     * com conteúdo": o ERP recicla `flpCod`, e a lista de um lote novo pode trazer arquivos
     * órfãos de lotes antigos. Foi assim que um `.REM` de outro mês foi lido (e cancelado)
     * por engano em produção.
     */
    public baixarArquivo = async (
        loteId: string,
    ): Promise<{ nomeArquivo: string; conteudo: string } | null> => {
        const lote = await this.loteRepo.getLoteComItens(loteId);
        if (!lote?.nativeFlpCod || !lote.nativeBncCod || !lote.remessaArquivo) return null;
        const arquivos = await this.write.listarArquivosRemessa({
            filCod: lote.nativeFilCod ?? lote.filCod,
            bncCod: lote.nativeBncCod,
            flpCod: lote.nativeFlpCod,
        });
        const arquivo = arquivos.find((a) => a.nomeArquivo === lote.remessaArquivo);
        if (!arquivo?.conteudo) return null;
        return { nomeArquivo: lote.remessaArquivo, conteudo: arquivo.conteudo };
    };

}
