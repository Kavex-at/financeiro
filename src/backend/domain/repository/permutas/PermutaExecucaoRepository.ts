import { inject, injectable } from 'tsyringe';
import ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';

/**
 * Status de UMA execução de baixa (par adto↔invoice).
 *
 * `settled` e `parcial` são os DOIS terminais (ADR-0044): `settled` afirma "o alocado foi
 * integralmente baixado"; `parcial` afirma "houve baixa confirmada, mas sobrou resíduo"
 * (`valor_residual_usd`). Nenhum dos dois regride em `beginExecution` — o critério é "houve
 * escrita irreversível no ERP sob esta chave?". `pending`/`error` são reabríveis.
 *
 * ⚠️ Espelhado À MÃO em `src/frontend/lib/types.ts` (`ExecucaoStatus`) — os projetos são
 * separados e nada força a paridade no compilador; a guarda é `src/frontend/lib/types.test.ts`.
 */
export type ExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error' | 'parcial';

/** Linha de execução da baixa/permuta no ERP (Fase 3 — auditoria/idempotência). */
export interface ExecucaoRow {
    idempotencyKey: string;
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    filCod: number;
    status: ExecucaoStatus;
    dryRun: boolean;
    borCod?: number;
    bxaCodSeq?: number;
    valorBaixado?: number;
    juros?: number;
    contaJuros?: number;
    /** Resíduo NÃO baixado do valor alocado, em moeda negociada. Só em `parcial` (I-Recon-6). */
    valorResidualUsd?: number;
    erpResponse?: unknown;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm: Date;
    atualizadoEm: Date;
}

/**
 * Execução que o ERP JÁ ABATEU do `mnyTitPermutar` do adiantamento (ADR-0046 D3): real, terminal
 * (`settled`/`parcial`), num borderô FINALIZADO e não estornado, que o cache viu finalizado ANTES
 * do início da ingestão que carimbou o `valorPermutar` do adto (guarda de frescor).
 */
export interface ConsumoExecucaoRow {
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    status: 'settled' | 'parcial';
    /** Resíduo NÃO baixado, em moeda negociada. Só em `parcial`. */
    valorResidualUsd?: number;
    criadoEm: Date;
}

/** Linha do cache local de borderô (campos crus do ERP; situação derivada na leitura). */
export interface BorderoCacheRow {
    borCod: number;
    filCod: number;
    borVldFinalizado?: number;
    borCodEstornado?: number | null;
    vlrTotalLiquido?: number;
    borDtaMvto?: number;
    usnDesNomeCad?: string | null;
}

