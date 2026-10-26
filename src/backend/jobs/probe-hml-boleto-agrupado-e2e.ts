import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaixaClient, { IDENTIDADE_BORDERO } from '../domain/client/ConexosBaixaClient.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import ConexosError from '../domain/errors/ConexosError.js';
import type { LotePagamento, TituloAPagar } from '../domain/interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido from '../domain/libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';
import ValorAbertoLiquido from '../domain/libs/boleto/ValorAbertoLiquido.js';
import BoletoDdaRepository from '../domain/repository/sispag/BoletoDdaRepository.js';
import GrupoBoletoExecucaoRepository from '../domain/repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../domain/repository/sispag/GrupoBoletoRepository.js';
import SugestaoBoletoRepository from '../domain/repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';
import GrupoBoletoService from '../domain/service/sispag/GrupoBoletoService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import GuardaHmlE2e, { FASES_E2E } from './hmlE2eGuarda.js';

/**
 * HML (ESCREVE) — prova ponta a ponta do boleto agrupado com o código de PRODUÇÃO (Task 21,
 * ADR-0077). Roda `GrupoBoletoService`, `LotePagamentoService`, `RemessaService.gerarRemessa` e
 * `ConciliacaoRetornoService` de verdade, com os clients reais contra o Conexos de HML. O único
 * papel do job é fazer o BANCO: gerar o `.RET` sintético a partir do `.REM` que o ERP devolveu.
 * Nenhuma escrita do Conexos é feita pelo job (borderô, baixa, lote, import, barra: tudo é do serviço).
 *
 * Fases (`FASE`; as que ESCREVEM exigem HML_AUTORIZO_ESCRITA=<hoje>):
 *   plano      (padrão) só leitura: lê os títulos em HML e mostra o que as outras fases fariam
 *   canonico   2 títulos do mesmo credor → grupo confirmado → lote → preparar_bordero → UM item de
 *              borderô → barra (modalidade 7) → finalizar → `.REM` com UM J (barra == pagamento ==
 *              Σ) → retorno sintético `00` sem J-52 (H8) → N títulos `vldPago 1`, borderô
 *              finalizado pelo ERP, grupo `PAGO`
 *   falha      V3: barra recusada pelo ERP (banco 329, `BANCO_NAO_CADASTRADO`) depois do import ⇒
 *              grupo retirado, borderô limpo e AUSENTE na releitura, pelo código de produção
 *   retomada   processo "morre" depois do `POST fin010` (resposta descartada): a retomada acha o
 *              borderô pela janela `borTimCad` e NÃO cria outro
 *   v7         retorno sintético de REJEIÇÃO ⇒ grupo `REJEITADO` + Alerta; inclusão manual num lote
 *              novo ⇒ borderô antigo reaproveitado (se aparecer em `borderosPendentes`) ou grupo
 *              retirado com `BORDERO_ANTERIOR_NAO_RESOLVIDO`; nunca dois borderôs vivos
 *   estado     só leitura: grupos locais e títulos em HML
 *
 * AUTORIZAÇÃO: ESCREVE em HML (lote nativo, borderô, baixas, retorno). Só roda depois da
 * autorização explícita da pessoa responsável, datada de hoje (`HML_AUTORIZO_ESCRITA=AAAA-MM-DD`).
 *
 * TRAVAS: só HML (URL `-hml` + `HML_ENV_FILE`); o Postgres é LOCAL e descartável (os serviços de
 * produção gravam nele); barras SINTÉTICAS; código de barras só mascarado (5+4) no console e na
 * trilha; cada fase anexa em `${OUT}/trilha.jsonl`.
 *
 * Estado deixado em HML (documentar em `sispag-boleto-agrupado-hml-achados.md` depois de cada rodada):
 *   canonico  lote nativo finalizado + `.REM` + retorno processado; borderô finalizado; títulos baixados
 *             (NÃO reversível pelo job: use títulos de teste dedicados)
 *   falha     lote nativo FINALIZADO NÃO — o rascunho fica; borderô excluído, títulos em aberto
 *   retomada  lote nativo em rascunho com o item de borderô, ou limpo se a rodada terminar em retirada
 *   v7        dois lotes nativos; borderô do grupo em cadastro ou limpo conforme o caminho (V7)
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString=postgres://postgres:test@localhost:55432/sispag_agrupado_e2e \
 *   DOCS=552/1,558/1 VENC_BOLETO=2026-10-30 FASE=plano npx tsx jobs/probe-hml-boleto-agrupado-e2e.ts
 */

