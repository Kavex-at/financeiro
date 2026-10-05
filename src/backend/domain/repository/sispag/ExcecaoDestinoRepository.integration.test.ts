import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import type { DestinoManual } from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ExcecaoDestinoRepository from './ExcecaoDestinoRepository.js';

/**
 * `ExcecaoDestinoRepository` contra um Postgres DE VERDADE (ADR-0060): aprovar substitui a
 * anterior na mesma transação, a trilha é atômica com a transição e o banco recusa dois
 * `APROVADA` e a autoaprovação.
 *
 * Não roda no `npm test`; roda no `npm run test:sql` (ver `0075_sispag_excecao_destino.integration.test.ts`).
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `excecao_repo_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'excecao_repo_it';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const CONTA = (conta = '99887766'): DestinoManual => ({
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta,
    contaDv: '1',
    titularDocumento: '11144477735',
});
const CHAVE: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'CPF_CNPJ',
    chavePix: '11144477735',
    titularDocumento: '11144477735',
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('ExcecaoDestinoRepository (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: ExcecaoDestinoRepository;

    const nova = (pesCod: string, destino: DestinoManual = CONTA(), por = 'ana') =>
        repo.insert({
            pesCod,
            filCod: 1,
            destino,
            origem: 'MANUAL',
            justificativa: 'cadastro errado',
            cadastradoPor: por,
        });

    const eventos = async (id: string): Promise<string[]> =>
        (
            await db.query(
                'SELECT evento FROM excecao_destino_audit WHERE excecao_id = $1 ORDER BY ocorrido_em, id',
                [id],
            )
        ).rows.map((r) => r.evento);

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
        for (const arquivo of readdirSync(path.join(__dirname, '../../../migrations'))
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()) {
            await db.query(
                readFileSync(path.join(__dirname, '../../../migrations', arquivo), 'utf8'),
            );
        }
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        repo = new ExcecaoDestinoRepository(pool);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('insert grava PENDENTE com a trilha CADASTRO e devolve o destino completo', async () => {
        const e = await nova('8001');
        expect(e.estado).toBe('PENDENTE');
        expect(e.destino).toEqual(CONTA());
        expect(await eventos(e.id)).toEqual(['CADASTRO']);
    });

    it('aprovar: vira APROVADA e findAprovada a acha; o aprovador é gravado', async () => {
        const e = await nova('8002');
        const a = await repo.aprovar({ id: e.id, ator: 'bia' });
        expect(a).toMatchObject({ estado: 'APROVADA', aprovadoPor: 'bia' });
        expect((await repo.findAprovada('8002', 'CONTA'))?.id).toBe(e.id);
        expect(await repo.findAprovada('8002', 'CHAVE_PIX')).toBeNull();
        expect(await eventos(e.id)).toEqual(['CADASTRO', 'APROVACAO']);
    });

    it('nova aprovada move a anterior (mesmo favorecido e tipo) a SUBSTITUIDA, com a trilha dos dois', async () => {
        const velha = await nova('8003');
        await repo.aprovar({ id: velha.id, ator: 'bia' });
        const nov = await nova('8003', CONTA('11112222'));
        await repo.aprovar({ id: nov.id, ator: 'bia' });
        expect((await repo.getById(velha.id))?.estado).toBe('SUBSTITUIDA');
        expect((await repo.getById(velha.id))?.substituidaEm).toBeDefined();
        expect((await repo.findAprovada('8003', 'CONTA'))?.id).toBe(nov.id);
        expect(await eventos(velha.id)).toEqual(['CADASTRO', 'APROVACAO', 'SUBSTITUICAO']);
        expect(await eventos(nov.id)).toEqual(['CADASTRO', 'APROVACAO']);
    });

    it('tipos diferentes do mesmo favorecido convivem aprovados', async () => {
        const conta = await nova('8004');
        const chave = await nova('8004', CHAVE);
        await repo.aprovar({ id: conta.id, ator: 'bia' });
        await repo.aprovar({ id: chave.id, ator: 'bia' });
        expect((await repo.getById(conta.id))?.estado).toBe('APROVADA');
        expect((await repo.getById(chave.id))?.estado).toBe('APROVADA');
    });

    it('rejeitar exige a PENDENTE (WHERE estado = $de): a segunda tentativa é ExcecaoEstadoInvalidoError', async () => {
        const e = await nova('8005');
        const r = await repo.transition({
            id: e.id,
            de: 'PENDENTE',
            para: 'REJEITADA',
            evento: 'REJEICAO',
            ator: 'bia',
            motivo: 'conta de terceiro',
        });
        expect(r).toMatchObject({
            estado: 'REJEITADA',
            decididoPor: 'bia',
            motivoDecisao: 'conta de terceiro',
        });
        await expect(
            repo.transition({
                id: e.id,
                de: 'PENDENTE',
                para: 'REJEITADA',
                evento: 'REJEICAO',
                ator: 'bia',
                motivo: 'x',
            }),
        ).rejects.toBeInstanceOf(ExcecaoEstadoInvalidoError);
        expect(await eventos(e.id)).toEqual(['CADASTRO', 'REJEICAO']);
    });

    it('atomicidade: falha forçada na trilha desfaz a transição (o estado não muda)', async () => {
        const e = await nova('8006');
        await expect(
            repo.transition({
                id: e.id,
                de: 'PENDENTE',
                para: 'REJEITADA',
                evento: 'EVENTO_INEXISTENTE' as never,
                ator: 'bia',
                motivo: 'x',
            }),
        ).rejects.toThrow(/check/i);
        expect((await repo.getById(e.id))?.estado).toBe('PENDENTE');
        expect(await eventos(e.id)).toEqual(['CADASTRO']);
    });

    it('atomicidade na aprovação: falha após a substituição desfaz a substituição também', async () => {
        const velha = await nova('8007');
        await repo.aprovar({ id: velha.id, ator: 'bia' });
        const nov = await nova('8007', CONTA('55556666'));
        // O aprovador igual ao cadastrante estoura o CHECK do banco DEPOIS de a anterior ser
        // movida a SUBSTITUIDA na mesma transação.
        await expect(repo.aprovar({ id: nov.id, ator: 'ana' })).rejects.toThrow(
            /excecao_destino_aprovador_check/,
        );
        expect((await repo.getById(velha.id))?.estado).toBe('APROVADA');
        expect((await repo.getById(nov.id))?.estado).toBe('PENDENTE');
        expect(await eventos(velha.id)).toEqual(['CADASTRO', 'APROVACAO']);
    });

    it('list filtra por estado e favorecido; contarPorEstado soma por estado', async () => {
        const pendentes = await repo.list({ estado: 'PENDENTE', pesCod: '8001' });
        expect(pendentes.map((p) => p.pesCod)).toEqual(['8001']);
        const contagem = await repo.contarPorEstado();
        expect(contagem.APROVADA).toBeGreaterThan(0);
        expect(contagem.REJEITADA).toBeGreaterThan(0);
    });

    it('listEventos não devolve o destino (I10h)', async () => {
        const e = await nova('8008');
        const trilha = await repo.listEventos(e.id);
        expect(trilha).toHaveLength(1);
        expect(JSON.stringify(trilha)).not.toContain('99887766');
    });

    it('marcarUso grava USO e a trilha continua só-inclusão', async () => {
        const e = await nova('8009');
        await repo.marcarUso({ excecaoId: e.id, ator: 'sistema', loteId: 'L1' });
        expect(await eventos(e.id)).toEqual(['CADASTRO', 'USO']);
        await expect(db.query(`UPDATE excecao_destino_audit SET ator = 'x'`)).rejects.toThrow(
            /so de inclusao/,
        );
    });

    it('contarPendentesAntigas conta só as PENDENTE mais velhas que N dias', async () => {
        const e = await nova('8010');
        await db.query(
            `UPDATE excecao_destino SET cadastrado_em = now() - interval '10 days' WHERE id = $1`,
            [e.id],
        );
        expect(await repo.contarPendentesAntigas(7)).toBeGreaterThanOrEqual(1);
        expect(await repo.contarPendentesAntigas(30)).toBe(0);
    });
});