export interface BeginExecutionInput {
    idempotencyKey: string;
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    filCod: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginExecutionResult {
    /** Status APÓS o upsert. Terminal (`settled`/`parcial`) ⇒ já executada (idempotência) — pular. */
    status: ExecucaoStatus;
    /**
     * TRUE quando a linha já estava num TERMINAL (`settled` OU `parcial`) antes desta chamada.
     * O nome guarda a história (nasceu só com `settled`); a semântica é "já houve escrita
     * irreversível sob esta chave" — e em `parcial` houve (ADR-0044).
     */
    alreadySettled: boolean;
}

/**
 * PermutaExecucaoRepository — trilha de execução da baixa/permuta no `fin010` (Fase 3).
 *
 * Write-ahead: `insertIntent` grava a intenção (status `reconciling`) ANTES do POST; só
 * `markSettled` (após confirmação do ERP) a torna `settled`; `markError` registra a falha
 * com a resposta crua para reconciliação manual. `findByIdempotencyKey` dá a idempotência
 * (re-execução com a mesma chave curto-circuita). SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class PermutaExecucaoRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
        @inject(ConexosIdentityProvider)
        private identityProvider: ConexosIdentityProvider,
    ) {}

    public findByIdempotencyKey = async (key: string): Promise<ExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, valor_residual_usd,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    public listByAdiantamento = async (adiantamentoDocCod: string): Promise<ExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, valor_residual_usd,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE adiantamento_doc_cod = $adtoDocCod
             ORDER BY criado_em`,
            { adtoDocCod: adiantamentoDocCod },
        );
        return rows.map((r) => this.mapRow(r));
    };

    /**
     * `bor_cod` de uma execução REAL (não dry-run) que abriu um borderô VIVO para o par adto↔invoice —
     * ou `null`. Insumo da trava que IMPEDE remover uma alocação já usada num borderô (integridade
     * trilha × ERP). Inclui baixas `error` num borderô real (o borderô existe).
     *
     * IGNORA borderôs CANCELADOS (`permuta_bordero.bor_vld_finalizado = 2`): cancelar estorna a baixa no
     * ERP → a alocação volta a estar livre → não deve travar. Borderô EXCLUÍDO já some da trilha
     * (`deleteByBorCod`). Em cadastro / finalizado / estornado seguem TRAVANDO (baixa viva).
     */
    public borderoDoPar = async (
        adiantamentoDocCod: string,
        invoiceDocCod: string,
    ): Promise<number | null> => {
        const row = await this.databaseClient.selectFirst<{ bor_cod: number }>(
            `SELECT e.bor_cod
             FROM permuta_alocacao_execucao e
             WHERE e.adiantamento_doc_cod = $adtoDocCod
               AND e.invoice_doc_cod = $invoiceDocCod
               AND e.dry_run = false
               AND e.bor_cod IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM permuta_bordero b
                   WHERE b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod
                     AND b.bor_vld_finalizado = 2
               )
             ORDER BY e.criado_em DESC
             LIMIT 1`,
            { adtoDocCod: adiantamentoDocCod, invoiceDocCod },
        );
        return row ? Number(row.bor_cod) : null;
    };

