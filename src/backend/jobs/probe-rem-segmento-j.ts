import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * SONDA READ-ONLY — o código de barras aparece de fato no SEGMENTO J do `.REM`?
 *
 * PERGUNTA: `probe-dda-assoc-write-hml.ts` provou que a associação DDA popula
 * `FinItemSispag.itsNumCodbar`. Falta o passo final: esse barcode chega ao ARQUIVO que vai
 * ao banco? Ninguém verificou, e é a pendência que a ADR-0040 deixou para o go-live.
 *
 * MÉTODO SEM ESCREVER NADA: as remessas que a analista já gerou têm boletos reais. Basta ler
 * os `.REM` existentes (`gerArquivosBancos` → `gabLngDados`) e parsear o segmento J.
 *
 * Layout CNAB 240 FEBRABAN, registro de detalhe segmento J (1-indexed):
 *   pos 14      → código do segmento ('J')
 *   pos 18–61   → código de barras (44 dígitos)
 *   pos 62–91   → nome do cedente
 * Também conta segmento A (crédito em conta) e O (tributo/concessionária) para contexto.
 *
 * SEGURANÇA: só `fin015/list` e `gerArquivosBancos/list` (leitura). Nenhuma escrita.
 * O conteúdo do `.REM` NÃO é salvo em disco — só as métricas e um trecho MASCARADO.
 *
 * Run:
 *   cd src/backend
 *   PROBE_PRD=1 tsx jobs/probe-rem-segmento-j.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD (read-only) passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/rem-segmento-j';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
const BNCS = (process.env.PROBE_BNCS ?? '4').split(',').map(Number).filter(Number.isFinite);

type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[rem-J] ${s}`);

/** Módulo 11 do código de barras (pos 5 é o DV geral). Prova que o número é um boleto válido. */
const dvBarrasOk = (barras: string): boolean => {
    if (barras.length !== 44) return false;
    const semDv = barras.slice(0, 4) + barras.slice(5);
    const dvInformado = Number(barras[4]);
    let peso = 2;
    let soma = 0;
    for (let i = semDv.length - 1; i >= 0; i -= 1) {
        soma += Number(semDv[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dv = 11 - resto;
    const esperado = dv === 0 || dv === 1 || dv > 9 ? 1 : dv;
    return dvInformado === esperado;
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const write = container.resolve(ConexosSispagWriteClient);
    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));

    const resumo: Row[] = [];
    let exemploSalvo = false;

    for (const filCod of FILIAIS) {
        for (const bncCod of BNCS) {
            let lotes: Array<{ flpCod: number }> = [];
            try {
                lotes = await write.listarLotesNativos({ filCod, bncCod });
            } catch {
                continue;
            }
            for (const lote of lotes) {
                let arquivos: Array<{ gabCod: number; nomeArquivo?: string; conteudo?: string }> =
                    [];
                try {
                    arquivos = await write.listarArquivosRemessa({
                        filCod,
                        bncCod,
                        flpCod: lote.flpCod,
                    });
                } catch {
                    continue;
                }
                for (const arq of arquivos) {
                    if (!arq.conteudo) continue;
                    const linhas = arq.conteudo.split(/\r?\n/).filter((l) => l.length > 60);
                    // O segmento J vem em DOIS registros por boleto: o J propriamente dito
                    // (com o barcode) e o **J-52** (complemento com CNPJ do favorecido/pagador),
                    // que tem 'J' na pos 14 mas '52' nas pos 18-19 e NÃO carrega barras.
                    // Contar os dois juntos produz um falso "50% de segmentos J vazios".
                    const todosJ = linhas.filter(
                        (l) => l[13] === 'J' && l.slice(0, 8).match(/^\d/),
                    );
                    const segJ = todosJ.filter((l) => l.slice(17, 19) !== '52');
                    const segJ52 = todosJ.filter((l) => l.slice(17, 19) === '52');
                    const segA = linhas.filter((l) => l[13] === 'A');
                    const segO = linhas.filter((l) => l[13] === 'O');
                    if (todosJ.length === 0 && segA.length === 0) continue;

                    const barras = segJ.map((l) => l.slice(17, 61));
                    const comBarras = barras.filter((b) => /^\d{44}$/.test(b));
                    const dvOk = comBarras.filter(dvBarrasOk);
                    const vazios = segJ.length - comBarras.length;

                    log(
                        `fil=${filCod} flp=${lote.flpCod} ${arq.nomeArquivo ?? arq.gabCod}: ` +
                            `segJ=${segJ.length} (barras ok=${comBarras.length}, DV=${dvOk.length}, VAZIAS=${vazios}) J52=${segJ52.length} segA=${segA.length} segO=${segO.length}`,
                    );
                    resumo.push({
                        filCod,
                        flpCod: lote.flpCod,
                        arquivo: arq.nomeArquivo,
                        segmentoJ: segJ.length,
                        segmentoJ52: segJ52.length,
                        comBarras: comBarras.length,
                        dvValido: dvOk.length,
                        barrasVazias: vazios,
                        segmentoA: segA.length,
                        segmentoO: segO.length,
                    });

                    if (!exemploSalvo && comBarras.length > 0) {
                        // MASCARADO: banco emissor + tamanho + DV, sem o número completo.
                        const b = comBarras[0];
                        writeFileSync(
                            `${OUT}/exemplo-segmento-j.txt`,
                            [
                                `arquivo: ${arq.nomeArquivo}`,
                                `segmento J encontrado na posição 14 da linha`,
                                `barcode (pos 18-61): ${b.slice(0, 3)}${'x'.repeat(38)}${b.slice(-3)}`,
                                `  banco emissor: ${b.slice(0, 3)}`,
                                `  tamanho: ${b.length}`,
                                `  DV módulo 11: ${dvBarrasOk(b) ? 'VÁLIDO' : 'INVÁLIDO'}`,
                            ].join('\n'),
                        );
                        exemploSalvo = true;
                    }
                }
            }
        }
    }

    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(resumo, null, 2));
    console.log('='.repeat(78));
    if (resumo.length === 0) {
        console.log('Nenhum .REM com conteúdo encontrado nas filiais/bancos varridos.');
    } else {
        console.table(resumo);
        const totJ = resumo.reduce((a, r) => a + Number(r.segmentoJ), 0);
        const totOk = resumo.reduce((a, r) => a + Number(r.comBarras), 0);
        const totDv = resumo.reduce((a, r) => a + Number(r.dvValido), 0);
        const totVazio = resumo.reduce((a, r) => a + Number(r.barrasVazias), 0);
        console.log(
            `\nTOTAL: ${totJ} segmentos J · ${totOk} com 44 dígitos · ${totDv} com DV módulo-11 válido · ${totVazio} VAZIOS`,
        );
    }
    console.log('='.repeat(78));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
