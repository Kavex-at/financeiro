import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import type { ContaPagadora } from '../domain/interface/sispag/Fin015Write.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';

/**
 * GATE — a retomada realmente não duplica lote? (T5, ADR-0039)
 *
 * Toda a mecânica de retomada é testada contra mock. Mock prova que a NOSSA lógica é
 * coerente consigo mesma; não prova nada sobre o ERP. Aqui a queda é encenada de verdade e
 * o que vale é a contagem: no fim, a filial tem que ter EXATAMENTE os lotes esperados.
 * Um lote a mais é a definição de "duplicou" — reprova.
 *
 * ── COMO A QUEDA É SIMULADA ─────────────────────────────────────────────────────────────
 * Rebobinando o LEDGER, não matando o processo. Matar o processo no meio de um POST não é
 * reproduzível; e o que precisa ser exercitado é a LEITURA de estado do ERP. Então: monta-se
 * no ERP exatamente o estado que aquela queda teria deixado, põe-se o ledger em `reconciling`
 * com só o que a queda teria alcançado a gravar, e roda-se de novo.
 *
 * ── SEGURANÇA ───────────────────────────────────────────────────────────────────────────
 * ESTE JOB ESCREVE no ERP e no Postgres local. Recusa rodar fora de HML sem `PERMITIR_PRD=1`,
 * e o default é DRY (só mede) para que rodar por engano não custe nada.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString=postgresql://financeiro:devlocal@localhost:5433/financeiro \
 *   npx tsx jobs/validate-retomada-remessa-v1.ts --executar
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const EXECUTAR = process.argv.includes('--executar');
const FIL = Number(process.env.VAL_FIL ?? 1);
const ATOR = 'validate-retomada';

if (!BASE.includes('-hml') && process.env.PERMITIR_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD, passe PERMITIR_PRD=1.`);
    process.exit(1);
}

const log = (s: string): void => console.log(`[val-retomada] ${s}`);
/**
 * Meia-noite UTC — o MESMO cálculo do `RemessaService.hojeUtc`. `Date.now()` carrega hora e o
 * ERP recusa (`flpDtaCredito: datetime_not_expected`); descobri isso reprovando o gate.
 */
