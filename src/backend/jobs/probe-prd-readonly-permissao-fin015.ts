import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * SONDA DE PRODUÇÃO — SOMENTE LEITURA — permissão do robô sobre os itens do `fin015` (ADR-0071,
 * Task 18, decisões P0-3 e Q7).
 *
 * ── O QUE FAZ ────────────────────────────────────────────────────────────────────────────
 * Lê (`list`) os itens de UM rascunho nativo que JÁ EXISTE em PRD e imprime só contagens e flags:
 * quantos itens, quantos já têm código (sem mostrá-lo), quantos o ERP associou ao DDA, quantos
 * têm identidade (`itsCodSeq`) e se a leitura veio completa. Mais nada.
 *
 * ── O QUE NÃO FAZ ────────────────────────────────────────────────────────────────────────
 * NENHUMA escrita: não grava item, não confirma código, não apaga item, não importa, não cria nem
 * finaliza lote, não gera remessa. Também NÃO chama a validação de código de barras: é um `POST`
 * e a Conexos/Columbia ainda não confirmou que ela não tem efeito (Q7). Um teste estático
 * (`probe-prd-readonly-permissao-fin015.test.ts`) lê o fonte deste arquivo e FALHA se qualquer
 * método de escrita do client aparecer aqui.
 *
 * ── ⚠️ O QUE ESTE JOB **NÃO** PROVA ───────────────────────────────────────────────────────
 * Listar itens com sucesso **não é prova de permissão de `PUT`** em `fin015/finItemSispag`
 * (V-PRD1 continua ABERTO). Ler e gravar são permissões distintas no Conexos.
 * Alternativa PREFERIDA a sondar às cegas: pedir à Conexos/Columbia a **matriz de permissões do
 * robô para o programa `fin015`**.
 *
 * ── ⚠️ EFEITO COLATERAL: DERRUBA A SESSÃO DO ROBÔ ─────────────────────────────────────────
 * O login deste job **substitui a sessão viva do robô** em PRD (cap de sessões do Conexos; ver a
 * nota "Probe local derruba sessão Conexos"). Por isso:
 *   - exige a flag explícita `--eu-entendo-que-derruba-a-sessao-do-robo`;
 *   - só roda com o **go do maintainer**, fora do horário de analista;
 *   - o executor do pipeline (AutoLoopRunner) NUNCA o dispara;
 *   - `databaseConnectionString=""` (não grava sessão em `columbia-default`);
 *   - a credencial de PRD é a do ambiente do maintainer, nunca de arquivo versionado.
 * Atenção: `listGenericPaginated` devolve UMA página; o job confere `count` e reporta se a
 * leitura foi truncada.
 *
 * Uso (de `src/backend`, pelo maintainer):
 *   databaseConnectionString="" FIL=1 BNC=4 FLP=<rascunho existente> \
 *     npx tsx jobs/probe-prd-readonly-permissao-fin015.ts --eu-entendo-que-derruba-a-sessao-do-robo
 */
const FLAG = '--eu-entendo-que-derruba-a-sessao-do-robo';

const AJUDA = `
probe-prd-readonly-permissao-fin015 — sonda SOMENTE LEITURA dos itens de um rascunho do fin015

  Lê (list) os itens de um rascunho PRD existente e imprime contagens (sem códigos).
  NÃO escreve nada e NÃO prova permissão de PUT (V-PRD1 segue aberto).

  EFEITO COLATERAL: o login SUBSTITUI a sessão viva do robô em PRD (cap de sessões). Rode só com
  o go do maintainer, fora do horário de analista, com databaseConnectionString="".

  Variáveis: FIL (filial do lote), BNC (banco do lote), FLP (rascunho existente).
  Flag obrigatória: ${FLAG}
  Alternativa preferida: pedir à Conexos/Columbia a matriz de permissões do robô para o fin015.
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(AJUDA);
    process.exit(0);
}
if (!process.argv.includes(FLAG)) {
    console.error(
        `RECUSADO: este job derruba a sessão do robô em PRD. Rode com ${FLAG}.\n${AJUDA}`,
    );
    process.exit(1);
}
if (process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="" (não grava sessão em PRD).');
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 0);
const BNC = Number(process.env.BNC ?? 0);
const FLP = Number(process.env.FLP ?? 0);
if (!FIL || !BNC || !FLP) {
    console.error('RECUSADO: informe FIL, BNC e FLP (um rascunho existente).');
    process.exit(1);
}

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const client = container.resolve(ConexosSispagWriteClient);
    await base.ensureSid();
    const lido = await client.lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod: FLP });
    const contagem = {
        filCod: FIL,
        bncCod: BNC,
        flpCod: FLP,
        itens: lido.itens.length,
        completa: lido.completa,
        comIdentidade: lido.itens.filter((i) => i.itsCodSeq !== undefined).length,
        comCodigo: lido.itens.filter((i) => String(i.row.itsNumCodbar ?? '').trim() !== '').length,
        associadosAoDdaPeloErp: lido.itens.filter((i) => Number(i.row.vldVinculoDda) === 1).length,
    };
    console.log(JSON.stringify(contagem));
    console.log(
        'NÃO é prova de permissão de PUT (V-PRD1 segue aberto). Registre em ' +
            'ontology/_inbox/sispag-passo2-vinculo-codbar-sonda-prd.md.',
    );
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[sonda-prd] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
