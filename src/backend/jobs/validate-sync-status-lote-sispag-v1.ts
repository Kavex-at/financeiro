import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import ConexosTitulosClient from '../domain/client/ConexosTitulosClient.js';
import type { EstadoSincronizacaoItem } from '../domain/interface/sispag/SincronizacaoLote.js';
import type { LotePagamento } from '../domain/interface/sispag/SispagInterface.js';
import BoundedConcurrency from '../domain/libs/concurrency/BoundedConcurrency.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import type LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';
import LogService from '../domain/service/LogService.js';
import type NotificacaoService from '../domain/service/operacao/NotificacaoService.js';
import DecisaoStatusLote from '../domain/service/sispag/DecisaoStatusLote.js';
import SincronizacaoLoteService from '../domain/service/sispag/SincronizacaoLoteService.js';

/**
 * GROUND TRUTH — sincronização do status do lote SISPAG (ADR-0055, regra I11). READ-ONLY.
 *
 * Roda o `SincronizacaoLoteService` DE VERDADE (leituras reais do fin064, fin052 e PSQ_018) sobre
 * os dois lotes nativos do PG230901.REM, com um repositório EM MEMÓRIA: nada é gravado no nosso
 * banco, nada é escrito no ERP, nenhum alerta sai. Compara o que a sincronização DECIDIRIA com o
 * que foi verificado à mão:
 *
 *   - fil 2 / bnc 4 / flp 24 — 38682/1 (ATLANTIS, R$ 275,00): fin064 Valor Pago 275, Aberto 0;
 *     borderô 22320 criado e finalizado à mão por ERICA_VIANA em 24/09 12:47; fin052 gar 9 só BD.
 *     Esperado: item PAGO, lote BAIXADO, origemBaixa FORA_DO_RETORNO com borCod 22320 (se o
 *     PSQ_018 for legível para o robô) ou NAO_IDENTIFICADA (403, esperado hoje).
 *   - fil 1 / bnc 4 / flp 8 — 4030/7 (LATTINE, R$ 1.856,16): conforme o fin064 do dia.
 *     Esperado: PAGO → BAIXADO; senão AGENDADO (BD lido) e o lote permanece REMESSA_GERADA.
 *
 * Tolerância: zero divergência em situação e destino; valor pago exato ao centavo quando lido.
 *
 * ── SEGURANÇA ───────────────────────────────────────────────────────────────────────────
 * - Recusa rodar com `databaseConnectionString` preenchido: um login local com banco de produção
 *   grava a sessão de OUTRO usuário no slot do robô (`columbia-default`).
 * - Recusa rodar sem `GT_CONFIRMO_SESSAO=1`: cada login no Conexos PRD ocupa um dos ~3 slots de
 *   sessão do usuário e pode derrubar quem estiver usando o ERP.
 * - Preferência: rodar PÓS-DEPLOY pelo "Sincronizar agora" / rota de sincronização, que já roda com
 *   a sessão do robô no servidor, em vez deste script.
 *
 * Run (só com credencial do robô e janela combinada):
 *   cd src/backend
 *   databaseConnectionString= GT_CONFIRMO_SESSAO=1 CONEXOS_BASE_URL=... CONEXOS_USERNAME=... \
 *   CONEXOS_PASSWORD=... tsx jobs/validate-sync-status-lote-sispag-v1.ts
 */

if ((process.env.databaseConnectionString ?? '') !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="" (sessão do robô contaminável).');
    process.exit(1);
}
if (process.env.GT_CONFIRMO_SESSAO !== '1') {
    console.error(
        'RECUSADO: login no Conexos derruba sessões alheias. Confirme com GT_CONFIRMO_SESSAO=1.',
    );
    process.exit(1);
}

const REMESSA_GERADA_EM = '2026-09-23T15:00:00.000Z';

const lotes: LotePagamento[] = [
    {
        id: 'gt-fil2-flp24',
        filCod: 2,
        status: 'REMESSA_GERADA',
        criadoPor: 'ground-truth',
        versao: 1,
        nativeFilCod: 2,
        nativeBncCod: 4,
        nativeFlpCod: 24,
        remessaGeradaEm: REMESSA_GERADA_EM,
        itens: [
            {
                loteId: 'gt-fil2-flp24',
                filCod: 2,
                docCod: '38682',
                titCod: '1',
                incluidoPor: 'ground-truth',
                divergencia: false,
            },
        ],
    },
    {
        id: 'gt-fil1-flp8',
        filCod: 1,
        status: 'REMESSA_GERADA',
        criadoPor: 'ground-truth',
        versao: 1,
        nativeFilCod: 1,
        nativeBncCod: 4,
        nativeFlpCod: 8,
        remessaGeradaEm: REMESSA_GERADA_EM,
        itens: [
            {
                loteId: 'gt-fil1-flp8',
                filCod: 1,
                docCod: '4030',
                titCod: '7',
                incluidoPor: 'ground-truth',
                divergencia: false,
            },
        ],
    },
];

