import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ConexosBaseClient, { type LegacyConexosShape } from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import RemessaCnabValidator from '../domain/libs/cnab/RemessaCnabValidator.js';
import LogService from '../domain/service/LogService.js';
import type { ConexosService } from '../services/conexos.js';
import {
    AnaliseReguaLiquida,
    GuardaSomenteLeituraConexos,
    ReadOnlyViolationError,
    SessaoUnicaConexos,
    type TituloCarteira,
    ValidacaoAjusteCentavosV1,
} from './validate-sispag-ajuste-centavos-v1.js';

/**
 * Prova de SOMENTE LEITURA do job de ground truth do ajuste de centavos (ADR-0073, Tasks 13/14):
 * roda o job INTEIRO contra um Conexos falso e falha se qualquer método de escrita for chamado —
 * no adapter legado, no `ConexosBaseClient` ou no `ConexosSispagWriteClient` — ou se algum `POST`
 * sair para caminho que não seja `list`.
 */
type Linha = Record<string, unknown>;

const AGORA = Date.parse('2026-10-19T15:00:00Z');
const DIA = 24 * 60 * 60 * 1000;
const validador = new RemessaCnabValidator();

/** Barra de 44 dígitos com DV válido e o valor em centavos nas posições 10–19. */
const barraCom = (valorCentavos: number, livre = '1234567890123456789012345'): string => {
    const semDv = `3419X1000${String(valorCentavos).padStart(10, '0')}${livre}`;
    for (let d = 0; d <= 9; d += 1) {
        const b = semDv.replace('X', String(d));
        if (validador.dvBarrasValido(b)) return b;
    }
    throw new Error('sem DV');
};
const z15 = (n: number): string => String(n).padStart(15, '0');
const linhaJ = (barras: string, pagamento: number, titulo: number, desconto = 0, mora = 0) =>
    `34100013${'00001'}J000${barras}${'FAVORECIDO'.padEnd(30)}20261020${z15(titulo)}${z15(desconto)}${z15(mora)}20261020${z15(pagamento)}`.padEnd(
        240,
        ' ',
    );
const linhaJ52 = (): string => `3410001300002J0005200000000000000000000`.padEnd(240, ' ');

const BARRA_OK = barraCom(46250, '1111111111111111111111111');
const BARRA_DIVERGE = barraCom(46250, '2222222222222222222222222');
const BARRA_ZERO = barraCom(0, '3333333333333333333333333');
const REM_1 = [
    linhaJ(BARRA_OK, 46250, 46250),
    linhaJ52(),
    linhaJ(BARRA_DIVERGE, 46249, 46249),
].join('\r\n');
const REM_2 = [linhaJ(BARRA_ZERO, 1000, 1000)].join('\r\n');

const FIN064: Linha[] = [
    {
        docCod: 'D1',
        titCod: 1,
        totalLiquido: 100,
        totalPago: 0,
        totalAberto: 100,
        titMnyJuros: null,
        titMnyDesconto: null,
    },
    {
        docCod: 'D2',
        titCod: 1,
        totalLiquido: 53.54,
        totalPago: 0,
        totalAberto: 53.53,
        titMnyJuros: 0.01,
        titMnyDesconto: 0,
    },
    {
        docCod: 'D3',
        titCod: 1,
        totalLiquido: 200,
        totalPago: 50,
        totalAberto: 150,
        titMnyJuros: 0,
        titMnyDesconto: 0,
    },
    {
        docCod: 'D4',
        titCod: 1,
        totalLiquido: 300,
        totalPago: 0,
        totalAberto: 299.99,
        titMnyJuros: 0,
        titMnyDesconto: 0,
    },
    { docCod: 'D5', titCod: 1, totalPago: 0, totalAberto: 10, titMnyJuros: 0, titMnyDesconto: 0 },
];
const CARTEIRA: TituloCarteira[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D9'].map((docCod) => ({
    filCod: 1,
    docCod,
    titCod: '1',
    venc: '2026-10-20',
    boleto: docCod === 'D2' || docCod === 'D4',
}));

const pagina = (rows: Linha[]) => ({ count: rows.length, rows });

