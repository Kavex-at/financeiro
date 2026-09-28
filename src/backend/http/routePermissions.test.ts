import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { container } from 'tsyringe';
import {
    PERMISSION,
    PERMISSION_CATALOG,
    PERMISSION_IMPLIES,
    type Permission,
} from '../domain/interface/auth/Permission.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import type { ResolvedAccess } from '../domain/service/auth/AccessService.js';
import conexosRouter from '../routes/conexos.js';
import meRouter from '../routes/me.js';
import metricasRouter from '../routes/metricas.js';
import operacaoRouter from '../routes/operacao.js';
import permutasRouter from '../routes/permutas.js';
import recebimentosRouter from '../routes/recebimentos.js';
import sispagRouter from '../routes/sispag.js';
import usuariosRouter from '../routes/usuarios.js';
import { GUARD_AUTENTICADO, type GuardMark, guardDe, resolverAcesso } from './acesso.js';
import { recebimentosGate } from './recebimentosGate.js';
import { sispagGate } from './sispagGate.js';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

// Os limiters são estado compartilhado por IP: centenas de requisições do teste estourariam o 429
// antes de chegar ao guard. O guard é o alvo aqui; o rate-limit tem teste próprio.
jest.mock('./rateLimit.js', () => ({
    globalLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
    heavyRouteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const P = PERMISSION;
const AUT = GUARD_AUTENTICADO;

/**
 * A tabela da entrevista (`auth-permissoes-modulo-interview.md`, "Mapeamento por rota"), linha por
 * linha, já prefixada pelo mount. Rota nova sem linha aqui, ou linha sem rota, falha o teste.
 *
 * Duas linhas divergem da coluna "Proposta" da entrevista, que partiu de "hoje: aberta" quando o
 * código já as protegia com `requireRole('admin')` por LGPD: `GET /sispag/lotes/:id/linhas-digitaveis`
 * e `GET /sispag/boletos-dda` ficam em `sispag:executar` (equivalência com hoje, como a JC-3).
 * Registrado em `ontology/_inbox/auth-permissoes-modulo-gap.md`.
 */
const TABELA: ReadonlyArray<readonly [string, GuardMark]> = [
    // /permutas (27)
    ['POST /permutas/eleicao', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/ingestao', P.PERMUTAS_EXECUTAR],
    ['GET /permutas/runs', P.PERMUTAS_VER],
    ['GET /permutas/cliente-filtro', P.PERMUTAS_VER],
    ['POST /permutas/cliente-filtro', P.PERMUTAS_EXECUTAR],
    ['DELETE /permutas/cliente-filtro/:pesCod', P.PERMUTAS_EXECUTAR],
    ['GET /permutas/importadores', P.PERMUTAS_VER],
    ['GET /permutas/invoices/buscar', P.PERMUTAS_VER],
    ['POST /permutas/adiantamentos/:docCod/alocacoes', P.PERMUTAS_EXECUTAR],
    ['DELETE /permutas/adiantamentos/:docCod/alocacoes/:invoiceDocCod', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/adiantamentos/:docCod/excecao-manual', P.PERMUTAS_EXECUTAR],
    ['DELETE /permutas/adiantamentos/:docCod/excecao-manual', P.PERMUTAS_EXECUTAR],
    ['GET /permutas/gestao', P.PERMUTAS_VER],
    ['GET /permutas/relatorios/:tipo', P.PERMUTAS_VER],
    ['POST /permutas/adiantamentos/:docCod/processar', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/adiantamentos/:docCod/reconciliar', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/adiantamentos/:docCod/gerar-numerario', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/reconciliar-lote', P.PERMUTAS_EXECUTAR],
    ['GET /permutas/borderos', P.PERMUTAS_VER],
    ['GET /permutas/borderos/:borCod/baixas', P.PERMUTAS_VER],
    ['POST /permutas/borderos/:borCod/finalizar', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/borderos/:borCod/cancelar', P.PERMUTAS_EXECUTAR],
    ['POST /permutas/borderos/:borCod/estornar', P.PERMUTAS_EXECUTAR],
    ['DELETE /permutas/borderos/:borCod', P.PERMUTAS_EXECUTAR],
    ['DELETE /permutas/borderos/:borCod/baixas/:invoiceDocCod', P.PERMUTAS_EXECUTAR],
    ['GET /permutas/adiantamentos/:docCod/execucoes', P.PERMUTAS_VER],
    ['GET /permutas/status', P.PERMUTAS_VER],
    // /sispag (27; as quatro do laço contam separadas)
    ['GET /sispag/painel', P.SISPAG_VER],
    ['GET /sispag/retornos', P.SISPAG_VER],
    ['GET /sispag/lotes/:id/linhas-digitaveis', P.SISPAG_EXECUTAR],
    ['GET /sispag/lotes/:id/modalidades-disponiveis', P.SISPAG_VER],
    ['GET /sispag/lotes', P.SISPAG_VER],
    ['GET /sispag/lotes/:id', P.SISPAG_VER],
    ['POST /sispag/lotes', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/itens', P.SISPAG_EXECUTAR],
    ['DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod', P.SISPAG_EXECUTAR],
    ['POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/finalizar', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/reabrir', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/cancelar', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/retorno', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/:id/conta', P.SISPAG_EXECUTAR],
    ['POST /sispag/ingestao', P.SISPAG_EXECUTAR],
    ['POST /sispag/lotes/formar', P.SISPAG_EXECUTAR],
    ['GET /sispag/boletos-dda', P.SISPAG_EXECUTAR],
    ['POST /sispag/boletos-dda/sincronizar', P.SISPAG_EXECUTAR],
    ['GET /sispag/ingestao/runs', P.SISPAG_VER],
    ['GET /sispag/contas-pagadoras', P.SISPAG_EXECUTAR],
    ['GET /sispag/lotes/:id/remessa/janela', P.SISPAG_VER],
    ['POST /sispag/lotes/:id/remessa', P.SISPAG_EXECUTAR],
    ['GET /sispag/lotes/:id/remessa/arquivo', P.SISPAG_EXECUTAR],
    ['POST /sispag/retornos/conciliar', P.SISPAG_EXECUTAR],
    ['GET /sispag/execucoes', P.SISPAG_EXECUTAR],
    // /recebimentos (15)
    ['GET /recebimentos/painel', P.RECEBIMENTOS_VER],
    ['GET /recebimentos/painel/enriquecimento', P.RECEBIMENTOS_VER],
    ['POST /recebimentos/pipeline/run', P.RECEBIMENTOS_EXECUTAR],
    ['GET /recebimentos/clientes', P.RECEBIMENTOS_VER],
    ['GET /recebimentos/transacoes/:txnId/processos', P.RECEBIMENTOS_VER],
    ['GET /recebimentos/processos/:priCod/sns', P.RECEBIMENTOS_VER],
    ['POST /recebimentos/transacoes/:txnId/solicitacao-numerario', P.RECEBIMENTOS_EXECUTAR],
    ['GET /recebimentos/execucoes', P.RECEBIMENTOS_EXECUTAR],
    ['POST /recebimentos/ingestao', P.RECEBIMENTOS_EXECUTAR],
    ['GET /recebimentos/ingestao/runs', P.RECEBIMENTOS_VER],
    ['GET /recebimentos/contas', P.RECEBIMENTOS_VER],
    ['POST /recebimentos/ingestao/upload/preview', P.RECEBIMENTOS_EXECUTAR],
    ['POST /recebimentos/ingestao/upload', P.RECEBIMENTOS_EXECUTAR],
    ['POST /recebimentos/transacoes/:txnId/arquivar', P.RECEBIMENTOS_EXECUTAR],
    ['POST /recebimentos/transacoes/:txnId/desarquivar', P.RECEBIMENTOS_EXECUTAR],
    // /usuarios (7 + 3 novas)
    ['GET /usuarios/meta', P.USUARIOS_GERENCIAR],
    ['GET /usuarios/papeis', P.USUARIOS_GERENCIAR],
    ['GET /usuarios', P.USUARIOS_GERENCIAR],
    ['POST /usuarios', P.USUARIOS_GERENCIAR],
    ['PATCH /usuarios/:id/email', P.USUARIOS_GERENCIAR],
    ['PATCH /usuarios/:id/papel', P.USUARIOS_GERENCIAR],
    ['PUT /usuarios/:id/permissoes', P.USUARIOS_GERENCIAR],
    ['PATCH /usuarios/:id/ativo', P.USUARIOS_GERENCIAR],
    ['POST /usuarios/:id/reset-senha', P.USUARIOS_GERENCIAR],
    ['PATCH /usuarios/:id/vinculo', P.USUARIOS_GERENCIAR],
    // /operacao (2)
    ['GET /operacao', P.OPERACAO_VER],
    ['POST /operacao/alertas/:id/reconhecer', P.OPERACAO_VER],
    // /metricas, /me, /conexos
    ['GET /metricas/ciclo', P.METRICAS_VER],
    ['GET /me/conexos-status', AUT],
    ['GET /me/permissoes', AUT],
    ['GET /conexos/filiais', AUT],
];

/** Rotas montadas ANTES do auth, fora da cadeia de acesso (sem guard, de propósito). */
const PUBLICAS = ['/health', '/auth'];

const ROUTERS: ReadonlyArray<readonly [string, Router]> = [
    ['/permutas', permutasRouter],
    ['/sispag', sispagRouter],
    ['/recebimentos', recebimentosRouter],
    ['/usuarios', usuariosRouter],
    ['/operacao', operacaoRouter],
    ['/metricas', metricasRouter],
    ['/me', meRouter],
    ['/conexos', conexosRouter],
];

interface RouteLayer {
    handle: unknown;
}
interface Layer {
    handle: unknown;
    route?: { path: string; methods: Record<string, boolean>; stack: RouteLayer[] };
}

const juntar = (mount: string, rota: string): string => (rota === '/' ? mount : `${mount}${rota}`);

/** Toda rota do router, com os guards marcados que a cobrem (do router e da própria rota). */
const introspectar = (mount: string, router: Router): Map<string, GuardMark[]> => {
    const out = new Map<string, GuardMark[]>();
    const doRouter: GuardMark[] = [];
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
        if (!layer.route) {
            const g = guardDe(layer.handle);
            if (g) doRouter.push(g);
            continue;
        }
        const daRota = layer.route.stack
            .map((l) => guardDe(l.handle))
            .filter((g): g is GuardMark => g !== undefined);
        for (const metodo of Object.keys(layer.route.methods)) {
            out.set(`${metodo.toUpperCase()} ${juntar(mount, layer.route.path)}`, [
                ...doRouter,
                ...daRota,
            ]);
        }
    }
    return out;
};

const encontradas = new Map<string, GuardMark[]>();
for (const [mount, router] of ROUTERS) {
    for (const [chave, guards] of introspectar(mount, router)) encontradas.set(chave, guards);
}

describe('cobertura de guard por rota (introspecção)', () => {
    it('a tabela tem as contagens da entrevista: 27/27/15/10/2/1/2/1', () => {
        const porMount = (m: string) =>
            TABELA.filter(([r]) => r.split(' ')[1].split('/')[1] === m).length;
        expect(porMount('permutas')).toBe(27);
        expect(porMount('sispag')).toBe(27);
        expect(porMount('recebimentos')).toBe(15);
        expect(porMount('usuarios')).toBe(10);
        expect(porMount('operacao')).toBe(2);
        expect(porMount('metricas')).toBe(1);
        expect(porMount('me')).toBe(2);
        expect(porMount('conexos')).toBe(1);
    });

    it('o conjunto de rotas montadas é EXATAMENTE o da tabela (nenhuma sobra, nenhuma falta)', () => {
        const tabela = new Set(TABELA.map(([r]) => r));
        const semLinha = [...encontradas.keys()].filter((r) => !tabela.has(r));
        const semRota = [...tabela].filter((r) => !encontradas.has(r));
        expect({ semLinha, semRota }).toEqual({ semLinha: [], semRota: [] });
    });

    it.each(TABELA)('%s tem exatamente UM guard, e é %s', (rota, esperado) => {
        expect(encontradas.get(rota)).toEqual([esperado]);
    });

    it('buildApp monta exatamente os routers conhecidos (um router novo sem tabela falha)', () => {
        const fonte = readFileSync(path.join(__dirname, 'buildApp.ts'), 'utf8');
        const montados = new Set(
            [...fonte.matchAll(/app\.use\(\s*'(\/[^']*)'/g)].map((m) => m[1] as string),
        );
        expect([...montados].sort()).toEqual([...PUBLICAS, ...ROUTERS.map(([m]) => m)].sort());
    });

    it('filialAuthz da solicitação de numerário continua DEPOIS do guard e sem mudança (Q12)', () => {
        const fonte = readFileSync(path.join(__dirname, '..', 'routes', 'recebimentos.ts'), 'utf8');
        const rota = fonte.indexOf("'/transacoes/:txnId/solicitacao-numerario'");
        const guard = fonte.indexOf('exigirPermissao(PERMISSION.RECEBIMENTOS_EXECUTAR)', rota);
        const filial = fonte.indexOf('assertUserCanActOnFilial', rota);
        expect(rota).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(rota);
        expect(filial).toBeGreaterThan(guard);
    });
});

// ─────────────────────────────────────────────── comportamento, linha por linha

/** O handler nunca roda: tudo depois do guard vira este sentinela. */
const SENTINELA = 418;
const sentinela = (_req: Request, res: Response): void => {
    res.status(SENTINELA).json({ sentinela: true });
};

/** Troca, em cada rota, tudo o que vem depois do guard pelo sentinela (o guard do router fica). */
const neutralizarHandlers = (router: Router): void => {
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
        if (!layer.route) continue;
        const pilha = layer.route.stack;
        const iGuard = pilha.findIndex((l) => guardDe(l.handle) !== undefined);
        for (let i = iGuard + 1; i < pilha.length; i++) pilha[i].handle = sentinela;
    }
};

let acessoAtual: ResolvedAccess;
const flags = { sispagEnabled: true, recebimentosEnabled: true };
let srv: { server: Server; url: string };

const acessoCom = (permissoes: Iterable<Permission>): ResolvedAccess => ({
    userId: 1,
    username: 'u',
    ativo: true,
    papel: { id: 1, nome: 'Teste' },
    permissoes: new Set(permissoes),
});

/** O que a permissão arrasta (executar → ver). */
const comFecho = (p: Permission): Permission[] => {
    const implicada = PERMISSION_IMPLIES[p];
    return implicada ? [p, implicada] : [p];
};

/** Tudo MENOS a exigida; para `X:ver`, também menos `X:executar` (o fecho a traria de volta). */
const semAExigida = (p: Permission): Permission[] => {
    const maiores = Object.entries(PERMISSION_IMPLIES)
        .filter(([, ver]) => ver === p)
        .map(([exec]) => exec);
    return PERMISSION_CATALOG.filter((x) => x !== p && !maiores.includes(x));
};

beforeAll(async () => {
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) =>
        token === EnvironmentProvider
            ? { getEnvironmentVars: async () => ({ ...flags }) }
            : real(token as never)) as never);

    for (const [, router] of ROUTERS) neutralizarHandlers(router);

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
        req.user = { sub: 'u' };
        next();
    });
    app.use(
        resolverAcesso({
            devBypass: false,
            obterServico: async () => ({ resolver: async () => acessoAtual }),
            obterLog: () => ({ error: async () => undefined }),
        }),
    );
    for (const [mount, router] of ROUTERS) {
        if (mount === '/sispag') app.use(mount, sispagGate, router);
        else if (mount === '/recebimentos') app.use(mount, recebimentosGate, router);
        else app.use(mount, router);
    }
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ erro: err instanceof Error ? err.message : String(err) });
    });
    srv = await new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