const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const GTB = Number(process.env.GTB ?? 1);
const FASE = process.env.FASE ?? 'plano';
const ATOR = process.env.ATOR ?? 'e2e-hml';
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-boleto-agrupado-e2e';
/** Banco da barra sintética (≠ banco do lote ⇒ modalidade 7) e o que o ERP recusa em HML. */
const BANCO_BARRA = process.env.BANCO_BARRA ?? '422';
const BANCO_RECUSADO = process.env.BANCO_RECUSADO ?? '329';
/** Posição da ocorrência no J do `.RET` (confirmar no `ger015` salvo da conta). */
const POS_OC = Number(process.env.POS_OC ?? 231);
const OCORRENCIA_REJEICAO = process.env.OCORRENCIA_REJEICAO ?? 'AE';
const VENC_BOLETO = process.env.VENC_BOLETO ?? '';
const DOCS = (process.env.DOCS ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => {
        const [doc, tit] = s.split('/');
        return { doc: String(doc), tit: String(tit ?? '1') };
    });

/** Hoje em Brasília (`AAAA-MM-DD`): a autorização vale pelo dia civil da pessoa responsável. */
const hojeBrt = (): string => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

const veredito = GuardaHmlE2e.avaliar({
    ...(process.env.CONEXOS_BASE_URL !== undefined
        ? { conexosBaseUrl: process.env.CONEXOS_BASE_URL }
        : {}),
    ...(process.env.HML_ENV_FILE !== undefined ? { hmlEnvFile: process.env.HML_ENV_FILE } : {}),
    ...(process.env.databaseConnectionString !== undefined
        ? { databaseConnectionString: process.env.databaseConnectionString }
        : {}),
    ...(process.env.HML_AUTORIZO_ESCRITA !== undefined
        ? { autorizaEscrita: process.env.HML_AUTORIZO_ESCRITA }
        : {}),
    fase: FASE,
    hoje: hojeBrt(),
});
if (!veredito.permitido) {
    console.error(`RECUSADO:\n - ${veredito.motivos.join('\n - ')}`);
    process.exit(1);
}

// Os serviços de produção só escrevem com estas três chaves; este job é HML (a guarda acima).
process.env.CONEXOS_WRITE_ENABLED = 'true';
process.env.CONEXOS_DRY_RUN = 'false';
process.env.SISPAG_LIVE_WRITE_ENABLED = 'true';
// O vínculo por título fica `off`: a barra do borderô independe dele (P0-5).
process.env.SISPAG_BIND_CODBAR_FILIAIS = '';

type Row = Record<string, unknown>;
const mask = (m: string): string => AnaliseCodigoBarrasRepetido.mascarar(m);
const txt = (v: unknown, n = 500): string => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return (s ?? '').replace(/\d{44,47}/g, (m) => mask(m.slice(0, 44))).slice(0, n);
};
const erro = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const log = (m: string): void => console.log(`[hml-e2e] ${m}`);
const trilha = (fase: string, dados: Row): void => {
    mkdirSync(OUT, { recursive: true });
    appendFileSync(
        `${OUT}/trilha.jsonl`,
        `${JSON.stringify({ em: new Date().toISOString(), fase, ...dados })}\n`,
    );
};

/** Verificações da fase: o veredito final sai do que foi OBSERVADO, nunca de um status HTTP. */
const checagens: Array<{ nome: string; ok: boolean; detalhe: string }> = [];
const checar = (nome: string, ok: boolean, detalhe = ''): void => {
    checagens.push({ nome, ok, detalhe });
    log(`${ok ? 'OK    ' : 'FALHOU'} ${nome}${detalhe ? ` — ${txt(detalhe, 300)}` : ''}`);
    trilha('checagem', { nome, ok, detalhe: txt(detalhe, 300) });
};

interface TituloHml {
    titulo: TituloAPagar;
    liquidoCentavos: number;
}

