import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { container } from 'tsyringe';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import CentsAdjustmentNotEligibleError from '../domain/errors/CentsAdjustmentNotEligibleError.js';
import { PERMISSION, type Permission } from '../domain/interface/auth/Permission.js';
import AjusteCentavosTituloService from '../domain/service/sispag/AjusteCentavosTituloService.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

/** Rotas do ajuste de centavos (ADR-0074, I18g). */

const buildApp = (permissoes: Permission[]): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, _res, next) => {
        req.user = { sub: 'bia', email: 'bia@x.com', role: 'admin' };
        req.acesso = AcessoFixture.com(permissoes);
        next();
    });
    app.use('/sispag', sispagRouter);
    app.use(errorMiddleware);
    return app;
};

const comApp = async (
    permissoes: Permission[],
    fn: (url: string) => Promise<void>,
): Promise<void> => {
    const server: Server = await new Promise((resolve) => {
        const s = buildApp(permissoes).listen(0, () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise<void>((r) => server.close(() => r()));
    }
};

const post = (url: string, body: unknown) =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

const servico = (over: Record<string, jest.Mock> = {}) => {
    const s = {
        tentarDeNovo: jest
            .fn()
            .mockResolvedValue({ resultado: 'executado', modo: 'on', etapa: 'concluido' }),
        agendarVarredura: jest.fn(),
        listarCandidatos: jest.fn().mockResolvedValue({ modo: 'off', avisos: [], ajustes: [] }),
        ...over,
    };
    container.registerInstance(AjusteCentavosTituloService, s as never);
    return s;
};

afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
});

const VER = [PERMISSION.SISPAG_VER];
const EXECUTAR = [PERMISSION.SISPAG_VER, PERMISSION.SISPAG_EXECUTAR];
const TITULO = { filCod: 2, docCod: '536', titCod: '1' };

describe('POST /sispag/ajustes-centavos/tentar-novamente', () => {
    it('sispag:executar com corpo válido ⇒ 200 com o resultado', async () => {
        const s = servico();
        await comApp(EXECUTAR, async (url) => {
            const r = await post(`${url}/sispag/ajustes-centavos/tentar-novamente`, TITULO);
            expect(r.status).toBe(200);
            expect(await r.json()).toMatchObject({ etapa: 'concluido' });
        });
        expect(s.tentarDeNovo).toHaveBeenCalledWith(TITULO);
    });

    it('inelegível ⇒ 409 com o motivo e a mensagem pt-BR', async () => {
        servico({
            tentarDeNovo: jest.fn().mockRejectedValue(
                new CentsAdjustmentNotEligibleError({
                    ...TITULO,
                    motivo: 'DELTA_ACIMA_LIMITE',
                }),
            ),
        });
        await comApp(EXECUTAR, async (url) => {
            const r = await post(`${url}/sispag/ajustes-centavos/tentar-novamente`, TITULO);
            expect(r.status).toBe(409);
            const body = (await r.json()) as Record<string, unknown>;
            expect(body).toMatchObject({
                code: 'AJUSTE_CENTAVOS_INELEGIVEL',
                details: { motivo: 'DELTA_ACIMA_LIMITE' },
            });
            expect(String(body.error)).toMatch(/R\$ 0,05/);
        });
    });

    it('corpo inválido ⇒ 400 (Zod); só sispag:ver ⇒ 403', async () => {
        const s = servico();
        await comApp(EXECUTAR, async (url) => {
            const r = await post(`${url}/sispag/ajustes-centavos/tentar-novamente`, { filCod: 0 });
            expect(r.status).toBe(400);
        });
        await comApp(VER, async (url) => {
            const r = await post(`${url}/sispag/ajustes-centavos/tentar-novamente`, TITULO);
            expect(r.status).toBe(403);
        });
        expect(s.tentarDeNovo).not.toHaveBeenCalled();
    });
});

describe('POST /sispag/ajustes-centavos/retomar', () => {
    it('sispag:executar ⇒ 202 e a varredura é agendada (não espera o ERP)', async () => {
        const s = servico();
        await comApp(EXECUTAR, async (url) => {
            const r = await post(`${url}/sispag/ajustes-centavos/retomar`, { filCod: 2 });
            expect(r.status).toBe(202);
        });
        expect(s.agendarVarredura).toHaveBeenCalledWith({ filCod: 2 });
    });

    it('só sispag:ver ⇒ 403 e nenhuma varredura', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            const r = await post(`${url}/sispag/ajustes-centavos/retomar`, {});
            expect(r.status).toBe(403);
        });
        expect(s.agendarVarredura).not.toHaveBeenCalled();
    });
});

describe('GET /sispag/ajustes-centavos', () => {
    it('sispag:ver lê o modo e o estado por título', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            const r = await fetch(`${url}/sispag/ajustes-centavos?filCod=2`);
            expect(r.status).toBe(200);
            expect(await r.json()).toEqual({ modo: 'off', avisos: [], ajustes: [] });
        });
        expect(s.listarCandidatos).toHaveBeenCalledWith({ filCod: 2 });
    });

    it('sem filCod ⇒ 400', async () => {
        servico();
        await comApp(VER, async (url) => {
            const r = await fetch(`${url}/sispag/ajustes-centavos`);
            expect(r.status).toBe(400);
        });
    });
});

describe('gatilhos só no processo do servidor (I18g)', () => {
    const raiz = path.join(__dirname, '..');
    const arquivos = (dir: string): string[] =>
        readdirSync(dir).flatMap((nome) => {
            if (['node_modules', 'dist', 'coverage'].includes(nome)) return [];
            const p = path.join(dir, nome);
            return statSync(p).isDirectory() ? arquivos(p) : [p];
        });

    it('nenhum job, cron ou bootstrapAppContainer referencia AjusteCentavosTituloService', () => {
        const fora = arquivos(raiz)
            .filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f))
            .filter((f) => readFileSync(f, 'utf8').includes('AjusteCentavosTituloService'))
            .map((f) => path.relative(raiz, f))
            .filter((f) => !f.startsWith('routes/') && !f.startsWith('domain/service/'))
            // Exceção única: a prova HML da Task 15 (G2/G3) roda o serviço de produção à mão,
            // recusa base que não seja `-hml` e não é job agendado nem cron.
            .filter((f) => f !== 'jobs/probe-hml-ajuste-centavos-g2-g3.ts');
        expect(fora).toEqual([]);
    });
});