/** Conexos falso: responde por caminho; todo método é um espião. */
const fakeLegacy = () => {
    const listar = (p: string): Linha[] => {
        const tabela: Record<string, Linha[]> = {
            'fin064/list': FIN064,
            'fin015/list': [
                { flpCod: 10, bncCod: 4, filCod: 1, flpTimFinaliza: AGORA - DIA, flpVldStatus: 1 },
                { flpCod: 3, bncCod: 4, filCod: 1, flpTimFinaliza: AGORA - 60 * DIA },
            ],
            'fin015/gerArquivosBancos/list/1': [
                { gabCod: 7, gabEspNomeArquivo: 'PG191001.REM', gabLngDados: REM_1 },
                { gabCod: 8, gabEspNomeArquivo: 'PG191002.REM' },
            ],
            'fin015/finItemSispag/titulosPendentes/list/1/4/10': [
                {
                    filCod: 1,
                    docCod: 'P1',
                    titCod: 1,
                    titMnyValor: 462.49,
                    titMnyLiquido: 462.5,
                    titMnyJuros: 0.01,
                    titMnyDesconto: 0,
                },
                { filCod: 1, docCod: 'P2', titCod: 1, titMnyValor: 10, titMnyJuros: 0.5 },
                { filCod: 1, docCod: 'P3', titCod: 1, titMnyValor: 5 },
            ],
            'ger004/grupos/list/97': [{ grpCod: 4, grpDesNome: 'ADMINISTRADOR' }],
            'ger016/list': [
                { cpoCod: 900, cpoDesArquivo: 'FIN_070', cpoDesNome: 'RENEGOCIACAO' },
                { cpoCod: 901, cpoDesArquivo: 'FIN_103', cpoDesNome: 'LIBERACAO' },
                { cpoCod: 84, cpoDesArquivo: 'FIN_010', cpoDesNome: 'BAIXA' },
            ],
            'ger014/compAcao/list/900/4': [
                { acoCod: 1, acoDesNome: 'FINALIZAR' },
                { acoCod: 2, acoDesNome: 'CANCELAR' },
            ],
        };
        return tabela[p] ?? [];
    };
    const legacy = {
        ensureSid: jest.fn(async () => undefined),
        getFiliais: jest.fn(async () => [{ filCod: 1 }]),
        getFilCodDefault: jest.fn(async () => 1),
        listGeneric: jest.fn(async () => []),
        listGenericPaginated: jest.fn(async (p: string) => pagina(listar(p))),
        getGeneric: jest.fn(async (p: string) => {
            if (p === 'fin015/gerArquivosBancos/download/8') return REM_2;
            if (p === 'ger014/componentes/900/4') {
                return { xselect: 'S', xinsert: 'S', xupdate: 'S', xdelete: 'N', cpoCod: 900 };
            }
            throw Object.assign(new Error('500'), {
                response: { status: 500, data: { type: 'RECORDNOTFOUND' } },
            });
        }),
        postGeneric: jest.fn(),
        postGenericOnce: jest.fn(),
        putGenericOnce: jest.fn(),
        postMultipartOnce: jest.fn(),
        deleteGeneric: jest.fn(),
    };
    return legacy;
};

const ESCRITAS_LEGACY = [
    'postGeneric',
    'postGenericOnce',
    'putGenericOnce',
    'postMultipartOnce',
    'deleteGeneric',
] as const;
const ESCRITAS_WRITE_CLIENT = [
    'criarLote',
    'importarTitulos',
    'finalizarLote',
    'gerarRemessa',
    'sugerirRemessa',
    'editarItemDoRascunho',
    'removerItemDoRascunho',
    'validarCodigoBarras',
    'confirmarCodigoBarras',
] as const;

const montar = () => {
    const inner = fakeLegacy();
    const registro: Array<{ metodo: string; path: string }> = [];
    const guardado = GuardaSomenteLeituraConexos.envolver(
        inner as unknown as LegacyConexosShape,
        registro,
    );
    const base = new ConexosBaseClient(guardado);
    const write = new ConexosSispagWriteClient(base, new LogService());
    const espioesBase = ESCRITAS_LEGACY.map((m) => jest.spyOn(base, m));
    const espioesWrite = ESCRITAS_WRITE_CLIENT.map((m) => jest.spyOn(write, m));
    const job = new ValidacaoAjusteCentavosV1({
        base,
        write,
        carteira: CARTEIRA,
        identidade: async () => ({ login: 'MPS_TESTE', usnCod: '97' }),
        agoraMs: AGORA,
    });
    return { inner, registro, job, espioesBase, espioesWrite };
};