/** Lê os `DOCS` em HML (só leitura): a identidade e o líquido ao vivo (régua da I17b). */
const lerTitulosHml = async (): Promise<TituloHml[]> => {
    const sispag = container.resolve(ConexosSispagClient);
    const lidos: TituloHml[] = [];
    for (const { doc, tit } of DOCS) {
        const titulo = await sispag.getTituloAPagar(FIL, doc, tit);
        if (!titulo) throw new Error(`título ${doc}/${tit} não existe em HML (filial ${FIL})`);
        const aberto = await sispag.lerValoresAberto(FIL, doc, tit);
        const liquido = aberto.legivel
            ? ValorAbertoLiquido.calcularCentavos(aberto.valores)
            : undefined;
        if (liquido === undefined) throw new Error(`líquido de ${doc}/${tit} ilegível em HML`);
        lidos.push({ titulo, liquidoCentavos: liquido });
    }
    return lidos;
};

const exigirPreparo = (titulos: TituloHml[]): void => {
    if (titulos.length < 2) throw new Error('informe DOCS=doc/tit,doc/tit (dois títulos ou mais).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(VENC_BOLETO)) {
        throw new Error(
            'informe VENC_BOLETO=AAAA-MM-DD (hoje+2 em diante, até 10 dias depois dos títulos).',
        );
    }
    const credores = new Set(titulos.map((t) => t.titulo.pesCod));
    if (credores.size !== 1) throw new Error('os títulos precisam ser do MESMO credor (pesCod).');
};

interface Cenario {
    ddcCod: number;
    ditCod: number;
    titulos: TituloHml[];
    somaCentavos: number;
    barras: string;
}

let proximoDdc = 990_000 + (Math.floor(Date.now() / 1000) % 9000);

/**
 * Semeia o Postgres LOCAL com o que a produção leria do ERP e do DDA: os títulos (dados reais de
 * HML), UM boleto do pool com barra SINTÉTICA (Σ do líquido) e o par credor×emissor vigente.
 */
const semear = async (titulos: TituloHml[], banco: string): Promise<Cenario> => {
    const somaCentavos = titulos.reduce((a, t) => a + t.liquidoCentavos, 0);
    const ddcCod = proximoDdc++;
    const ditCod = 1;
    const barras = CodigoBarrasSintetico.barras({
        valor: somaCentavos / 100,
        vencimento: VENC_BOLETO,
        banco,
        serie: ddcCod % 1000,
    });
    await container.resolve(TituloAPagarRepository).upsertMany(
        titulos.map((t) => ({
            ...t.titulo,
            liberado: true,
            pago: false,
            temBoleto: false,
            formaPagamentoConexos: t.titulo.formaPagamentoConexos ?? 6,
            ativo: true,
        })),
        randomUUID(),
    );
    await container
        .resolve(BoletoDdaRepository)
        .salvarArquivo(
            { ddcCod, nome: 'E2E-HML (sintético)', importadoEm: Date.now(), status: 1 },
            [
                {
                    ddcCod,
                    ditCod,
                    numero: `E2E${ddcCod}`,
                    valor: somaCentavos / 100,
                    vencimento: VENC_BOLETO,
                    codbar: barras,
                },
            ],
        );
    const emissor = container.resolve(CodigoBarrasBoleto).emissor(barras);
    const primeiro = titulos[0]?.titulo;
    if (!emissor || !primeiro?.pesCod) throw new Error('sem emissor ou credor para o par.');
    await container.resolve(SugestaoBoletoRepository).inserirPar({
        pesCod: primeiro.pesCod,
        ...(primeiro.credor ? { credor: primeiro.credor } : {}),
        emissorChave: emissor.chave,
        layoutEmissor: emissor.layout,
        bancoEmissor: emissor.banco,
        emissorMascarado: emissor.mascarado,
        evidencia: { origem: 'e2e-hml', tier: 'MANUAL' },
        confirmadoPor: ATOR,
    });
    log(`semeado: ${titulos.length} títulos, boleto ${mask(barras)}, Σ ${somaCentavos} centavos`);
    trilha('semear', { ddcCod, boleto: mask(barras), somaCentavos });
    return { ddcCod, ditCod, titulos, somaCentavos, barras };
};

