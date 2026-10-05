import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import DestinoManualValidator from '../../libs/sispag/DestinoManualValidator.js';
import ExcecaoDestinoRule from '../../libs/sispag/ExcecaoDestinoRule.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import ExcecaoDestinoService, { type AtorExcecao } from './ExcecaoDestinoService.js';
import ExcecaoSubstituicaoService from './ExcecaoSubstituicaoService.js';

/**
 * `ExcecaoDestinoService` + resolver + aposentadoria contra um Postgres DE VERDADE (ADR-0060):
 * o ciclo registrar → aprovar com a regra aprovador ≠ cadastrante, a revogação que tira a exceção
 * da resolução e a varredura de aposentadoria idempotente. O Conexos é mockado (só leitura).
 *
 * Não roda no `npm test`; roda no `npm run test:sql` (ver `0075_sispag_excecao_destino.integration.test.ts`).
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `excecao_service_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'excecao_service_it';
const DOC = '11144477735';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const ator = (id: string): AtorExcecao => ({ id, permissoes: new Set(['sispag:excecao']) });

const ENTRADA = (conta = '99887766') => ({
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta,
    contaDv: '1',
    titularDocumento: DOC,
});

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('ExcecaoDestinoService (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: ExcecaoDestinoRepository;
    let svc: ExcecaoDestinoService;
    const contasDoCadastro = new Map<string, unknown[]>();
    const notificacao = { emitir: jest.fn().mockResolvedValue({}) };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };

    const eventos = async (id: string): Promise<string[]> =>
        (
            await db.query(
                'SELECT evento FROM excecao_destino_audit WHERE excecao_id = $1 ORDER BY ocorrido_em, id',
                [id],
            )
        ).rows.map((r) => r.evento);

    const registrar = (pesCod: string, conta?: string) =>
        svc.registrar({
            ator: ator('ana'),
            filCod: 1,
            pesCod,
            destino: ENTRADA(conta),
            justificativa: 'cadastro desatualizado',
        });

    beforeAll(async () => {
        const dsn = ADMIN_DSN ?? '';
        const host = new URL(dsn).hostname;
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
            throw new Error(`METRICAS_CICLO_TEST_DSN precisa ser local; recebido host "${host}"`);
        }
        const raiz = new Client({ connectionString: dsn });
        await raiz.connect();
        await raiz.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
        await raiz.query(`CREATE DATABASE ${BANCO}`);
        await raiz.end();

        const dsnBanco = dsnPara(dsn, BANCO);
        db = new Client({ connectionString: dsnBanco });
        await db.connect();
        const dir = path.join(__dirname, '../../../migrations');
        for (const arquivo of readdirSync(dir)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()) {
            await db.query(readFileSync(path.join(dir, arquivo), 'utf8'));
        }

        const env = {
            getEnvironmentVars: async () => ({
                databaseConnectionString: dsnBanco,
                sispagExcecaoDestinoEnabled: true,
            }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        repo = new ExcecaoDestinoRepository(pool);
        const sispag = {
            getDocumentoFavorecido: jest.fn().mockResolvedValue(DOC),
            getTituloAPagar: jest.fn().mockResolvedValue({ pesCod: '9001' }),
            listContasFavorecido: jest.fn(
                async (pesCod: string) => contasDoCadastro.get(pesCod) ?? [],
            ),
            listChavesPixFavorecido: jest.fn().mockResolvedValue([]),
        } as unknown as ConexosSispagClient;
        const mask = new MaskDestino();
        const substituicao = new ExcecaoSubstituicaoService(
            repo,
            notificacao as unknown as NotificacaoService,
            mask,
            log as unknown as LogService,
        );
        const resolver = new DestinoPagamentoResolver(sispag, mask, repo, substituicao);
        const validator = new DestinoManualValidator();
        svc = new ExcecaoDestinoService(
            repo,
            new ExcecaoDestinoRule(validator),
            validator,
            sispag,
            env,
            log as unknown as LogService,
            mask,
            resolver,
        );
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('registrar → PENDENTE; o próprio cadastrante NÃO aprova (nada muda no banco); outra pessoa aprova', async () => {
        const e = await registrar('9101');
        expect(e.estado).toBe('PENDENTE');
        await expect(svc.aprovar({ id: e.id, ator: ator('ana') })).rejects.toMatchObject({
            code: 'EXCECAO_APROVACAO_PROPRIO_CADASTRANTE',
        });
        expect((await repo.getById(e.id))?.estado).toBe('PENDENTE');
        const aprovada = await svc.aprovar({ id: e.id, ator: ator('bia') });
        expect(aprovada).toMatchObject({ estado: 'APROVADA', aprovadoPor: 'bia' });
        expect(await eventos(e.id)).toEqual(['CADASTRO', 'APROVACAO']);
    });

    it('revogar tira a exceção da resolução (o resolver só enxerga APROVADA)', async () => {
        const e = await registrar('9102');
        await svc.aprovar({ id: e.id, ator: ator('bia') });
        expect(await repo.findAprovada('9102', 'CONTA')).not.toBeNull();
        // Qualquer titular revoga, inclusive quem cadastrou (I12h).
        await svc.revogar({ id: e.id, ator: ator('ana'), motivo: 'fornecedor trocou' });
        expect(await repo.findAprovada('9102', 'CONTA')).toBeNull();
        expect((await repo.getById(e.id))?.motivoDecisao).toBe('fornecedor trocou');
    });

    it('aposentarSubstituidas: cadastro igual → SUBSTITUIDA sem divergência; idempotente', async () => {
        const e = await registrar('9103');
        await svc.aprovar({ id: e.id, ator: ator('bia') });
        contasDoCadastro.set('9103', [
            {
                pctCodSeq: 5,
                banco: 237,
                agencia: '1234',
                conta: '99887766',
                dvConta: '1',
                padrao: true,
            },
        ]);
        notificacao.emitir.mockClear();
        const r1 = await svc.aposentarSubstituidas();
        expect(r1.aposentadas).toBeGreaterThanOrEqual(1);
        expect((await repo.getById(e.id))?.estado).toBe('SUBSTITUIDA');
        expect(await eventos(e.id)).toEqual(['CADASTRO', 'APROVACAO', 'SUBSTITUICAO']);
        expect(notificacao.emitir).not.toHaveBeenCalled();
        // Segunda execução: já não há APROVADA deste favorecido; nada é regravado.
        const r2 = await svc.aposentarSubstituidas();
        expect(r2.aposentadas).toBe(0);
        expect(await eventos(e.id)).toEqual(['CADASTRO', 'APROVACAO', 'SUBSTITUICAO']);
    });

    it('cadastro com valor DIFERENTE: SUBSTITUIDA + DIVERGENCIA_CADASTRO na trilha (mascarada) + Alerta; a lista marca divergiu', async () => {
        const e = await registrar('9104');
        await svc.aprovar({ id: e.id, ator: ator('bia') });
        contasDoCadastro.set('9104', [
            {
                pctCodSeq: 6,
                banco: 341,
                agencia: '9999',
                conta: '55554444',
                dvConta: '0',
                padrao: true,
            },
        ]);
        notificacao.emitir.mockClear();
        await svc.aposentarSubstituidas();
        expect(await eventos(e.id)).toEqual([
            'CADASTRO',
            'APROVACAO',
            'SUBSTITUICAO',
            'DIVERGENCIA_CADASTRO',
        ]);
        expect(notificacao.emitir).toHaveBeenCalledTimes(1);
        const trilha = JSON.stringify(
            (
                await db.query(
                    `SELECT depois FROM excecao_destino_audit WHERE excecao_id = $1 AND evento = 'DIVERGENCIA_CADASTRO'`,
                    [e.id],
                )
            ).rows,
        );
        for (const v of ['99887766', '55554444']) expect(trilha).not.toContain(v);
        const [linha] = await svc.listar({ pesCod: '9104' });
        expect(linha).toMatchObject({ estado: 'SUBSTITUIDA', divergiu: true });
        expect(JSON.stringify(linha)).not.toContain('99887766');
    });

    it('cadastro sem destino: a exceção APROVADA segue valendo (resolve como EXCECAO)', async () => {
        const e = await registrar('9105');
        await svc.aprovar({ id: e.id, ator: ator('bia') });
        await svc.aposentarSubstituidas();
        expect((await repo.getById(e.id))?.estado).toBe('APROVADA');
    });
});