interface Linha {
    caso: string;
    esperado: string;
    obtido: string;
    veredito: 'EXATO' | 'DIVERGENTE';
}

async function main(): Promise<number> {
    await bootstrapAppContainer();
    const aplicados: Array<{ loteId: string; para?: string; itens: EstadoSincronizacaoItem[] }> =
        [];
    const porId = new Map(lotes.map((l) => [l.id, l]));
    // Repositório EM MEMÓRIA: a passada decide, mas nada chega ao banco.
    const repo = {
        listLotesSincronizaveis: async () => lotes.map((l) => l.id),
        getLoteComItens: async (id: string) => porId.get(id) ?? null,
        aplicarSincronizacao: async (a: {
            loteId: string;
            para?: string;
            itens: EstadoSincronizacaoItem[];
        }) => {
            aplicados.push(a);
            return 'APLICADO' as const;
        },
        tocarSincronizacao: async () => undefined,
    };
    const semAlerta = { emitir: async () => null };
    const sincronizacao = new SincronizacaoLoteService(
        repo as unknown as LotePagamentoRepository,
        container.resolve(ConexosSispagClient),
        container.resolve(ConexosTitulosClient),
        container.resolve(ConexosSispagRetornoClient),
        new DecisaoStatusLote(),
        semAlerta as unknown as NotificacaoService,
        container.resolve(LogService),
        new BoundedConcurrency(),
    );
    const titulo = container.resolve(ConexosSispagClient);
    const leitura4030 = await titulo.lerSituacaoTitulo(1, '4030', '7');
    const resumo = await sincronizacao.sincronizarTodos();

    const lote2 = aplicados.find((a) => a.loteId === 'gt-fil2-flp24');
    const lote1 = aplicados.find((a) => a.loteId === 'gt-fil1-flp8');
    const item38682 = lote2?.itens[0];
    const item4030 = lote1?.itens[0];
    const pago4030 = leitura4030.legivel && leitura4030.vldPago && leitura4030.aberto === 0;

    const linhas: Linha[] = [];
    const checar = (caso: string, esperado: string, obtido: string): void => {
        linhas.push({
            caso,
            esperado,
            obtido,
            veredito: esperado === obtido ? 'EXATO' : 'DIVERGENTE',
        });
    };
    checar('38682/1 situação', 'PAGO', String(item38682?.situacao));
    checar('fil 2/flp 24 destino', 'BAIXADO', String(lote2?.para));
    checar(
        '38682/1 origem',
        item38682?.borCod !== undefined ? 'FORA_DO_RETORNO' : 'NAO_IDENTIFICADA',
        String(item38682?.origemBaixa),
    );
    if (item38682?.borCod !== undefined) {
        checar('38682/1 borderô', '22320', String(item38682.borCod));
        if (item38682.valorPago !== undefined) {
            checar('38682/1 valor pago', '275.00', item38682.valorPago.toFixed(2));
        }
    }
    checar('38682/1 evento fin052', 'BD', String(item38682?.retornoEvento));
    checar('4030/7 situação', pago4030 ? 'PAGO' : 'AGENDADO', String(item4030?.situacao));
    checar(
        'fil 1/flp 8 destino',
        pago4030 ? 'BAIXADO' : 'permanece',
        String(lote1?.para ?? 'permanece'),
    );

    console.log('='.repeat(78));
    console.log('GROUND TRUTH — sync-status-lote-sispag v1 (read-only)');
    console.log(`fin064 4030/7: ${JSON.stringify(leitura4030)}`);
    console.log(
        `resumo: lotes=${resumo.lotes} transicionados=${resumo.transicionados} ` +
            `falhas de leitura=${resumo.falhasLeitura} eventos não lidos=${resumo.eventosNaoLidos}`,
    );
    for (const l of linhas) {
        console.log(
            `${l.veredito.padEnd(10)} ${l.caso.padEnd(24)} esperado=${l.esperado} obtido=${l.obtido}`,
        );
    }
    const divergentes = linhas.filter((l) => l.veredito === 'DIVERGENTE').length;
    console.log(divergentes === 0 ? 'PASS' : `FAIL — ${divergentes} divergência(s) (P0)`);
    return divergentes === 0 ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(
            '[gt-sync-lote] FATAL:',
            redactErrorMessage(e instanceof Error ? e.message : String(e)),
        );
        process.exit(1);
    });