const hojeUtc = (): number => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const erroDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Resultado {
    cenario: string;
    esperado: string;
    obtido: string;
    ok: boolean;
    lotesNovos: number;
}

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    const loteService = container.resolve(LotePagamentoService);
    const remessa = container.resolve(RemessaService);
    const db = container.resolve(PostgreeDatabaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}${BASE.includes('-hml') ? ' (HML)' : ' (PRODUÇÃO)'}`);
    console.log(`MODO: ${EXECUTAR ? 'EXECUTAR — escreve no ERP e no Postgres' : 'DRY (só mede)'}`);
    console.log(`FILIAL: ${FIL}`);
    console.log('='.repeat(78));

    const contas = await sispag.listContasCorrentes(FIL);
    if (contas.length === 0) {
        console.error(`ABORTADO: filial ${FIL} sem conta corrente no fin005.`);
        process.exit(1);
    }
    // NÃO `contas[0]`. A filial 1 de HML tem 17 contas e a primeira é de um banco que não
    // está no mapa FEBRABAN — cairia num default errado e o arquivo sairia com o banco
    // trocado. O banco é escolha explícita, e um código desconhecido ABORTA.
    const BNC = Number(process.env.VAL_BNC ?? 4);
    const cc = contas.find((c) => c.bncCod === BNC);
    if (!cc) {
        console.error(
            `ABORTADO: filial ${FIL} não tem conta do banco ${BNC}. ` +
                `Disponíveis: ${[...new Set(contas.map((c) => c.bncCod))].join(', ')}. ` +
                'Passe VAL_BNC=<bncCod>.',
        );
        process.exit(1);
    }
    const bncCod = cc.bncCod;
    const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
    const bncNumCodbanco = FEBRABAN[bncCod];
    if (bncNumCodbanco === undefined) {
        console.error(`ABORTADO: bncCod ${bncCod} não está no mapa FEBRABAN conhecido.`);
        process.exit(1);
    }
    const contaFmt = `${cc.numeroConta}-${cc.dvConta ?? ''}`;
    // Mesma projeção que o `RemessaService` faz: o fin015 quer o shape de ContaPagadora.
    const conta: ContaPagadora = {
        bncCod,
        bncNumCodbanco,
        ccoCod: cc.ccoCod,
        ccoNumConta: Number(cc.numeroConta),
        ccoEspDvconta: String(cc.dvConta ?? ''),
        ccoEspAgcod: String(cc.agencia ?? ''),
        conta: contaFmt,
        layoutConta: `AG:${cc.agencia}/CT:${contaFmt}`,
    };

    const contarLotes = async (): Promise<number> =>
        (await write.listarLotesNativos({ filCod: FIL, bncCod })).length;
    const marcaAtual = async (): Promise<number> =>
        (await write.listarLotesNativos({ filCod: FIL, bncCod })).reduce(
            (m, l) => Math.max(m, l.flpCod),
            0,
        );

    const baseline = await contarLotes();
    log(`linha de base: ${baseline} lote(s) · banco ${bncCod} · conta ${cc.ccoCod}`);

    if (!EXECUTAR) {
        log('DRY — nada foi criado. Rode com --executar contra HML para exercitar.');
        return;
    }

    // ── Dois títulos elegíveis de verdade ────────────────────────────────────
    // ── Limpeza das execuções anteriores deste job ───────────────────────────
    // Sem isto, um lote RASCUNHO de uma tentativa que falhou prende os títulos (I3) e o
    // gate reprova por sujeira, não por defeito. Só remove o que ESTE job criou.
    const limpos = await db.update(
        `DELETE FROM lote_pagamento WHERE criado_por = $ator`,
        { ator: ATOR },
    );
    log(`limpeza: ${limpos} lote(s) local(is) de execuções anteriores removido(s)`);

    // ── Títulos de teste: do GRID DE PENDENTES, não da carteira ──────────────
    // `fin064` diz o que existe a pagar; `titulosPendentes` diz o que o fin015 aceita
    // importar AGORA. Um título que já esteja num lote nativo de HML aparece no primeiro e
    // não no segundo — e foi exatamente isso que reprovou a tentativa anterior.
    // Reusa um lote ABERTO e VAZIO se já houver um: listar pendentes exige um flpCod, e
    // criar um lote novo a cada execução do gate polui o fin015 de HML sem necessidade
    // (não existe endpoint para apagar lote).
    const jaVazio = (await write.listarLotesNativos({ filCod: FIL, bncCod })).find(
        (l) => l.status === 0 && l.titulosCount === 0,
    );
    const scratch = jaVazio ?? (await write.criarLote({ filCod: FIL, conta, dataDebito: hojeUtc() }));
    log(
        `lote de sondagem: flp ${scratch.flpCod} ` +
            `(${jaVazio ? 'reusado, já estava vazio' : 'criado agora'})`,
    );
    const pendentesGrid = await write.listarTitulosPendentes({
        filCod: FIL,
        bncCod,
        flpCod: scratch.flpCod,
    });
    // Quantos títulos o pool PRECISA: 2 por cenário. Adaptativo de propósito — em HML só
    // uma fração dos favorecidos tem conta cadastrada, e cada cenário CONSOME os seus
    // títulos (importados saem do grid de pendentes para sempre). Melhor rodar os cenários
    // que cabem e dizer quais ficaram de fora do que abortar tudo.
    const PRECISO = Number(process.env.VAL_MAX_TITULOS ?? 6);
    // PRÉ-FILTRO por conta do favorecido. O import exige conta ativa no banco do lote, e em
    // HML a maioria dos favorecidos não tem nenhuma — a sonda `probe-fin064-destino` mediu
    // 0% em 561 títulos. Sem este filtro o gate reprova por dado de homologação, não por
    // defeito da retomada, que foi o que aconteceu na primeira execução.
    const pool: Array<{ docCod: string; titCod: string }> = [];
    for (const cand of pendentesGrid.filter((p) => Number(p.raw.filCod) === FIL)) {
        if (pool.length >= PRECISO) break;
        // VENCIDO não entra em lote: a data de débito é hoje e o ERP recusa quando ela passa
        // do vencimento (regra R2). Sem este filtro o import volta `MODEL_INCONSISTENCY` —
        // foi o que reprovou a execução anterior, com títulos vencendo em nov/2025.
        const venc = Number(cand.raw.titDtaVencimento);
        if (!Number.isFinite(venc) || venc < hojeUtc()) continue;

        const pesCod = cand.raw.pesCod;
        if (pesCod == null) continue;
        const contasFav = await sispag.listContasFavorecido(String(pesCod), FIL);
        if (contasFav.some((c) => c.banco === bncNumCodbanco)) {
            pool.push({ docCod: cand.docCod, titCod: cand.titCod });
        }
    }
    const cenariosPossiveis = Math.floor(pool.length / 2);
    if (cenariosPossiveis === 0) {
        console.error(
            `ABORTADO: ${pool.length} de ${pendentesGrid.length} título(s) pendente(s) da filial ` +
                `${FIL} são A VENCER **e** têm favorecido com conta no banco ${bncNumCodbanco}. Preciso de 2.`,
        );
        console.error(
            'Isto é dado de HOMOLOGAÇÃO, não defeito: os favorecidos de HML em geral não têm conta ' +
                'cadastrada (0% em 561 títulos, medido em 2026-08-19). Cadastre contas para alguns ' +
                'favorecidos, ou rode com VAL_BNC de um banco onde eles tenham.',
        );
        process.exit(1);
    }
    if (cenariosPossiveis < 3) {
        log(
            `ATENÇÃO: pool dá para ${cenariosPossiveis} de 3 cenários ` +
                `(${pool.length} de ${pendentesGrid.length} pendentes têm conta no banco ${bncNumCodbanco}).`,
        );
        log('Os cenários rodam por ORDEM DE VALOR; os que faltarem aparecem como PULADO.');
    }
    // 2 títulos POR CENÁRIO: um título só pode estar num rascunho por vez (I3).
    const parDe = (n: number) => pool.slice(n * 2, n * 2 + 2);
    log(`pool de teste: ${pool.map((t) => `${t.docCod}/${t.titCod}`).join(', ')}`);

    /** Cria um lote LOCAL finalizado com os dois títulos. Devolve o id. */
    const montarLoteLocal = async (
        titulos: Array<{ docCod: string; titCod: string }>,
    ): Promise<string> => {
        const lote = await loteService.criarLote({ filCod: FIL, ator: ATOR });
        for (const t of titulos) {
            await loteService.incluirTitulo({
                loteId: lote.id,
                filCod: FIL,
                docCod: t.docCod,
                titCod: t.titCod,
                ator: ATOR,
            });
            // `finalizarLote` recusa item sem modalidade — o gate reprovou por isto.
            const atual = await loteService.getLote(lote.id);
            await loteService.atualizarModalidadeItem({
                loteId: lote.id,
                filCod: FIL,
                docCod: t.docCod,
                titCod: t.titCod,
                modalidade: 'CREDITO_CONTA',
                versao: atual?.versao ?? 1,
                ator: ATOR,
            });
        }
        const atual = await loteService.getLote(lote.id);
        await loteService.finalizarLote({
            loteId: lote.id,
            ator: ATOR,
            versao: atual?.versao ?? 1,
        });
        return lote.id;
    };

    /** Põe o ledger daquele lote em `reconciling`, com só o que a queda teria gravado. */
    const rebobinarLedger = async (
        loteId: string,
        campos: { nativeFlpCod: number | null; requestPayload: unknown },
    ): Promise<void> => {
        await db.update(
            `UPDATE remessa_execucao
             SET status = 'reconciling', dry_run = FALSE,
                 native_flp_cod = $flp,
                 request_payload = $payload::jsonb,
                 atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key: `remessa:${loteId}`,
                flp: campos.nativeFlpCod,
                payload: JSON.stringify(campos.requestPayload ?? null),
            },
        );
    };

    const resultados: Resultado[] = [];
    const registrar = (r: Resultado): void => {
        resultados.push(r);
        console.log(`   ${r.ok ? 'OK  ' : 'FALHA'} · ${r.obtido}`);
    };

    // ── C1: órfão sem flpCod → adota pela marca d'água ───────────────────────
    // C1 primeiro: é o mecanismo mais novo e o único com julgamento (a regra do
    // "exatamente um"). Se só um cenário couber no pool, que seja este.
    log('── C1 · órfão sem flpCod (marca d\'água tem que ADOTAR, não criar outro)');
    try {
        if (cenariosPossiveis < 1) throw new Error('PULADO — pool insuficiente');
        const marca = await marcaAtual();
        // Encena a queda: o lote foi criado no ERP e o número não chegou ao ledger.
        const orfao = await write.criarLote({
            filCod: FIL,
            conta,
            dataDebito: hojeUtc(),
        });
        log(`   órfão plantado no ERP: flp ${orfao.flpCod} (marca era ${marca})`);

        const loteId = await montarLoteLocal(parDe(0));
        const antes = await contarLotes();
        // Ledger: reconciling, SEM flpCod, com a marca gravada antes do POST.
        await remessa.gerarRemessa({ loteId, ator: ATOR, dryRunOverride: true }); // cria a linha
        await rebobinarLedger(loteId, {
            nativeFlpCod: null,
            requestPayload: { marcaFlpCod: marca, ccoCod: cc.ccoCod },
        });

        const r = await remessa.gerarRemessa({ loteId, ator: ATOR });
        const novos = (await contarLotes()) - antes;
        registrar({
            cenario: 'orfao-sem-flpCod',
            esperado: `adota o flp ${orfao.flpCod}, 0 lote novo`,
            obtido: `usou flp ${r.nativeFlpCod} · ${novos} lote(s) novo(s)`,
            ok: r.nativeFlpCod === orfao.flpCod && novos === 0,
            lotesNovos: novos,
        });
    } catch (e) {
        registrar({
            cenario: 'orfao-sem-flpCod',
            esperado: 'adoção',
            obtido: `ERRO: ${erroDe(e)}`,
            ok: false,
            lotesNovos: 0,
        });
    }

    // ── C2: import parcial → importa só o que falta ──────────────────────────
    log('── C2 · import parcial (só o título que falta deve entrar)');
    try {
        if (cenariosPossiveis < 2) throw new Error('PULADO — pool insuficiente');
        const par = parDe(1);
        const loteId = await montarLoteLocal(par);
        const antes = await contarLotes();
        const novo = await write.criarLote({ filCod: FIL, conta, dataDebito: hojeUtc() });

        // Importa 1 dos 2 direto pelo cliente — é o "parcial" do ERP.
        const pendentes = await write.listarTitulosPendentes({
            filCod: FIL,
            bncCod,
            flpCod: novo.flpCod,
        });
        const primeiro = pendentes.find(
            (p) => p.docCod === par[0]?.docCod && p.titCod === par[0]?.titCod,
        );
        if (!primeiro) throw new Error('título 1 não apareceu no grid de pendentes');
        await write.importarTitulos({
            filCod: FIL,
            bncCod,
            flpCod: novo.flpCod,
            itens: [{ ...primeiro.raw, filCodLote: FIL, bncCod, flpCod: novo.flpCod }],
        });
        log(`   flp ${novo.flpCod} com 1 de 2 títulos`);

        await remessa.gerarRemessa({ loteId, ator: ATOR, dryRunOverride: true });
        await rebobinarLedger(loteId, { nativeFlpCod: novo.flpCod, requestPayload: null });

        const r = await remessa.gerarRemessa({ loteId, ator: ATOR });
        const estado = await write.getLoteNativo({ filCod: FIL, bncCod, flpCod: novo.flpCod });
        const novos = (await contarLotes()) - antes;
        registrar({
            cenario: 'import-parcial',
            esperado: 'lote fica com 2 títulos, 1 lote novo (o plantado)',
            obtido: `flp ${r.nativeFlpCod} com ${estado?.titulosCount} título(s) · ${novos} novo(s)`,
            ok: estado?.titulosCount === 2 && novos === 1,
            lotesNovos: novos,
        });
    } catch (e) {
        registrar({
            cenario: 'import-parcial',
            esperado: 'importa só o que falta',
            obtido: `ERRO: ${erroDe(e)}`,
            ok: false,
            lotesNovos: 0,
        });
    }

    // ── C3: remessa já gerada → devolve o mesmo arquivo ──────────────────────
    log('── C3 · remessa já gerada, ledger não fechou (deve devolver o MESMO arquivo)');
    try {
        if (cenariosPossiveis < 3) throw new Error('PULADO — pool insuficiente');
        const loteId = await montarLoteLocal(parDe(2));
        const antes = await contarLotes();
        const primeira = await remessa.gerarRemessa({ loteId, ator: ATOR });
        log(`   remessa gerada: ${primeira.arquivo} (flp ${primeira.nativeFlpCod})`);

        await rebobinarLedger(loteId, {
            nativeFlpCod: primeira.nativeFlpCod ?? null,
            requestPayload: { nomeArquivo: primeira.arquivo, numRemessa: primeira.numRemessa },
        });

        const segunda = await remessa.gerarRemessa({ loteId, ator: ATOR });
        const novos = (await contarLotes()) - antes;
        registrar({
            cenario: 'remessa-gerada-sem-settle',
            esperado: `skipped com o mesmo arquivo, 1 lote novo (o da 1ª geração)`,
            obtido: `status=${segunda.status} arquivo=${segunda.arquivo} · ${novos} novo(s)`,
            ok: segunda.status === 'skipped' && segunda.arquivo === primeira.arquivo && novos === 1,
            lotesNovos: novos,
        });
    } catch (e) {
        registrar({
            cenario: 'remessa-gerada-sem-settle',
            esperado: 'skipped, mesmo arquivo',
            obtido: `ERRO: ${erroDe(e)}`,
            ok: false,
            lotesNovos: 0,
        });
    }

    // ── Veredito ─────────────────────────────────────────────────────────────
    const final = await contarLotes();
    console.log('');
    console.log('='.repeat(78));
    const pulado = (r: Resultado): boolean => r.obtido.includes('PULADO');
    for (const r of resultados) {
        const icone = r.ok ? '✅' : pulado(r) ? '⏭️ ' : '❌';
        console.log(`${icone} ${r.cenario.padEnd(26)} ${r.obtido}`);
    }
    console.log('-'.repeat(78));
    console.log(`lotes na filial ${FIL}: ${baseline} → ${final} (${final - baseline} novos)`);
    // PULADO não reprova: é cobertura que faltou, e o relatório diz isso em vez de fingir.
    const executados = resultados.filter((r) => !pulado(r));
    const todosOk = executados.length > 0 && executados.every((r) => r.ok);
    console.log(
        todosOk
            ? `GATE OK — ${executados.length} cenário(s) executado(s), nenhuma retomada duplicou lote.`
            : 'GATE REPROVADO.',
    );
    if (executados.length < resultados.length) {
        console.log(
            `COBERTURA PARCIAL: ${resultados.length - executados.length} cenário(s) não rodaram por ` +
                'falta de título elegível em HML — não confundir com aprovado.',
        );
    }
    console.log('='.repeat(78));
    console.log('');
    console.log('NÃO EXERCITADO: lote cancelado. Não há endpoint de cancelamento de lote');
    console.log('provado no fin015 — o cancelamento é feito na tela do ERP. Rode a mão:');
    console.log('cancele um lote nativo e clique em "Gerar remessa" no lote local correspondente.');
    if (!todosOk) process.exit(1);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[val-retomada] FATAL:', erroDe(e));
        process.exit(1);
    });
