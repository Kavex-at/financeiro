import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';

/**
 * EXPERIMENTO HML — passo 2 da ADR-0068: o que o ERP faz com um código de barras que NÓS
 * informamos para um item cujo valor/vencimento diferem do boleto?
 *
 * Usa `POST fin015/finItemSispag/validacao/codigoBarras` (`FinItemCodigoBarrasDTO`): é o contrato
 * do próprio ERP para quem digita o código de barras no item — recebe `itsNumCodbar`, o líquido do
 * título, JUROS e DESCONTO, e devolve valor/data do código (`barraVlrPgto`, `barraDtaVencimento`)
 * e o resultado (`itsMnyVlrPgtoResult`, `itsDtaPgtoResult`). Não recebe a chave de nenhum item,
 * logo é uma conta, não uma gravação — mesmo assim só roda em HML.
 *
 * Os códigos de barras são SINTÉTICOS (DV módulo 11 válido, banco 341): nenhum boleto real
 * entra neste experimento.
 *
 * SEGURANÇA: só roda se `CONEXOS_BASE_URL` contém `-hml`. Sem EXECUTAR=1 imprime os corpos e sai.
 *
 * Run (de src/backend):
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api databaseConnectionString="" \
 *     PROBE_OUT=<dir> npx tsx jobs/probe-hml-validacao-codbar.ts            # dry: só imprime
 *   ... EXECUTAR=1 ...                                                        # chama o ERP
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const EXECUTAR = process.env.EXECUTAR === '1';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-validacao-codbar';
const DAY = 24 * 60 * 60 * 1000;
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-codbar] ${s}`);

/** Fator de vencimento FEBRABAN (reinicia em 1000 a partir de 22/02/2025). */
const fator = (epochUtcMidnight: number): number => {
    const reinicio = Date.UTC(2025, 1, 22);
    if (epochUtcMidnight >= reinicio) return 1000 + Math.round((epochUtcMidnight - reinicio) / DAY);
    return Math.round((epochUtcMidnight - Date.UTC(1997, 9, 7)) / DAY);
};