beforeEach(() => {
    flags.sispagEnabled = true;
    flags.recebimentosEnabled = true;
});

/** Dispara a rota da tabela com `:param` trocado por `1`. */
const chamar = async (rota: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    const [metodo, caminho] = rota.split(' ');
    const url = `${srv.url}${caminho.replace(/:[A-Za-z]+/g, '1')}`;
    const res = await fetch(url, {
        method: metodo,
        headers: { 'content-type': 'application/json' },
        ...(metodo === 'GET' ? {} : { body: '{}' }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const LINHAS_COM_PERMISSAO = TABELA.filter(
    (linha): linha is readonly [string, Permission] => linha[1] !== AUT,
);

describe('comportamento por linha: sem a permissão → recusa; só com ela → passa do guard', () => {
    it.each(LINHAS_COM_PERMISSAO)('%s sem %s: recusado pelo guard', async (rota, exigida) => {
        acessoAtual = acessoCom(semAExigida(exigida));
        const out = await chamar(rota);
        if (exigida === P.OPERACAO_VER) {
            expect(out).toEqual({ status: 404, body: { error: 'Not found' } });
        } else {
            expect(out).toEqual({
                status: 403,
                body: { error: 'Você não tem permissão para esta ação.', permissao: exigida },
            });
        }
    });

    it.each(LINHAS_COM_PERMISSAO)('%s só com %s: passa do guard', async (rota, exigida) => {
        acessoAtual = acessoCom(comFecho(exigida));
        expect((await chamar(rota)).status).toBe(SENTINELA);
    });

    it.each(
        TABELA.filter(([, g]) => g === AUT),
    )('%s: basta estar ativo, sem permissão nenhuma', async (rota) => {
        acessoAtual = acessoCom([]);
        expect((await chamar(rota)).status).toBe(SENTINELA);
    });

    it.each(TABELA)('I6 — o Administrador (as nove) passa de %s', async (rota) => {
        acessoAtual = acessoCom(PERMISSION_CATALOG);
        expect((await chamar(rota)).status).toBe(SENTINELA);
    });
});

describe('chamadas de julgamento (JC) conferidas explicitamente', () => {
    it('JC-2: só permutas:ver passa de /status, /borderos?live=true e /borderos/:borCod/baixas', async () => {
        acessoAtual = acessoCom([P.PERMUTAS_VER]);
        for (const rota of [
            'GET /permutas/status',
            'GET /permutas/borderos?live=true',
            'GET /permutas/borderos/:borCod/baixas',
        ]) {
            expect((await chamar(rota)).status).toBe(SENTINELA);
        }
    });

    it('JC-3/JC-4: só sispag:ver leva 403 nas leituras sensíveis e na triagem', async () => {
        acessoAtual = acessoCom([P.SISPAG_VER]);
        for (const rota of [
            'GET /sispag/contas-pagadoras',
            'GET /sispag/lotes/:id/remessa/arquivo',
            'GET /sispag/execucoes',
        ]) {
            const out = await chamar(rota);
            expect(out.status).toBe(403);
            expect(out.body.permissao).toBe('sispag:executar');
        }
    });

    it('JC-3/JC-4: só recebimentos:ver passa de /contas e leva 403 em /execucoes', async () => {
        acessoAtual = acessoCom([P.RECEBIMENTOS_VER]);
        expect((await chamar('GET /recebimentos/contas')).status).toBe(SENTINELA);
        const out = await chamar('GET /recebimentos/execucoes');
        expect(out.status).toBe(403);
        expect(out.body.permissao).toBe('recebimentos:executar');
    });
});

describe('I8 — flags de frente vêm antes da permissão', () => {
    it('SISPAG desligado: quem não tem sispag:ver recebe o 403 do gate, não o do guard', async () => {
        flags.sispagEnabled = false;
        acessoAtual = acessoCom([]);
        expect(await chamar('GET /sispag/painel')).toEqual({
            status: 403,
            body: { error: 'SISPAG indisponível.' },
        });
    });

    it('Recebimentos desligado: idem, com o 403 do recebimentosGate', async () => {
        flags.recebimentosEnabled = false;
        acessoAtual = acessoCom([]);
        expect(await chamar('GET /recebimentos/painel')).toEqual({
            status: 403,
            body: { error: 'Recebimentos indisponível.' },
        });
    });
});