describe('validate-sispag-ajuste-centavos-v1 — zero escrita', () => {
    it('roda o job inteiro sem nenhuma chamada de escrita em nenhuma camada', async () => {
        const { inner, registro, job, espioesBase, espioesWrite } = montar();
        const r = await job.executar();

        for (const m of ESCRITAS_LEGACY) expect(inner[m]).not.toHaveBeenCalled();
        for (const s of [...espioesBase, ...espioesWrite]) expect(s).not.toHaveBeenCalled();
        expect(registro.filter((c) => c.metodo.startsWith('RECUSADO:'))).toEqual([]);

        const posts = inner.listGenericPaginated.mock.calls.map((c) => String(c[0]));
        expect(posts.length).toBeGreaterThan(0);
        for (const p of posts) expect(p).toMatch(GuardaSomenteLeituraConexos.POST_LEITURA);
        const gets = inner.getGeneric.mock.calls.map((c) => String(c[0]));
        for (const p of gets) {
            expect(GuardaSomenteLeituraConexos.GET_LEITURA.some((re) => re.test(p))).toBe(true);
        }
        expect(r.g1).not.toHaveProperty('erro');
        expect(r.gt1gt2).not.toHaveProperty('erro');
        expect(r.gt3).not.toHaveProperty('erro');
        expect(r.gt4).not.toHaveProperty('erro');
    });

    it('a guarda recusa escrita sem chegar à rede e recusa POST fora de `list`', async () => {
        const inner = fakeLegacy();
        const g = GuardaSomenteLeituraConexos.envolver(inner as unknown as LegacyConexosShape);
        await expect(g.postGenericOnce('fin070', {})).rejects.toBeInstanceOf(
            ReadOnlyViolationError,
        );
        await expect(g.putGenericOnce('fin015/finItemSispag', {})).rejects.toBeInstanceOf(
            ReadOnlyViolationError,
        );
        await expect(g.postGeneric('fin103/liberar', {})).rejects.toBeInstanceOf(
            ReadOnlyViolationError,
        );
        await expect(g.deleteGeneric('ger014/componentes/1/2')).rejects.toBeInstanceOf(
            ReadOnlyViolationError,
        );
        await expect(
            g.postMultipartOnce('fin052/arquivosRetorno/carregar', new FormData()),
        ).rejects.toBeInstanceOf(ReadOnlyViolationError);
        await expect(
            g.listGenericPaginated('fin015/finItemSispag/validacao/codigoBarras', {}),
        ).rejects.toBeInstanceOf(ReadOnlyViolationError);
        await expect(g.listGeneric('fin070', {})).rejects.toBeInstanceOf(ReadOnlyViolationError);
        await expect(g.getGeneric('fin015/1/4/10')).rejects.toBeInstanceOf(ReadOnlyViolationError);
        for (const m of ESCRITAS_LEGACY) expect(inner[m]).not.toHaveBeenCalled();
        expect(inner.listGenericPaginated).not.toHaveBeenCalled();
        expect(inner.getGeneric).not.toHaveBeenCalled();
    });

    it('faz UM login só: o segundo (ex.: re-login de 401) é recusado', async () => {
        const login = jest.fn(async (_k?: string) => undefined);
        const svc = { login } as unknown as ConexosService;
        const sessao = SessaoUnicaConexos.limitarAUmLogin(svc);
        await svc.login();
        await svc.login('sessao-mais-antiga'); // retry interno do mesmo fluxo
        await expect(svc.login()).rejects.toThrow(/segundo login/);
        expect(login).toHaveBeenCalledTimes(2);
        expect(sessao.logins()).toBe(2);
    });
});