    /** Todas as execuções que geraram borderô (bor_cod não nulo), p/ a tela de gestão de borderôs. */
    public listComBordero = async (): Promise<ExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, valor_residual_usd,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE bor_cod IS NOT NULL
             ORDER BY bor_cod DESC, criado_em`,
        );
        return rows.map((r) => this.mapRow(r));
    };

    /**
     * Execuções que o ERP JÁ ABATEU do saldo a permutar do adiantamento (ADR-0046 D3) — insumo
     * único do `SaldoAlocacaoAdiantamentoService`. Sem `adiantamentoDocCod`, devolve de todos (a
     * tela de gestão faz UMA query para o painel inteiro).
     *
     * "Consumida" exige, AO MESMO TEMPO:
     *   - execução real e terminal (`dry_run = false`, `settled`/`parcial`);
     *   - borderô no cache, por PAR (fil_cod, bor_cod), FINALIZADO (`bor_vld_finalizado = 1`) e não
     *     estornado (`bor_cod_estornado IS NULL`) — o ERP só abate quando o borderô é finalizado;
     *     borderô fora do cache (status desconhecido) não conta (conservador);
     *   - **guarda de frescor:** o cache viu o borderô finalizado ANTES do início da ingestão que
     *     carimbou o `valorPermutar` do adto (`b.atualizado_em < r.started_at`). Sem ela, logo depois
     *     do "Finalizar" do painel (que grava `1` no cache na hora) a execução contaria como
     *     consumida sobre um `valorPermutar` ainda NÃO abatido, e o saldo voltaria cheio até a
     *     próxima ingestão. O `replaceBorderoCache` só renova o carimbo quando a situação muda.
     */
    public listConsumosFinalizados = async (
        adiantamentoDocCod?: string,
    ): Promise<ConsumoExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT e.adiantamento_doc_cod, e.invoice_doc_cod, e.status, e.valor_residual_usd,
                    e.criado_em
             FROM permuta_alocacao_execucao e
             JOIN permuta_bordero b ON b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod
             JOIN permuta_adiantamento a ON a.doc_cod = e.adiantamento_doc_cod
             JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id
             WHERE e.dry_run = false
               AND e.status IN ('settled', 'parcial')
               AND b.bor_vld_finalizado = 1
               AND b.bor_cod_estornado IS NULL
               AND b.atualizado_em < r.started_at
               AND ($adtoDocCod::text IS NULL OR e.adiantamento_doc_cod = $adtoDocCod)
             ORDER BY e.adiantamento_doc_cod, e.criado_em`,
            { adtoDocCod: adiantamentoDocCod ?? null },
        );
        return rows.flatMap((r) => {
            const consumo = this.mapConsumo(r);
            return consumo !== null ? [consumo] : [];
        });
    };

    /**
     * Filiais em que a trilha conhece ESTE número de borderô — a consulta de DESCOBERTA.
     *
     * `bor_cod` é sequencial POR FILIAL: o mesmo número existe em filiais diferentes ao mesmo
     * tempo (medido 2026-09-11: bor 2436 na filial 1, bor 2771 na filial 4). As rotas de ação
     * recebem só o número, então alguém precisa resolver a filial — e essa resolução pode ser
     * AMBÍGUA. Devolver a lista (em vez de "a" filial) é o que deixa a ambiguidade visível para
     * quem chama decidir, em vez de escolher a primeira linha em silêncio.
     */
    public listFiliaisDaTrilha = async (borCod: number): Promise<number[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT DISTINCT fil_cod
             FROM permuta_alocacao_execucao
             WHERE bor_cod = $borCod
             ORDER BY fil_cod`,
            { borCod },
        );
        return rows.map((r) => Number(r.fil_cod));
    };

    /**
     * Busca a execução (baixa) de um borderô por invoice — p/ exclusão da baixa específica.
     * ESCOPADO POR FILIAL: ver `listFiliaisDaTrilha` (o nº do borderô é por filial).
     */
    public findByBorCodInvoice = async (
        filCod: number,
        borCod: number,
        invoiceDocCod: string,
    ): Promise<ExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, valor_residual_usd,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE fil_cod = $filCod AND bor_cod = $borCod AND invoice_doc_cod = $invoiceDocCod
             LIMIT 1`,
            { filCod, borCod, invoiceDocCod },
        );
        return row ? this.mapRow(row) : null;
    };

    /**
     * Remove a linha de execução de uma baixa (após excluí-la no ERP).
     * ESCOPADO POR FILIAL: ver `listFiliaisDaTrilha`.
     */
    public deleteByBorCodInvoice = async (
        filCod: number,
        borCod: number,
        invoiceDocCod: string,
    ): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_alocacao_execucao
             WHERE fil_cod = $filCod AND bor_cod = $borCod AND invoice_doc_cod = $invoiceDocCod`,
            { filCod, borCod, invoiceDocCod },
        );
    };

    /**
     * Todas as baixas (linhas) de um borderô — p/ excluir o borderô inteiro.
     * ESCOPADO POR FILIAL: ver `listFiliaisDaTrilha`.
     */
    public listByBorCod = async (filCod: number, borCod: number): Promise<ExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, valor_residual_usd,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE fil_cod = $filCod AND bor_cod = $borCod
             ORDER BY criado_em`,
            { filCod, borCod },
        );
        return rows.map((r) => this.mapRow(r));
    };

    /**
     * Quantas baixas o borderô ainda tem na trilha (0 ⇒ borderô vazio → apagar).
     * ESCOPADO POR FILIAL: ver `listFiliaisDaTrilha`. Sem a filial, a contagem somaria as baixas
     * do borderô homônimo de OUTRA filial e o casco vazio nunca seria apagado.
     */
    public countByBorCod = async (filCod: number, borCod: number): Promise<number> => {
        const row = await this.databaseClient.selectFirst<{ n: string | number }>(
            `SELECT count(*) AS n FROM permuta_alocacao_execucao
              WHERE fil_cod = $filCod AND bor_cod = $borCod`,
            { filCod, borCod },
        );
        return row ? Number(row.n) : 0;
    };

    /**
     * Remove todas as linhas de um borderô (após excluir o borderô no ERP).
     * ESCOPADO POR FILIAL: ver `listFiliaisDaTrilha`. Este é o DELETE — sem a filial ele apagava
     * a trilha inteira do borderô homônimo de outra filial, cujo borderô segue VIVO no ERP.
     */
    public deleteByBorCod = async (filCod: number, borCod: number): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_alocacao_execucao
              WHERE fil_cod = $filCod AND bor_cod = $borCod`,
            { filCod, borCod },
        );
    };

    /**
     * Zera o `bor_cod` das execuções com ERRO que apontam para um borderô APAGADO no ERP
     * (I-Write-7). O `markError` grava o `bor_cod` antes de a limpeza anti-órfão rodar, então
     * sem isto o número fica pendurado — e o ERP REAPROVEITA o código, fazendo o painel mostrar
     * ao analista um borderô que hoje é de outro fornecedor (medido 2026-09-11: o borderô 2771
     * da execução 399 hoje contém baixas do doc 6708; o 2436 da execução 341, do doc 5155).
     *
     * Só toca linhas `error`: `settled`/`parcial` apontam para borderô VIVO, com dinheiro movido.
     *
     * ESCOPADO POR FILIAL de propósito: o `bor_cod` é sequencial POR FILIAL, então o mesmo número
     * existe em filiais diferentes ao mesmo tempo (medido: bor 2436 na filial 1 e bor 2771 na
     * filial 4). Limpar só por número apagaria o ponteiro de uma execução de OUTRA filial cujo
     * borderô está vivo. As irmãs `listByBorCod`/`countByBorCod`/`deleteByBorCod`/
     * `findByBorCodInvoice`/`deleteByBorCodInvoice` seguem o MESMO escopo desde 2026-09-22; a
     * resolução do número → filial é `listFiliaisDaTrilha`.
     */
    public clearBorCod = async (filCod: number, borCod: number): Promise<number> => {
        return this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao
                SET bor_cod = NULL, atualizado_em = now()
              WHERE bor_cod = $borCod AND fil_cod = $filCod AND status = 'error'`,
            { filCod, borCod },
        );
    };

    /** Remove a execução por chave de idempotência (libera re-baixa quando o borderô virou nulo). */
    public deleteByKey = async (idempotencyKey: string): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_alocacao_execucao WHERE idempotency_key = $key`,
            { key: idempotencyKey },
        );
    };

    /**
     * Renomeia a chave de idempotência — libera a chave original para um RELANÇAMENTO sem perder a
     * linha antiga (o borderô cancelado/estornado continua na trilha p/ histórico).
     */
    public renameKey = async (oldKey: string, newKey: string): Promise<number> => {
        return this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET idempotency_key = $newKey WHERE idempotency_key = $oldKey`,
            { oldKey, newKey },
        );
    };

    /**
     * Write-ahead: abre (ou reabre) a execução de um par adto↔invoice.
     * - Linha nova → status `reconciling` (real) ou `pending` (dry-run).
     * - Linha existente NÃO-terminal (`pending`/`reconciling`/`error`) → reaberta (retry).
     * - Linha TERMINAL (`settled` ou `parcial`) → PRESERVADA: não regride. `alreadySettled=true`.
     *   `parcial` entra aqui porque as baixas dos títulos consumidos JÁ estão no ERP (ADR-0044):
     *   re-POSTar seria super-pagamento. O resíduo se resolve RE-ALOCANDO o par (chave nova).
     */
    public beginExecution = async (input: BeginExecutionInput): Promise<BeginExecutionResult> => {
        const newStatus: ExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO permuta_alocacao_execucao (
                idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod,
                status, dry_run, executado_por, conexos_username, conexos_usn_cod, atualizado_em
            ) VALUES (
                $key, $adtoDocCod, $invoiceDocCod, $filCod,
                $newStatus, $dryRun, $executadoPor, $conexosUsername, $conexosUsnCod, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN permuta_alocacao_execucao.status IN ('settled', 'parcial')
                              THEN permuta_alocacao_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN permuta_alocacao_execucao.status IN ('settled', 'parcial')
                               THEN permuta_alocacao_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN permuta_alocacao_execucao.status IN ('settled', 'parcial')
                               THEN permuta_alocacao_execucao.executado_por ELSE EXCLUDED.executado_por END,
                -- Identidade do ERP segue a mesma doutrina do executado_por: linha TERMINAL
                -- NUNCA reescreve quem assinou a escrita (ADR-0041).
                conexos_username = CASE WHEN permuta_alocacao_execucao.status IN ('settled', 'parcial')
                               THEN permuta_alocacao_execucao.conexos_username ELSE EXCLUDED.conexos_username END,
                conexos_usn_cod = CASE WHEN permuta_alocacao_execucao.status IN ('settled', 'parcial')
                               THEN permuta_alocacao_execucao.conexos_usn_cod ELSE EXCLUDED.conexos_usn_cod END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                adtoDocCod: input.adiantamentoDocCod,
                invoiceDocCod: input.invoiceDocCod,
                filCod: input.filCod,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
                ...this.identityProvider.currentParams(),
            },
        );
        const status = (row?.status ?? newStatus) as ExecucaoStatus;
        // `newStatus` nunca é terminal (só markSettled/markParcial gravam isso). Logo, um
        // 'settled'/'parcial' retornado = a linha JÁ estava terminal e foi preservada.
        return { status, alreadySettled: status === 'settled' || status === 'parcial' };
    };

    /** Persiste o borCod assim que o borderô é criado (recuperação de órfão, Regis F-availability-1). */
    public setBorCod = async (key: string, borCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao
             SET bor_cod = $borCod, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, borCod },
        );
    };

    public setRequestPayload = async (key: string, payload: unknown): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao
             SET request_payload = $payload::jsonb, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, payload: JSON.stringify(payload ?? null) },
        );
    };

    public markSettled = async (
        key: string,
        data: {
            borCod?: number;
            bxaCodSeq?: number;
            valorBaixado?: number;
            juros?: number;
            contaJuros?: number;
            erpResponse?: unknown;
        },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET
                status = 'settled',
                bor_cod = $borCod,
                bxa_cod_seq = $bxaCodSeq,
                valor_baixado = $valorBaixado,
                juros = $juros,
                conta_juros = $contaJuros,
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                -- COALESCE: no write-ahead a sessão podia ainda não ter sido resolvida;
                -- aqui já foi. Nunca sobrescreve uma identidade já registrada (ADR-0041).
                conexos_username = COALESCE(conexos_username, $conexosUsername),
                conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                borCod: data.borCod ?? null,
                bxaCodSeq: data.bxaCodSeq ?? null,
                valorBaixado: data.valorBaixado ?? null,
                juros: data.juros ?? null,
                contaJuros: data.contaJuros ?? null,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                ...this.identityProvider.currentParams(),
            },
        );
    };

    /**
     * IRMÃO de `markSettled`, não um parâmetro a mais dele: os dois terminais AFIRMAM COISAS
     * DIFERENTES. `settled` afirma "o alocado foi integralmente baixado"; `parcial` afirma "houve
     * baixa confirmada no ERP, e sobrou `valorResidualUsd` (moeda negociada) para re-alocar".
     * Colapsá-los num campo opcional convidaria justamente o `settled` mudo que a ADR-0044 mata.
     *
     * I-Recon-2 vale igual aqui: só existe `parcial` sobre baixa confirmada (`bxaCodSeq`).
     * Ver `business-rules/idempotencia-reconciliacao.md` (I-Recon-6/7) e I-Write-8b.
     */
    public markParcial = async (
        key: string,
        data: {
            borCod?: number;
            bxaCodSeq?: number;
            valorBaixado?: number;
            juros?: number;
            contaJuros?: number;
            /** Resíduo NÃO baixado do valor alocado, em moeda negociada. */
            valorResidualUsd: number;
            erpResponse?: unknown;
        },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET
                status = 'parcial',
                bor_cod = $borCod,
                bxa_cod_seq = $bxaCodSeq,
                valor_baixado = $valorBaixado,
                juros = $juros,
                conta_juros = $contaJuros,
                valor_residual_usd = $valorResidualUsd,
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                -- Mesma doutrina do markSettled: nunca sobrescreve identidade já registrada (ADR-0041).
                conexos_username = COALESCE(conexos_username, $conexosUsername),
                conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                borCod: data.borCod ?? null,
                bxaCodSeq: data.bxaCodSeq ?? null,
                valorBaixado: data.valorBaixado ?? null,
                juros: data.juros ?? null,
                contaJuros: data.contaJuros ?? null,
                valorResidualUsd: data.valorResidualUsd,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                ...this.identityProvider.currentParams(),
            },
        );
    };

    public markError = async (
        key: string,
        data: { erroMensagem: string; erpResponse?: unknown; borCod?: number },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET
                status = 'error',
                erro_mensagem = $erroMensagem,
                erp_response = $erpResponse::jsonb,
                bor_cod = COALESCE($borCod, bor_cod),
                conexos_username = COALESCE(conexos_username, $conexosUsername),
                conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                erroMensagem: data.erroMensagem,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                borCod: data.borCod ?? null,
                ...this.identityProvider.currentParams(),
            },
        );
    };

    // ───────────────────────── Cache de borderôs (perf — tabela `permuta_bordero`) ─────────────
    // A tela de Borderôs lê deste cache (rápido) em vez de bater no ERP. Atualizado pela ingestão
    // e pelo "Atualizar". Guarda os campos crus; a situação é derivada na leitura.

    public listBorderoCache = async (limit?: number): Promise<BorderoCacheRow[]> => {
        // LIMIT é inteiro interno (não vem do cliente) → seguro inline. Pega os MAIS RECENTES
        // (por data de movimento) p/ a tela carregar rápido mesmo com milhares de borderôs. PORÉM
        // os borderôs criados por ESTE sistema (presentes na trilha `permuta_alocacao_execucao`)
        // são SEMPRE incluídos, mesmo que caiam fora dos N mais recentes — senão um borderô da
        // plataforma "envelhece para fora da tela" e some da busca/dropdown (o operador não acha
        // mais o que ele mesmo lançou). A trilha é pequena, então o UNION é barato.
        const lim = limit && Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20000) : null;
        const rows = await this.databaseClient.selectMany(
            `WITH recentes AS (
                 SELECT bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado, vlr_total_liquido,
                        bor_dta_mvto, usn_des_nome_cad
                 FROM permuta_bordero
                 ORDER BY bor_dta_mvto DESC NULLS LAST, bor_cod DESC
                 ${lim != null ? `LIMIT ${lim}` : ''}
             ),
             da_trilha AS (
                 SELECT DISTINCT pb.bor_cod, pb.fil_cod, pb.bor_vld_finalizado, pb.bor_cod_estornado,
                        pb.vlr_total_liquido, pb.bor_dta_mvto, pb.usn_des_nome_cad
                 FROM permuta_bordero pb
                 JOIN permuta_alocacao_execucao pae
                   ON pae.bor_cod = pb.bor_cod AND pae.fil_cod = pb.fil_cod
             )
             SELECT * FROM recentes
             UNION
             SELECT * FROM da_trilha
             ORDER BY bor_dta_mvto DESC NULLS LAST, bor_cod DESC`,
        );
        return rows.map((r) => ({
            borCod: Number(r.bor_cod),
            filCod: Number(r.fil_cod),
            ...(r.bor_vld_finalizado != null
                ? { borVldFinalizado: Number(r.bor_vld_finalizado) }
                : {}),
            borCodEstornado: r.bor_cod_estornado != null ? Number(r.bor_cod_estornado) : null,
            ...(r.vlr_total_liquido != null
                ? { vlrTotalLiquido: Number(r.vlr_total_liquido) }
                : {}),
            ...(r.bor_dta_mvto != null ? { borDtaMvto: Number(r.bor_dta_mvto) } : {}),
            usnDesNomeCad: (r.usn_des_nome_cad as string | null) ?? null,
        }));
    };

    /**
     * Substitui o cache pelos itens do ERP (upsert + remove os que sumiram). Fetch vazio = no-op.
     *
     * `filiaisLidas` são as filiais cuja leitura no ERP **teve sucesso** — e SÓ elas são limpas.
     * A falha de leitura de uma filial chegava aqui indistinguível de "esta filial não tem
     * borderô nenhum", e o DELETE apagava todo o cache dela: a tela de borderôs esvaziava por
     * causa de um 500 do ERP. A guarda antiga (`items.length === 0`) só cobria o caso em que
     * TODAS as filiais falhavam ao mesmo tempo. Quem sabe o que falhou é o serviço; aqui a
     * informação só precisa chegar.
     *
     * Upsert e DELETE correm na MESMA transação: são duas escritas que só fazem sentido juntas,
     * e a ingestão pode interleave com o "Atualizar" da tela. Entre os dois comandos soltos que
     * havia antes cabia uma janela em que o cache ficava sem os borderôs recém-removidos e sem
     * os recém-inseridos.
     *
     * `atualizado_em` só anda quando a SITUAÇÃO muda (finalizado/estornado) — é o carimbo de
     * "desde quando o cache vê este estado", lido pela guarda de frescor de
     * `listConsumosFinalizados` (ADR-0046). Renová-lo em todo refresh (o "Atualizar" da tela, a
     * ingestão) empurraria o carimbo para depois do início da ingestão e desfaria o consumo.
     */
    public replaceBorderoCache = async (
        items: BorderoCacheRow[],
        filiaisLidas: number[],
    ): Promise<void> => {
        if (items.length === 0) return; // não limpa num fetch vazio (ERP indisponível)
        if (filiaisLidas.length === 0) return; // nenhuma filial lida com sucesso → nada a limpar
        const params: Record<string, unknown> = {};
        const tuples = items.map((b, i) => {
            params[`bor_${i}`] = b.borCod;
            params[`fil_${i}`] = b.filCod;
            params[`fin_${i}`] = b.borVldFinalizado ?? null;
            params[`est_${i}`] = b.borCodEstornado ?? null;
            params[`vlr_${i}`] = b.vlrTotalLiquido ?? null;
            params[`dta_${i}`] = b.borDtaMvto ?? null;
            params[`usn_${i}`] = b.usnDesNomeCad ?? null;
            return `($bor_${i}, $fil_${i}, $fin_${i}, $est_${i}, $vlr_${i}, $dta_${i}, $usn_${i}, now())`;
        });
        // Remove do cache os que sumiram do ERP — por PAR (fil_cod, bor_cod), pois o nº é por
        // filial — e SÓ dentro das filiais efetivamente lidas.
        const pairList = items.map((_, i) => `($fil_${i}, $bor_${i})`).join(', ');
        const lidasList = filiaisLidas
            .map((filCod, i) => {
                params[`lida_${i}`] = filCod;
                return `$lida_${i}`;
            })
            .join(', ');
        await this.databaseClient.withTransaction(async (tx) => {
            await tx.update(
                `INSERT INTO permuta_bordero (
                bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado, vlr_total_liquido,
                bor_dta_mvto, usn_des_nome_cad, atualizado_em
             ) VALUES ${tuples.join(', ')}
             ON CONFLICT (fil_cod, bor_cod) DO UPDATE SET
                bor_vld_finalizado = EXCLUDED.bor_vld_finalizado,
                bor_cod_estornado = EXCLUDED.bor_cod_estornado,
                vlr_total_liquido = EXCLUDED.vlr_total_liquido,
                bor_dta_mvto = EXCLUDED.bor_dta_mvto,
                usn_des_nome_cad = EXCLUDED.usn_des_nome_cad,
                atualizado_em = CASE
                    WHEN permuta_bordero.bor_vld_finalizado IS DISTINCT FROM EXCLUDED.bor_vld_finalizado
                      OR permuta_bordero.bor_cod_estornado IS DISTINCT FROM EXCLUDED.bor_cod_estornado
                    THEN now() ELSE permuta_bordero.atualizado_em END`,
                params,
            );
            await tx.update(
                `DELETE FROM permuta_bordero
                  WHERE fil_cod IN (${lidasList})
                    AND (fil_cod, bor_cod) NOT IN (${pairList})`,
                params,
            );
        });
    };

    /**
     * Atualiza a situação de UM borderô no cache (após Aprovar/Cancelar). Chave = (filial, borderô).
     * Mesma regra de carimbo do `replaceBorderoCache`: `atualizado_em` só anda se a situação mudou.
     */
    public updateBorderoCacheSituacao = async (
        filCod: number,
        borCod: number,
        fields: { borVldFinalizado?: number; borCodEstornado?: number | null },
    ): Promise<number> => {
        return this.databaseClient.update(
            `UPDATE permuta_bordero
             SET atualizado_em = CASE
                     WHEN bor_vld_finalizado IS DISTINCT FROM $fin
                       OR bor_cod_estornado IS DISTINCT FROM $est
                     THEN now() ELSE atualizado_em END,
                 bor_vld_finalizado = $fin,
                 bor_cod_estornado = $est
             WHERE fil_cod = $fil AND bor_cod = $bor`,
            {
                fil: filCod,
                bor: borCod,
                fin: fields.borVldFinalizado ?? null,
                est: fields.borCodEstornado ?? null,
            },
        );
    };

    /** Remove UM borderô do cache (após Excluir borderô no ERP). Chave = (filial, borderô). */
    public deleteBorderoCache = async (filCod: number, borCod: number): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_bordero WHERE fil_cod = $fil AND bor_cod = $bor`,
            { fil: filCod, bor: borCod },
        );
    };

    /** Guard explícito do terminal: status fora de `settled`/`parcial` é descartado (sem cast). */
    private mapConsumo = (r: Record<string, unknown>): ConsumoExecucaoRow | null => {
        const status = r.status;
        if (status !== 'settled' && status !== 'parcial') return null;
        return {
            adiantamentoDocCod: String(r.adiantamento_doc_cod),
            invoiceDocCod: String(r.invoice_doc_cod),
            status,
            ...(r.valor_residual_usd != null
                ? { valorResidualUsd: Number(r.valor_residual_usd) }
                : {}),
            criadoEm: new Date(r.criado_em as string | Date),
        };
    };

    private mapRow = (r: Record<string, unknown>): ExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        adiantamentoDocCod: String(r.adiantamento_doc_cod),
        invoiceDocCod: String(r.invoice_doc_cod),
        filCod: Number(r.fil_cod),
        status: r.status as ExecucaoStatus,
        dryRun: Boolean(r.dry_run),
        ...(r.bor_cod != null ? { borCod: Number(r.bor_cod) } : {}),
        ...(r.bxa_cod_seq != null ? { bxaCodSeq: Number(r.bxa_cod_seq) } : {}),
        ...(r.valor_baixado != null ? { valorBaixado: Number(r.valor_baixado) } : {}),
        ...(r.juros != null ? { juros: Number(r.juros) } : {}),
        ...(r.conta_juros != null ? { contaJuros: Number(r.conta_juros) } : {}),
        ...(r.valor_residual_usd != null ? { valorResidualUsd: Number(r.valor_residual_usd) } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
