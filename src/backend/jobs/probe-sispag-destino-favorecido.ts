import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — DE ONDE VEM o destino (favorecido) de um TED/PIX?
 *
 * CONTEXTO: o `probe-sispag-modalidades` (2026-09-28) mediu 3 TED e 16 crédito CC no histórico
 * nativo do fin015 e 0 PIX. A Q4 dele falhou (`fin005/cmnPessoasPix/list` exige `filCod`). As
 * chaves PIX de FORNECEDOR moram no cadastro da pessoa (`cmn025/cmnPessoasPix`, por `pesCod`);
 * as do `fin005` têm `ccoCod` e parecem ser da própria Columbia (conta pagadora).
 *
 * PERGUNTAS:
 *   D1. Nos itens TED (5) e crédito CC (1) nativos: que campos de destino o item carrega
 *       (`pctCodSeq`, banco/agência/conta, PIX)? O `pctCodSeq` aponta para uma conta ATIVA do
 *       cadastro (`cmn025/ctcorr`) e os dados batem — ou o item carrega dado digitado à mão?
 *   D2. Chaves PIX: `cmn025/cmnPessoasPix` por favorecido e `fin005/cmnPessoasPix` por filial.
 *   D3. Cobertura do cadastro na carteira ABERTA: dos favorecidos distintos de uma amostra do
 *       `fin064`, quantos têm conta ativa e quantos têm chave PIX ativa.
 *
 * SEGURANÇA: só `/list`. Nenhuma escrita. Conta, agência e chave saem MASCARADAS.
 *
 * Run:
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" npx tsx jobs/probe-sispag-destino-favorecido.ts
 * Env: PROBE_FILIAIS (default 1,2,4,6,7) · MAX_FAVORECIDOS (default 150, D3) · PROBE_OUT
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/sispag-destino-favorecido';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6,7')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
const MAX_FAVORECIDOS = Number(process.env.MAX_FAVORECIDOS ?? 150);

type Row = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const cheio = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== '';
const mascarar = (v: unknown): string => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    return s.length <= 4 ? '*'.repeat(s.length) : `${'*'.repeat(s.length - 3)}${s.slice(-3)}`;
};
const digitos = (v: unknown): string =>
    String(v ?? '')
        .replace(/\D/g, '')
        .replace(/^0+/, '');
const log = (...a: unknown[]): void => console.log('[destino]', ...a);
const save = (nome: string, dado: unknown): void => {
    writeFileSync(`${OUT}/${nome}`, JSON.stringify(dado, null, 2));
    log(`  ↳ salvo ${OUT}/${nome}`);
};

class ProbeDestinoFavorecido {
    private base = container.resolve(ConexosBaseClient);

    private listar = async (endpoint: string, filtro: Row, filCod?: number, pageSize = 100) => {
        const serviceName = endpoint.split('/')[0];
        const { rows } = await this.base.listGenericPaginated<Row>(
            endpoint,
            { fieldList: [], filterList: filtro, serviceName, pageNumber: 1, pageSize },
            filCod !== undefined ? { filCod } : undefined,
        );
        return rows;
    };

    private contasAtivas = async (pesCod: string, filCod: number): Promise<Row[]> =>
        (await this.listar('cmn025/ctcorr/list', { 'pesCod#EQ': pesCod }, filCod, 50)).filter(
            (c) => num(c.pctVldStatus) === 1,
        );

    private chavesPix = async (pesCod: string, filCod: number): Promise<Row[]> =>
        this.listar('cmn025/cmnPessoasPix/list', { 'pesCod#EQ': pesCod }, filCod, 50);

