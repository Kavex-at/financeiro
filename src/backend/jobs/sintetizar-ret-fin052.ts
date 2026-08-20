import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * SINTETIZA um `.RET` que responde a um `.REM` que NÓS geramos, para exercitar a perna
 * de retorno em HML enquanto a Columbia não fornece um arquivo real do banco.
 *
 * ⚠️ LIMITE DESTE TESTE: um `.RET` sintético prova o NOSSO caminho e o parser do ERP.
 * NÃO prova o formato real do Itaú. É gate de desenvolvimento, não homologação.
 *
 * ── A especificação vem do próprio ERP ──────────────────────────────────────────────
 * `ger015.gtbLngSql` do layout "ITAÚ PADRÃO" (bnc 4) é um PL/SQL que lê as linhas cruas
 * (`GER_ARQUIVO_RETORNO_LINHAS.GAR_ESP_LINHA`) por posição. Dele saem as regras:
 *
 *   pos 8      = tipo de registro; só `'3'` (detalhe) é processado.
 *   pos 14     = segmento. `'Z'` é ignorado; `'A'`, `'J'`, `'O'` têm offsets próprios.
 *   pos 74-93  = (segmento A) a CHAVE do item, escrita por nós na ida:
 *                  filCod(2) + bncCod(4) + flpCod(7) + itsCodSeq(7)
 *                O parser faz `SELECT ... FROM FIN_ITEM_SISPAG WHERE FIL_COD=.. BNC_COD=..
 *                FLP_COD=.. ITS_COD_SEQ=..`; não batendo → "NÃO FOI ENCONTRADO O ITEM".
 *   pos 231-240 = até 5 códigos de ocorrência de 2 chars. CADA um precisa existir em
 *                `FIN_BANCOS_ERROS` (bnc, cod, tipo=2), senão o arquivo INTEIRO falha
 *                com 'A SIGLA "xx" NÃO FOI CONFIGURADA NO SISTEMA'.
 *
 * Semântica do código (coluna `fbeVldTpret` de `FinBancosErros`, via `fin050/list`):
 *   tpret=1 → pagamento efetuado (data de pagamento efetiva preenchida, item NÃO rejeitado)
 *   tpret=2 → rejeitado (`FIN_ITEM_SISPAG.ITS_VLD_REJ = 1`)
 * Para o Itaú há exatamente UM código com tpret=1: **`00` = PAGAMENTO EFETUADO**.
 *
 * Efeitos do `processar` (do mesmo PL/SQL): insere em `FIN_ITEM_SISPAG_RET`, marca
 * `FIN_LOTE_SISPAG.FLP_VLD_CONF_ENVIO = 1` e popula `FIN_TITULO_RETBANCO` — a fila que
 * alimenta a BAIXA no fin010.
 *
 * SEGURANÇA: gerar o arquivo é local e não toca o ERP. O upload exige `RET_UPLOAD=1` e
 * recusa base que não seja HML. Este job NÃO chama `processar`.
 *
 * Run (só gera):   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api FLP=26 npx tsx jobs/sintetizar-ret-fin052.ts
 * Run (+ upload):  ... RET_UPLOAD=1 npx tsx jobs/sintetizar-ret-fin052.ts
 * Rejeição:        ... OCORRENCIA=NA npx tsx jobs/sintetizar-ret-fin052.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const UPLOAD = process.env.RET_UPLOAD === '1';