/** Confirma o grupo, monta o lote e o finaliza — tudo pelos serviços de produção. */
const montarLote = async (
    c: Cenario,
    loteExistente?: LotePagamento,
): Promise<{ grupoId: string; lote: LotePagamento }> => {
    const grupos = container.resolve(GrupoBoletoService);
    const lotes = container.resolve(LotePagamentoService);
    const { grupo } = await grupos.confirmar({
        origem: 'MANUAL',
        ddcCod: c.ddcCod,
        ditCod: c.ditCod,
        titulos: c.titulos.map((t) => ({
            filCod: t.titulo.filCod,
            docCod: t.titulo.docCod,
            titCod: t.titulo.titCod,
        })),
        reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
        ator: ATOR,
    });
    const rascunho = loteExistente ?? (await lotes.criarLote({ filCod: FIL, ator: ATOR }));
    const { lote } = await lotes.incluirGrupo({
        loteId: rascunho.id,
        grupoId: grupo.id,
        ator: ATOR,
    });
    const finalizado = await lotes.finalizarLote({
        loteId: lote.id,
        versao: lote.versao,
        ator: ATOR,
    });
    log(`grupo ${grupo.id} confirmado; lote ${lote.id} finalizado`);
    trilha('lote', { grupoId: grupo.id, loteId: lote.id });
    return { grupoId: grupo.id, lote: finalizado.lote };
};

/** O `.RET` do banco simulado: ocorrência nos J do `.REM`, sem J-52 (H8). */
const montarRetorno = (rem: string, ocorrencia: string): string => {
    const poke = (l: string, pos: number, v: string): string =>
        l.slice(0, pos - 1) + v + l.slice(pos - 1 + v.length);
    const linhas = rem
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .filter((l) => !(l[13] === 'J' && l.slice(17, 19) === '52'))
        .map((l0) => {
            let l = l0.padEnd(240, ' ').slice(0, 240);
            if (l[7] === '0') l = poke(l, 143, '2');
            if (l[7] === '3' && (l[13] === 'J' || l[13] === 'A')) {
                l = poke(l, POS_OC, ocorrencia.padEnd(10, ' '));
            }
            return l;
        });
    return `${linhas.join('\r\n')}\r\n`;
};

/** Entrega o `.RET` ao ERP como o banco faria e devolve o `garCodSeq` do arquivo carregado. */
const devolverRetorno = async (rem: string, nome: string, ocorrencia: string): Promise<number> => {
    const retorno = container.resolve(ConexosSispagRetornoClient);
    const arq = await retorno.carregarArquivoRetorno({
        filCod: FIL,
        bncCod: BNC,
        gtbCodSeq: GTB,
        fileName: nome.replace(/\.REM$/i, '.RET'),
        conteudo: Buffer.from(montarRetorno(rem, ocorrencia), 'latin1'),
    });
    if (arq.garCodSeq === undefined) throw new Error('o ERP não devolveu o garCodSeq do retorno.');
    if (ocorrencia === '00') {
        await retorno.processarArquivoRetorno({
            filCod: FIL,
            bncCod: BNC,
            gtbCodSeq: GTB,
            garCodSeq: Number(arq.garCodSeq),
            tipo: 1,
        });
    } else {
        // Rejeição: carregar basta; o processamento de uma rejeição pode não gerar baixa.
        await retorno
            .processarArquivoRetorno({
                filCod: FIL,
                bncCod: BNC,
                gtbCodSeq: GTB,
                garCodSeq: Number(arq.garCodSeq),
                tipo: 1,
            })
            .catch((e: unknown) => log(`processar (rejeição): ${txt(erro(e))}`));
    }
    trilha('retorno', { gar: arq.garCodSeq, ocorrencia });
    return Number(arq.garCodSeq);
};