    public run = async (): Promise<void> => {
        mkdirSync(OUT, { recursive: true });
        await this.base.ensureSid();

        // ── D1: destino dos itens TED/crédito nativos ──────────────────────────
        log('\n── D1: itens TED (5) e crédito CC (1) nativos ──');
        const itens: Row[] = [];
        for (const filCod of FILIAIS) {
            const lotes = await this.listar('fin015/list', {}, filCod, 200);
            for (const l of lotes) {
                const rows = await this.listar(
                    `fin015/finItemSispag/list/${l.filCod}/${l.bncCod}/${l.flpCod}`,
                    {},
                    filCod,
                    200,
                );
                for (const it of rows) {
                    const m = num(it.itsVldModalidade);
                    if (m === 1 || m === 5 || num(it.itsVldChavePix) === 1) itens.push(it);
                }
            }
        }
        const d1 = [];
        for (const it of itens) {
            const pesCod = String(it.pesCod ?? '');
            const filCod = Number(it.filCod);
            const contas = pesCod ? await this.contasAtivas(pesCod, filCod) : [];
            const pct = num(it.pctCodSeq);
            const conta = contas.find((c) => num(c.pctCodSeq) === pct);
            d1.push({
                filCod,
                flpCod: it.flpCod,
                modalidade: num(it.itsVldModalidade),
                pesCod,
                campos: {
                    pctCodSeq: pct !== undefined,
                    itsNumBanco: num(it.itsNumBanco),
                    agencia: mascarar(it.agencia ?? it.pctEspNumAgencia),
                    conta: mascarar(it.conta),
                    chavePix: num(it.itsVldChavePix) === 1,
                    desChavePix: mascarar(it.itsDesChavePix),
                    locPix: cheio(it.itsEspLocPix),
                    txidPix: cheio(it.itsEspTxidPix),
                    idTransferencia: num(it.itsVldIdTransferencia),
                },
                cadastro: {
                    contasAtivas: contas.length,
                    pctCodSeqEncontrado: Boolean(conta),
                    bancoBate: conta ? num(conta.pctNumBanco) === num(it.itsNumBanco) : undefined,
                    contaBate: conta
                        ? digitos(conta.pctEspNumContaBanc) !== '' &&
                          digitos(it.conta).startsWith(digitos(conta.pctEspNumContaBanc))
                        : undefined,
                },
            });
        }
        save('d1-itens-transferencia.json', d1);

        // ── D2: chaves PIX ─────────────────────────────────────────────────────
        log('\n── D2: chaves PIX ──');
        const fin005: Row[] = [];
        for (const filCod of FILIAIS) {
            try {
                fin005.push(
                    ...(await this.listar(
                        'fin005/cmnPessoasPix/list',
                        { 'filCod#EQ': filCod },
                        filCod,
                        200,
                    )),
                );
            } catch (e) {
                log(`fin005/cmnPessoasPix fil=${filCod} FALHOU (${(e as Error).message})`);
            }
        }
        save('d2-fin005-chaves.json', {
            total: fin005.length,
            pessoas: new Set(fin005.map((r) => String(r.pesCod))).size,
            comCcoCod: fin005.filter((r) => cheio(r.ccoCod)).length,
            porTipo: fin005.reduce<Record<string, number>>((acc, r) => {
                const k = String(r.cixVldTipo ?? '?');
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
            }, {}),
            amostra: fin005.slice(0, 5).map((r) => ({
                pesCod: r.pesCod,
                filCod: r.filCod,
                ccoCod: r.ccoCod,
                tipo: r.cixVldTipo,
                situacao: r.cixVldSituacao,
                chave: mascarar(r.cixDesChave),
            })),
        });

        // ── D3: cobertura do cadastro na carteira aberta ───────────────────────
        log('\n── D3: cobertura do cadastro (conta × PIX) ──');
        const favorecidos = new Map<string, number>();
        for (const it of itens) {
            if (it.pesCod != null) favorecidos.set(String(it.pesCod), Number(it.filCod));
        }
        for (const filCod of FILIAIS) {
            if (favorecidos.size >= MAX_FAVORECIDOS) break;
            const titulos = await this.listar(
                'fin064/list',
                { 'vldPago#EQ': 0, 'docVldPrevisao#EQ': 0 },
                filCod,
                200,
            );
            for (const t of titulos) {
                if (favorecidos.size >= MAX_FAVORECIDOS) break;
                if (t.pesCod != null && !favorecidos.has(String(t.pesCod))) {
                    favorecidos.set(String(t.pesCod), filCod);
                }
            }
        }
        const cobertura = {
            consultados: 0,
            falhas: 0,
            comConta: 0,
            comPix: 0,
            comAmbos: 0,
            semNada: 0,
            pixPorTipo: {} as Record<string, number>,
            pixErro: undefined as string | undefined,
        };
        for (const [pesCod, filCod] of favorecidos) {
            cobertura.consultados += 1;
            try {
                const contas = await this.contasAtivas(pesCod, filCod);
                let pix: Row[] = [];
                try {
                    pix = (await this.chavesPix(pesCod, filCod)).filter(
                        (c) => num(c.cixVldSituacao) === 1,
                    );
                } catch (e) {
                    cobertura.pixErro = (e as Error).message;
                }
                for (const c of pix) {
                    const k = String(c.cixVldTipo ?? '?');
                    cobertura.pixPorTipo[k] = (cobertura.pixPorTipo[k] ?? 0) + 1;
                }
                const temConta = contas.length > 0;
                const temPix = pix.length > 0;
                if (temConta) cobertura.comConta += 1;
                if (temPix) cobertura.comPix += 1;
                if (temConta && temPix) cobertura.comAmbos += 1;
                if (!temConta && !temPix) cobertura.semNada += 1;
            } catch {
                cobertura.falhas += 1;
            }
        }
        save('d3-cobertura.json', cobertura);

        console.log(`\n${'='.repeat(78)}`);
        console.log('D1 — itens TED/crédito/PIX nativos');
        console.table(
            d1.map((d) => ({
                fil: d.filCod,
                mod: d.modalidade,
                pct: d.campos.pctCodSeq,
                banco: d.campos.itsNumBanco,
                conta: d.campos.conta,
                pix: d.campos.chavePix,
                noCadastro: d.cadastro.pctCodSeqEncontrado,
                bancoBate: d.cadastro.bancoBate,
                contaBate: d.cadastro.contaBate,
            })),
        );
        console.log('D2 — fin005/cmnPessoasPix', fin005.length, 'chaves');
        console.log('D3 — cobertura', JSON.stringify(cobertura));
        console.log('='.repeat(78));
    };
}

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    await new ProbeDestinoFavorecido().run();
};
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