if (UPLOAD && !BASE.includes('-hml')) {
    console.error(`RECUSADO: upload de .RET só em HML (base atual: ${BASE}).`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/ret-sintetico';
const FIL = Number(process.env.FLP_FIL ?? 1);
const BNC = Number(process.env.FLP_BNC ?? 4);
const FLP = Number(process.env.FLP ?? 26);
const GTB = Number(process.env.GTB ?? 1);
/** Código de ocorrência a devolver. `00` = PAGAMENTO EFETUADO (único tpret=1 do Itaú). */
const OCORRENCIA = (process.env.OCORRENCIA ?? '00').padEnd(2, ' ').slice(0, 2);

const log = (s: string, v?: unknown): void =>
    console.log(`[ret-sint] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 400) : '');

/** Substitui `valor` na linha a partir da posição 1-based `pos`, sem mudar o tamanho. */
const poke = (linha: string, pos: number, valor: string): string =>
    linha.slice(0, pos - 1) + valor + linha.slice(pos - 1 + valor.length);

/** Lê `tam` chars a partir da posição 1-based `pos`. */
const peek = (linha: string, pos: number, tam: number): string =>
    linha.slice(pos - 1, pos - 1 + tam);

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const write = container.resolve(ConexosSispagWriteClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}`);
    console.log(`LOTE: fil=${FIL} bnc=${BNC} flp=${FLP} · ocorrência="${OCORRENCIA}"`);
    console.log(`UPLOAD: ${UPLOAD ? 'SIM (HML)' : 'não — só gera o arquivo'}`);
    console.log('='.repeat(78));

    // ── 1) recuperar o `.REM` que nós geramos ────────────────────────────────
    const arquivos = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod: FLP });
    const rem = arquivos.find((a) => a.conteudo);
    if (!rem?.conteudo) {
        log(`nenhum .REM com conteúdo no lote ${FLP} — gere a remessa antes.`);
        return;
    }
    log(`1) .REM de origem: ${rem.nomeArquivo} (gabCod ${rem.gabCod}, ${rem.conteudo.length} chars)`);

    // ── 2) transformar remessa → retorno ─────────────────────────────────────
    const linhas = rem.conteudo.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let detalhes = 0;
    const saida = linhas.map((linhaOriginal) => {
        // CNAB 240: registros de 240 posições. Normaliza para não deslocar offsets.
        let l = linhaOriginal.padEnd(240, ' ').slice(0, 240);
        const registro = peek(l, 8, 1);

        // Header de arquivo: código remessa/retorno na pos 143 → '2' (retorno).
        if (registro === '0') l = poke(l, 143, '2');

        // Detalhe segmento A: devolve a ocorrência nas posições 231-240.
        if (registro === '3' && peek(l, 14, 1) === 'A') {
            // FORCA_FIL sobrescreve a filial embutida (pos 74-75). Existe para testar a
            // hipótese de que o ERP grava no .REM a filial do LOTE, enquanto o parser do
            // retorno procura o item pela filial do TÍTULO — ver o erro "NÃO FOI
            // ENCONTRADO O ITEM DA LINHA".
            if (process.env.FORCA_FIL) {
                l = poke(l, 74, String(process.env.FORCA_FIL).padStart(2, '0').slice(0, 2));
            }
            const chave = peek(l, 74, 20);
            log(
                `2) detalhe: chave="${chave}" → filCod=${chave.slice(0, 2)} bncCod=${chave.slice(2, 6)} flpCod=${chave.slice(6, 13)} itsCodSeq=${chave.slice(13, 20)}`,
            );
            l = poke(l, 231, OCORRENCIA.padEnd(10, ' '));
            detalhes += 1;
        }
        return l;
    });

    if (detalhes === 0) {
        log('nenhum segmento A no .REM — nada a responder. Abortando.');
        return;
    }

    const conteudo = `${saida.join('\r\n')}\r\n`;
    const nomeArquivo = process.env.NOME ?? `${(rem.nomeArquivo ?? `flp${FLP}`).replace(/\.REM$/i, '')}.RET`;
    const caminho = `${OUT}/${nomeArquivo}`;
    writeFileSync(caminho, conteudo, 'latin1');

    console.log(`\n${'='.repeat(78)}`);
    console.log(`.RET SINTÉTICO — ${nomeArquivo} · ${detalhes} detalhe(s) · ${conteudo.length} chars`);
    console.log(`arquivo: ${caminho}`);
    console.log('='.repeat(78));
    for (const l of saida) {
        const reg = peek(l, 8, 1);
        const seg = peek(l, 14, 1);
        const marca = reg === '3' ? `DET/${seg} ocorr="${peek(l, 231, 10).trimEnd()}"` : `reg ${reg}`;
        console.log(`${marca.padEnd(24)}| ${l.slice(0, 120)}`);
    }
    console.log('='.repeat(78));

    if (!UPLOAD) {
        log('\nSÓ GERAÇÃO. Para subir no fin052: RET_UPLOAD=1 (HML). O `processar` NÃO é chamado por este job.');
        return;
    }

    // ── 3) upload no fin052 (multipart) — primeira validação do `carregar` ───
    const retorno = container.resolve(ConexosSispagRetornoClient);
    try {
        const arq = await retorno.carregarArquivoRetorno({
            filCod: FIL,
            bncCod: BNC,
            gtbCodSeq: GTB,
            fileName: nomeArquivo,
            conteudo: Buffer.from(conteudo, 'latin1'),
        });
        log('3) carregarArquivoRetorno ✅ →', arq);
        writeFileSync(`${OUT}/30-arquivo-carregado.json`, JSON.stringify(arq, null, 2));
        log(`   chave do arquivo: fil=${FIL} bnc=${BNC} gtb=${GTB} gar=${arq.garCodSeq}`);
        log('   próximo passo (NÃO feito aqui): PUT fin052/arquivosRetorno/processar');
    } catch (e) {
        log('3) carregarArquivoRetorno ❌:', e instanceof Error ? e.message : String(e));
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[ret-sint] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