const dvModulo11 = (corpo43: string): string => {
    let soma = 0;
    let peso = 2;
    for (let i = corpo43.length - 1; i >= 0; i -= 1) {
        soma += Number(corpo43[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const dv = 11 - (soma % 11);
    return dv === 0 || dv === 10 || dv === 11 ? '1' : String(dv);
};

/** 44 dígitos: banco(3) moeda(1) DV(1) fator(4) valor(10) livre(25). Banco 341, livre sintético. */
const codbar = (valor: number, vencEpoch: number): string => {
    const livre = '1090000000012345678901234'.slice(0, 25); // sintético (25 dígitos)
    const corpo =
        '3419' +
        String(fator(vencEpoch)).padStart(4, '0') +
        String(Math.round(valor * 100)).padStart(10, '0') +
        livre;
    return `${corpo.slice(0, 4)}${dvModulo11(corpo)}${corpo.slice(4)}`;
};

const dia = (ms?: number): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const conv = new CodigoBarrasBoleto();
    console.log('='.repeat(78));
    console.log(
        `BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} · ${EXECUTAR ? 'EXECUTAR' : 'dry-run'}`,
    );
    console.log('='.repeat(78));
    await base.ensureSid();
    log('login OK');

    // ── contexto de leitura: qualquer lote nativo da filial/banco
    const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
    log(`lotes nativos fil=${FIL} bnc=${BNC}: ${lotes.length}`);
    const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
    if (!ctx) {
        log('nenhum lote nativo para servir de contexto de leitura — nada a fazer.');
        return;
    }
    const pend = await write.listarTitulosPendentes({
        filCod: FIL,
        bncCod: BNC,
        flpCod: ctx.flpCod,
    });
    log(`pendentes no contexto flp=${ctx.flpCod}: ${pend.length}`);
    // alvo: título SEM flag DDA, com valor > 0, preferindo vencimento mais distante
    const alvo = pend
        .filter((p) => !p.temBoletoDda && (p.valor ?? 0) > 0 && p.vencimento)
        .sort((a, b) => (b.vencimento ?? 0) - (a.vencimento ?? 0))[0];
    if (!alvo?.valor || !alvo.vencimento) {
        log('nenhum título sem flag com valor/vencimento em HML.');
        return;
    }
    const valor = alvo.valor;
    const venc = alvo.vencimento;
    log(
        `alvo: doc=${alvo.docCod}/${alvo.titCod} valor=${valor} venc=${dia(venc)} (flag DDA = ${alvo.temBoletoDda})`,
    );
    writeFileSync(
        `${OUT}/alvo.json`,
        JSON.stringify(
            {
                docCod: alvo.docCod,
                titCod: alvo.titCod,
                valor,
                venc: dia(venc),
                flpContexto: ctx.flpCod,
            },
            null,
            2,
        ),
    );

    const c = (v: number, d: number): string => codbar(v, venc + d * DAY);
    const corrompe = (s: string): string =>
        `${s.slice(0, 10)}${(Number(s[10]) + 1) % 10}${s.slice(11)}`;
    const casos: Array<{ id: string; descricao: string; codbar: string }> = [
        {
            id: 'C1',
            descricao: 'controle: valor e dia iguais (linha digitável 47)',
            codbar: conv.paraLinhaDigitavel(c(valor, 0)) ?? '',
        },
        { id: 'C1b', descricao: 'controle: valor e dia iguais (44 dígitos)', codbar: c(valor, 0) },
        {
            id: 'C2',
            descricao: 'boleto +R$ 0,01 no mesmo dia',
            codbar: conv.paraLinhaDigitavel(c(valor + 0.01, 0)) ?? '',
        },
        {
            id: 'C3',
            descricao: 'boleto -R$ 0,01 no mesmo dia',
            codbar: conv.paraLinhaDigitavel(c(valor - 0.01, 0)) ?? '',
        },
        {
            id: 'C4',
            descricao: 'boleto +1,6 %',
            codbar: conv.paraLinhaDigitavel(c(Math.round(valor * 1.016 * 100) / 100, 0)) ?? '',
        },
        {
            id: 'C5',
            descricao: 'valor igual, vence +1 dia',
            codbar: conv.paraLinhaDigitavel(c(valor, 1)) ?? '',
        },
        {
            id: 'C6',
            descricao: 'valor igual, vence +5 dias',
            codbar: conv.paraLinhaDigitavel(c(valor, 5)) ?? '',
        },
        {
            id: 'C7',
            descricao: 'valor igual, vence -1 dia (antes do título)',
            codbar: conv.paraLinhaDigitavel(c(valor, -1)) ?? '',
        },
        {
            id: 'C8',
            descricao: 'valor igual, vencido há 30 dias',
            codbar: conv.paraLinhaDigitavel(c(valor, -30)) ?? '',
        },
        { id: 'C9', descricao: 'DV inválido (44 dígitos)', codbar: corrompe(c(valor, 0)) },
        {
            id: 'C10',
            descricao: 'comprimento inválido (43 dígitos)',
            codbar: c(valor, 0).slice(0, 43),
        },
    ];

    const resultados: Row[] = [];
    for (const k of casos) {
        const body = {
            bncCodLote: BNC,
            itsNumCodbar: k.codbar,
            itsVldModalidade: 6,
            titDtaVencimento: venc,
            titMnyLiquido: valor,
            titMnyJuros: 0,
            titMnyDesconto: 0,
            itsMnyVlrPgto: valor,
        };
        log(`${k.id} ${k.descricao}: itsNumCodbar=${k.codbar.length} díg.`);
        if (!EXECUTAR) {
            resultados.push({
                id: k.id,
                descricao: k.descricao,
                dry: true,
                body: { ...body, itsNumCodbar: `<${k.codbar.length} dígitos>` },
            });
            continue;
        }
        try {
            const resp = await base.postGenericOnce<unknown>(
                'fin015/finItemSispag/validacao/codigoBarras',
                body,
                { filCod: FIL },
            );
            resultados.push({ id: k.id, descricao: k.descricao, ok: true, resposta: resp as Row });
            log(`   → OK ${JSON.stringify(resp).slice(0, 220)}`);
        } catch (e) {
            const err = e as Record<string, unknown>;
            const resumo = {
                message: String(err.message ?? e).slice(0, 400),
                userMessage: err.userMessage,
                status: err.status ?? err.statusCode,
                details: err.details ?? err.response,
            };
            resultados.push({ id: k.id, descricao: k.descricao, ok: false, erro: resumo });
            log(`   → ERRO ${JSON.stringify(resumo).slice(0, 300)}`);
        }
    }
    writeFileSync(`${OUT}/resultados.json`, JSON.stringify(resultados, null, 2));
    log(`salvo ${OUT}/resultados.json`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-codbar] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