/** Os J (sem J-52) de um `.REM`: barra mascarada, valor da barra e pagamento, em centavos. */
const lerJs = (
    rem: string,
): Array<{ mascara: string; barraCentavos: number; pagCentavos: number }> =>
    rem
        .split(/\r?\n/)
        .filter((l) => l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
        .map((l) => ({
            mascara: mask(l.slice(17, 61)),
            barraCentavos: Number(l.slice(26, 36)),
            pagCentavos: Number(l.slice(152, 167)),
        }));

/** Borderôs do grupo ainda VIVOS no `fin010` (presente e não cancelado), pela identidade. */
const borderosVivos = async (grupoId: string): Promise<number[]> => {
    const baixa = container.resolve(ConexosBaixaClient);
    const execs = await container.resolve(GrupoBoletoExecucaoRepository).listarPorGrupo(grupoId);
    const vivos: number[] = [];
    const vistos = new Set<string>();
    for (const e of execs) {
        if (e.borCod === undefined || e.borTimCad === undefined) continue;
        const chave = `${e.borCod}:${e.borTimCad}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const b = await baixa.buscarBorderoPorIdentidade({
            filCod: FIL,
            borCod: e.borCod,
            borTimCad: e.borTimCad,
        });
        if (b.situacao === IDENTIDADE_BORDERO.PRESENTE && b.bordero?.situacao !== 'cancelado') {
            vivos.push(e.borCod);
        }
    }
    return vivos;
};

const titulosPagos = async (titulos: TituloHml[]): Promise<boolean[]> => {
    const sispag = container.resolve(ConexosSispagClient);
    const r: boolean[] = [];
    for (const t of titulos) {
        const s = await sispag.lerSituacaoTitulo(FIL, t.titulo.docCod, t.titulo.titCod);
        r.push(s.legivel && s.vldPago === true && s.aberto === 0);
    }
    return r;
};

// ───────────────────────────────────────────────────────────────────────────── as fases

const faseCanonico = async (titulos: TituloHml[]): Promise<void> => {
    const c = await semear(titulos, BANCO_BARRA);
    const { grupoId, lote } = await montarLote(c);
    const r = await container.resolve(RemessaService).gerarRemessa({ loteId: lote.id, ator: ATOR });
    checar('remessa gerada', r.status === 'gerada', `status ${r.status}`);
    const js = lerJs(r.conteudo ?? '');
    checar('o .REM tem UM J', js.length === 1, `${js.length} J`);
    const j = js[0];
    checar(
        'barra == pagamento do J == Σ dos títulos',
        j !== undefined && j.barraCentavos === j.pagCentavos && j.pagCentavos === c.somaCentavos,
        j ? `${j.mascara} barra ${j.barraCentavos} pag ${j.pagCentavos} Σ ${c.somaCentavos}` : '',
    );
    const gar = await devolverRetorno(r.conteudo ?? '', r.arquivo ?? `lote${lote.id}.REM`, '00');
    await container.resolve(ConciliacaoRetornoService).conciliar({
        filCod: FIL,
        bncCod: BNC,
        gtbCodSeq: GTB,
        garCodSeq: gar,
        ator: ATOR,
    });
    checar('N títulos vldPago 1 no fin064', (await titulosPagos(titulos)).every(Boolean));
    const grupo = await container.resolve(GrupoBoletoRepository).buscarPorId(grupoId);
    checar('grupo PAGO', grupo?.estado === 'PAGO', `estado ${grupo?.estado}`);
    const exec = await container.resolve(GrupoBoletoExecucaoRepository).ultimaPorGrupo(grupoId);
    if (exec?.borCod !== undefined && exec.borTimCad !== undefined) {
        const b = await container.resolve(ConexosBaixaClient).buscarBorderoPorIdentidade({
            filCod: FIL,
            borCod: exec.borCod,
            borTimCad: exec.borTimCad,
        });
        checar(
            'borderô finalizado pelo ERP',
            b.situacao === IDENTIDADE_BORDERO.PRESENTE && b.bordero?.situacao === 'finalizado',
            `borCod ${exec.borCod}`,
        );
    } else {
        checar('borderô registrado no ledger do grupo', false);
    }
};

const faseFalha = async (titulos: TituloHml[]): Promise<void> => {
    // V3: o ERP recusa a barra (banco não cadastrado) DEPOIS do import ⇒ o serviço retira o grupo.
    const c = await semear(titulos, BANCO_RECUSADO);
    const { grupoId, lote } = await montarLote(c);
    const desfecho = await container
        .resolve(RemessaService)
        .gerarRemessa({ loteId: lote.id, ator: ATOR })
        .then(
            (r) => ({ ok: true as const, avisos: r.avisos ?? [] }),
            (e: unknown) => ({
                ok: false as const,
                nome: e instanceof Error ? e.name : '',
                msg: erro(e),
            }),
        );
    log(`gerarRemessa: ${txt(desfecho)}`);
    // Lote só com o grupo: ao sair o grupo, o lote esvazia e a guarda o declara (esperado).
    checar(
        'o grupo foi retirado pela guarda (aviso ou lote esvaziado)',
        desfecho.ok
            ? desfecho.avisos.length > 0
            : /Esvaziado|esvaziado|EMPTIED|BoletoLoteEsvaziado/.test(desfecho.nome + desfecho.msg),
        txt(desfecho),
    );
    const vivos = await borderosVivos(grupoId);
    checar(
        'borderô limpo: AUSENTE na releitura do fin010 (V3)',
        vivos.length === 0,
        `vivos ${vivos.join(',')}`,
    );
    checar(
        'títulos continuam em aberto em HML',
        (await titulosPagos(titulos)).every((p) => !p),
    );
    const retido = await container
        .resolve(PostgreeDatabaseClient)
        .selectMany(
            `SELECT 1 FROM titulo_bloqueio_duplicidade WHERE origem = 'GRUPO_BOLETO' AND estado = 'ATIVO' LIMIT 1`,
        );
    checar('marcas GRUPO_BOLETO criadas', retido.length > 0);
};

const faseRetomada = async (titulos: TituloHml[]): Promise<void> => {
    const c = await semear(titulos, BANCO_BARRA);
    const { grupoId, lote } = await montarLote(c);
    // A "queda": o POST fin010 VALE no ERP e a resposta se perde. Intercepta o HTTP genérico (não
    // o serviço): só o POST de criação do borderô, só na primeira vez.
    const base = container.resolve(ConexosBaseClient);
    const original = base.postGenericOnce.bind(base);
    let posts = 0;
    base.postGenericOnce = (async (path: string, ...resto: unknown[]) => {
        const r = await (original as (...a: unknown[]) => Promise<unknown>)(path, ...resto);
        if (path === 'fin010') {
            posts += 1;
            if (posts === 1) {
                throw new ConexosError({ endpoint: path, code: 'CONEXOS_UPSTREAM_TIMEOUT' });
            }
        }
        return r;
    }) as typeof base.postGenericOnce;
    const remessa = container.resolve(RemessaService);
    const primeira = await remessa.gerarRemessa({ loteId: lote.id, ator: ATOR }).then(
        () => 'ok',
        (e: unknown) => (e instanceof Error ? e.name : 'erro'),
    );
    log(`1ª tentativa: ${primeira} (esperado: incompleta/retomável)`);
    checar('a 1ª tentativa parou de forma retomável', primeira !== 'ok', primeira);
    const r = await remessa.gerarRemessa({ loteId: lote.id, ator: ATOR });
    base.postGenericOnce = original as typeof base.postGenericOnce;
    checar('a retomada concluiu', r.status === 'gerada', `status ${r.status}`);
    checar('houve UM POST fin010 (a retomada não criou outro)', posts === 1, `${posts} POST(s)`);
    const vivos = await borderosVivos(grupoId);
    checar(
        'exatamente UM borderô vivo para o grupo',
        vivos.length === 1,
        `vivos ${vivos.join(',')}`,
    );
};

const faseV7 = async (titulos: TituloHml[]): Promise<void> => {
    const c = await semear(titulos, BANCO_BARRA);
    const { grupoId, lote } = await montarLote(c);
    const r = await container.resolve(RemessaService).gerarRemessa({ loteId: lote.id, ator: ATOR });
    checar('remessa gerada', r.status === 'gerada', `status ${r.status}`);
    const gar = await devolverRetorno(
        r.conteudo ?? '',
        r.arquivo ?? `lote${lote.id}.REM`,
        OCORRENCIA_REJEICAO,
    );
    await container.resolve(ConciliacaoRetornoService).conciliar({
        filCod: FIL,
        bncCod: BNC,
        gtbCodSeq: GTB,
        garCodSeq: gar,
        ator: ATOR,
    });
    const listados = await container.resolve(GrupoBoletoService).listar({ filCod: FIL });
    const meu = listados.find((g) => g.id === grupoId);
    checar('grupo REJEITADO', meu?.situacao === 'REJEITADO', `situação ${meu?.situacao}`);
    const alertas = await container
        .resolve(PostgreeDatabaseClient)
        .selectMany(`SELECT 1 FROM alerta WHERE tipo = $tipo AND alvo = $alvo`, {
            tipo: 'sispag-bordero-grupo-pendente',
            alvo: grupoId,
        });
    checar('Alerta sispag-bordero-grupo-pendente emitido', alertas.length > 0);

    // Inclusão manual num lote NOVO: o serviço reconhece o borderô antigo ao vivo (I21s, PI-9).
    const novo = await montarLote(c);
    const r2 = await container
        .resolve(RemessaService)
        .gerarRemessa({ loteId: novo.lote.id, ator: ATOR })
        .then(
            (x) => ({ status: x.status, avisos: x.avisos ?? [] }),
            (e: unknown) => ({ status: 'erro', avisos: [erro(e)] }),
        );
    log(`V7 — 2ª remessa do grupo: ${txt(r2)}`);
    const execs = await container.resolve(GrupoBoletoExecucaoRepository).listarPorGrupo(grupoId);
    const reaproveitou = execs.some((e) => e.borCodReaproveitadoDe !== undefined);
    const retirou = execs.some((e) => e.motivo?.includes('BORDERO_ANTERIOR_NAO_RESOLVIDO'));
    trilha('v7', { reaproveitou, retirou, r2: txt(r2) });
    checar(
        'V7: o borderô antigo foi reaproveitado OU o grupo saiu com BORDERO_ANTERIOR_NAO_RESOLVIDO',
        reaproveitou || retirou || r2.status === 'erro',
        `reaproveitou ${reaproveitou}; retirou ${retirou}; ${txt(r2)}`,
    );
    const vivos = await borderosVivos(grupoId);
    checar(
        'nunca dois borderôs vivos para o grupo (fin010)',
        vivos.length <= 1,
        `vivos ${vivos.join(',')}`,
    );
    log(
        `V7 caminho comum: ${reaproveitou ? 'REAPROVEITADO' : retirou ? 'RETIRADO' : 'indefinido'}`,
    );
};

const fasePlano = async (titulos: TituloHml[]): Promise<void> => {
    log(`HML ${process.env.CONEXOS_BASE_URL}; fase ${FASE}; banco local`);
    for (const t of titulos) {
        log(
            `título ${t.titulo.docCod}/${t.titulo.titCod}: ${t.titulo.credor ?? '—'} pesCod ${t.titulo.pesCod ?? '—'} líquido ${t.liquidoCentavos} liberado ${t.titulo.liberado} pago ${t.titulo.pago}`,
        );
    }
    log(
        `fases que escrevem: canonico, falha, retomada, v7 (exigem HML_AUTORIZO_ESCRITA=${hojeBrt()})`,
    );
    log('nada foi escrito (plano).');
};

const faseEstado = async (): Promise<void> => {
    const grupos = await container.resolve(GrupoBoletoService).listar({ filCod: FIL });
    for (const g of grupos) {
        log(
            `grupo ${g.id}: ${g.situacao} · ${g.titulos.length} títulos · ${mask(g.codbarMascarado.padEnd(44, '0'))}`,
        );
    }
    log(`${grupos.length} grupo(s) no banco local.`);
};

const main = async (): Promise<number> => {
    await bootstrapAppContainer();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/inicio.txt`, `${new Date().toISOString()} fase ${FASE}\n`);
    log(`fases possíveis: ${FASES_E2E.join(', ')}`);
    if (FASE === 'estado') {
        await faseEstado();
        return 0;
    }
    const titulos = await lerTitulosHml();
    if (FASE === 'plano') {
        await fasePlano(titulos);
        return 0;
    }
    exigirPreparo(titulos);
    if (FASE === 'canonico') await faseCanonico(titulos);
    else if (FASE === 'falha') await faseFalha(titulos);
    else if (FASE === 'retomada') await faseRetomada(titulos);
    else if (FASE === 'v7') await faseV7(titulos);
    const falhas = checagens.filter((c) => !c.ok);
    log(`${checagens.length - falhas.length}/${checagens.length} checagens OK`);
    log(
        `ESTADO DEIXADO EM HML: registre em sispag-boleto-agrupado-hml-achados.md (trilha em ${OUT}/trilha.jsonl).`,
    );
    return falhas.length === 0 ? 0 : 2;
};

main()
    .then((codigo) => process.exit(codigo))
    .catch((e) => {
        console.error('[hml-e2e] FATAL:', txt(erro(e)));
        process.exit(1);
    });

export type { Row };