describe('validate-sispag-ajuste-centavos-v1 — medições', () => {
    it('GT1/GT2: divergência, pagamento parcial e regressões da régua nova', async () => {
        const { job } = montar();
        const r = (await job.medirReguaLiquida()) as Record<string, any>;
        expect(r.carteiraNaoEncontradaNoFin064).toBe(1);
        expect(r.universoFin064).toMatchObject({
            total: 5,
            divergentes: 2,
            incompletos: 1,
            comPagoParcial: 1,
            pagoLiquidoBrutoDoPago: 1,
            pagoLiquidoJaDescontaPago: 0,
            valorMuda: 1,
            regressoes: { total: 3, DIVERGENTE: 2, INCOMPLETO: 1, NEGATIVO: 0 },
        });
        expect(r.carteiraBoleto.total).toBe(2);
        expect(r.carteiraBoleto.regressoes.total).toBe(1);
    });

    it('régua: título sem acréscimo é idêntico nas duas réguas (caso canônico 5)', () => {
        const a = AnaliseReguaLiquida.avaliar(FIN064[0] as Linha);
        expect(a).toMatchObject({ completo: true, diverge: false, nova: 10000, antiga: 10000 });
        expect(a.motivoRegressao).toBeUndefined();
    });

    it('GT3: acha o J com pagamento ≠ barra e nunca expõe a barra completa', async () => {
        const { job } = montar();
        const r = (await job.executar()) as Record<string, any>;
        expect(r.gt3).toMatchObject({
            lotesNaJanela: 1,
            arquivos: 2,
            segmentosJ: 3,
            jComBarraPositiva: 2,
            divergentes: 1,
        });
        expect(r.gt3.divergencias[0]).toMatchObject({
            filCod: 1,
            flpCod: 10,
            arquivo: 'PG191001.REM',
            valorBarra: 462.5,
            pagamento: 462.49,
            valorTitulo: 462.49,
            desconto: 0,
            mora: 0,
        });
        const json = JSON.stringify(r);
        for (const b of [BARRA_OK, BARRA_DIVERGE, BARRA_ZERO]) expect(json).not.toContain(b);
        expect(json).not.toMatch(/\d{44}/);
    });

    it('GT4: pendentes com líquido ≠ valor e o efeito do ValorItemImport', async () => {
        const { job } = montar();
        const r = (await job.executar()) as Record<string, any>;
        expect(r.gt4).toMatchObject({
            linhas: 3,
            semLiquido: 2,
            liquidoDiferenteDoValor: 1,
            jurosNaoZero: 2,
            importIndisponivel: 0,
            importMudaValor: 2,
            somaAbsDeltaCentavos: 51,
        });
    });

    it('G1: CRUD e ações por tela × grupo; 500 RECORDNOTFOUND = sem linha', async () => {
        const { job, inner } = montar();
        const r = (await job.sondarPermissoes()) as Record<string, any>;
        expect(r.usnCod).toBe('97');
        expect(r.telasNaoEncontradas).toEqual(['FIN_106', 'FIN_064']);
        expect(r.destaques).toEqual({
            fin070Finalizar: true,
            fin070Cancelar: true,
            fin103Liberar: false,
        });
        const fin103 = r.matriz.find((m: Linha) => m.arquivo === 'FIN_103');
        expect(fin103).toMatchObject({ temLinha: false, motivo: 'RECORDNOTFOUND' });
        const caminhos = inner.listGenericPaginated.mock.calls.map((c) => String(c[0]));
        expect(caminhos).not.toContain('ger014/compAcao/list/901/4');
    });
});

describe('validate-sispag-ajuste-centavos-v1 — guarda estática do fonte', () => {
    const FONTE = readFileSync(
        path.join(__dirname, 'validate-sispag-ajuste-centavos-v1.ts'),
        'utf8',
    );
    const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
        .join('\n');

    it('não chama nenhum método de escrita (só os define na guarda, para recusar)', () => {
        for (const m of [...ESCRITAS_LEGACY, ...ESCRITAS_WRITE_CLIENT]) {
            expect(CODIGO).not.toMatch(new RegExp(`\\.${m}\\s*(<[^>]*>)?\\(`));
        }
        const usos = new Set([...CODIGO.matchAll(/write\.(\w+)/g)].map((m) => m[1]));
        expect(usos).toEqual(new Set(['listarArquivosRemessa', 'baixarRemessa']));
    });

    it('não usa o bootstrap (migrations) nem o singleton de sessão compartilhada', () => {
        expect(CODIGO).not.toContain('bootstrapAppContainer');
        expect(CODIGO).not.toMatch(/import\s*\{[^}]*\bconexosService\b/);
        expect(CODIGO).toContain('new ConexosSessionStore({ db: null })');
    });

    it('trava o banco em somente leitura e confere com SHOW; guardas de alvo no topo', () => {
        expect(CODIGO).toContain('SET default_transaction_read_only = on');
        expect(CODIGO).toContain('SHOW default_transaction_read_only');
        expect(CODIGO).toMatch(/process\.env\.ALVO !== 'prd'/);
        expect(CODIGO).toMatch(/process\.env\.SOMENTE_LEITURA !== '1'/);
        expect(CODIGO).toMatch(/includes\('hml'\)/);
        expect(CODIGO).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|\w+\s+SET)\b/i);
    });

    it('avisa no topo que o login derruba sessão e documenta a alternativa preferida', () => {
        expect(FONTE).toMatch(/DERRUBAR uma sessão viva/);
        expect(FONTE).toMatch(/Alternativa PREFERIDA/);
    });
});
