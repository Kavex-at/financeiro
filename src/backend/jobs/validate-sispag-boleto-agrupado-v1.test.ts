import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ConexosBaseClient, { type LegacyConexosShape } from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import { MOTIVO_GRUPO_INELEGIVEL as M } from '../domain/interface/sispag/GrupoBoletoInterface.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import F from '../domain/service/sispag/__fixtures__/grupoBoleto.js';
import MotorGrupoBoleto, {
    type EntradaMotorGrupo,
} from '../domain/service/sispag/MotorGrupoBoleto.js';
import RegraGrupoBoleto from '../domain/service/sispag/RegraGrupoBoleto.js';
import { GuardaSomenteLeituraConexos } from './validate-sispag-ajuste-centavos-v1.js';
import {
    conferirGuardasBoletoAgrupado,
    ValidacaoBoletoAgrupadoV1,
} from './validate-sispag-boleto-agrupado-v1.js';

/**
 * Task 22 (ADR-0077): medição PRD SOMENTE LEITURA — GT1 (o motor sobre a carteira + pool reais) e
 * GT2 (o líquido ao vivo do `fin064` contra o `valor` local, para cada título sugerido).
 */

const codigoBarras = new CodigoBarrasBoleto();
const motor = new MotorGrupoBoleto(
    codigoBarras,
    BankingCalendar.withClock(() => new Date('2026-10-20T15:00:00Z')),
    new RegraGrupoBoleto(codigoBarras),
);

const entrada = (over: Partial<EntradaMotorGrupo>): EntradaMotorGrupo => ({
    titulos: [],
    boletos: [],
    paresVigentes: [],
    decisoesConfirmadas: [],
    gruposConfirmados: [],
    marcasAtivas: [],
    ...over,
});

type Linha = Record<string, unknown>;

/** Líquido ao vivo = `valor` local por padrão; `vivo` troca o de um título. */
const sispagFalso = (vivo: Record<string, number | 'ilegivel'> = {}) => ({
    lerValoresAberto: jest.fn(async (_fil: number, docCod: string) => {
        const v = vivo[docCod];
        if (v === 'ilegivel') return { legivel: false as const, motivo: 'fora do ar' };
        const reais = v ?? 525;
        return {
            legivel: true as const,
            valores: {
                totalLiquido: reais,
                totalPago: 0,
                totalAberto: reais,
                titMnyJuros: 0,
                titMnyDesconto: 0,
            },
        };
    }),
});

const job = (e: EntradaMotorGrupo, sispag = sispagFalso()) =>
    new ValidacaoBoletoAgrupadoV1({ motor, entrada: e, sispag });

describe('validate-sispag-boleto-agrupado-v1 — GT1 (motor sobre carteira + pool)', () => {
    it('PEDRONI 38883–38885 × 332841: presente, confirmável, zero subconjunto', async () => {
        const r = await job(entrada(F.pedroni())).executar();
        expect(r.gt1).toMatchObject({
            sugestoes: 1,
            confirmaveis: 1,
            naoConfirmaveis: 0,
            intercambiaveis: 0,
            cruzados: 0,
            subconjuntos: 0,
            pedroni: { presente: true },
        });
    });

    it('PEDRONI ausente: justifica (títulos fora da carteira × sem o boleto)', async () => {
        const fora = await job(entrada({})).executar();
        expect(fora.gt1.pedroni).toMatchObject({
            presente: false,
            justificativa: 'TITULOS_FORA_DA_CARTEIRA',
        });
        const semBoleto = await job(entrada({ titulos: F.pedroni().titulos })).executar();
        expect(semBoleto.gt1.pedroni).toMatchObject({
            presente: false,
            justificativa: 'BOLETO_332841_FORA_DO_POOL',
        });
    });

    it('conta não confirmáveis por motivo (PI-7) sem descartar o título', async () => {
        const p = F.pedroni();
        const titulos = p.titulos.map((t) =>
            t.docCod === '38884' ? { ...t, liberado: false } : t,
        );
        const r = await job(entrada({ ...p, titulos })).executar();
        expect(r.gt1).toMatchObject({ sugestoes: 1, confirmaveis: 0, naoConfirmaveis: 1 });
        expect(r.gt1.porMotivo).toMatchObject({ [M.NAO_LIBERADO]: 1 });
    });

    it('conta os intercambiáveis (I21f)', async () => {
        const r = await job(entrada(F.pedroniIntercambiavel())).executar();
        expect(r.gt1).toMatchObject({ sugestoes: 3, intercambiaveis: 3, subconjuntos: 0 });
    });

    it('um quarto título aberto no mesmo vencimento ⇒ nenhuma sugestão (nunca subconjunto)', async () => {
        const p = F.pedroni();
        const quarto = F.titulo({ docCod: '38886', valor: 100 });
        const r = await job(entrada({ ...p, titulos: [...p.titulos, quarto] })).executar();
        expect(r.gt1).toMatchObject({ sugestoes: 0, subconjuntos: 0 });
    });

    it('prova o invariante: uma sugestão que fosse subconjunto do conjunto aberto é contada', () => {
        const p = F.pedroni();
        const quarto = F.titulo({ docCod: '38886', valor: 100 });
        const todos = [...p.titulos, quarto];
        const subconjunto = {
            filCod: 2,
            pesCod: '9001',
            vencimentoBoleto: '2026-10-21',
            titulos: p.titulos.map((t) => ({ docCod: t.docCod, titCod: t.titCod })),
        };
        expect(ValidacaoBoletoAgrupadoV1.contarSubconjuntos([subconjunto as never], todos)).toBe(1);
    });

    it('cruzados: conta os grupos com CRUZA_FILIAL', async () => {
        const p = F.pedroni();
        const titulos = p.titulos.map((t, i) => (i === 0 ? { ...t, filCod: 1 } : t));
        const r = await job(entrada({ ...p, titulos })).executar();
        expect(r.gt1.cruzados).toBe(r.gt1.porMotivo[M.CRUZA_FILIAL] ?? 0);
    });
});

describe('validate-sispag-boleto-agrupado-v1 — GT2 (líquido ao vivo × valor local)', () => {
    it('ao vivo == local ⇒ nenhum grupo recusado', async () => {
        const sispag = sispagFalso();
        const r = await job(entrada(F.pedroni()), sispag).executar();
        expect(sispag.lerValoresAberto).toHaveBeenCalledTimes(3);
        expect(r.gt2).toMatchObject({
            gruposAvaliados: 1,
            titulosLidos: 3,
            ilegiveis: 0,
            divergentes: 0,
            gruposRecusados: 0,
        });
    });

    it('um título com R$ 0,01 de diferença ⇒ o grupo seria recusado (alimenta G1)', async () => {
        const r = await job(entrada(F.pedroni()), sispagFalso({ '38884': 525.01 })).executar();
        expect(r.gt2).toMatchObject({ divergentes: 1, gruposRecusados: 1 });
        expect(r.gt2.divergencias[0]).toMatchObject({
            docCod: '38884',
            localCentavos: 52500,
            vivoCentavos: 52501,
        });
    });

    it('título ilegível ao vivo ⇒ conta como ilegível e recusa o grupo (fail-closed)', async () => {
        const r = await job(entrada(F.pedroni()), sispagFalso({ '38885': 'ilegivel' })).executar();
        expect(r.gt2).toMatchObject({ ilegiveis: 1, gruposRecusados: 1 });
    });

    it('só lê o fin064 dos títulos de grupos SUGERIDOS (não da carteira inteira)', async () => {
        const p = F.pedroni();
        const avulso = F.titulo({ docCod: '999', pesCod: '5555', vencimentoCivil: '2026-11-30' });
        const sispag = sispagFalso();
        await job(entrada({ ...p, titulos: [...p.titulos, avulso] }), sispag).executar();
        const lidos = sispag.lerValoresAberto.mock.calls.map((c) => c[1]);
        expect(lidos).not.toContain('999');
    });

    it('a saída nunca traz código de barras completo', async () => {
        const r = await job(entrada(F.pedroni()), sispagFalso({ '38884': 525.01 })).executar();
        const json = JSON.stringify(r);
        for (const b of F.pedroni().boletos) expect(json).not.toContain(b.codbar ?? 'x');
        expect(json).not.toMatch(/\d{44}/);
    });
});

describe('validate-sispag-boleto-agrupado-v1 — zero escrita', () => {
    const ESCRITAS = [
        'postGeneric',
        'postGenericOnce',
        'putGenericOnce',
        'postMultipartOnce',
        'deleteGeneric',
    ] as const;

    it('o job inteiro, sobre o client real e a guarda, só faz POST de fin064/list', async () => {
        const legacy = {
            ensureSid: jest.fn(async () => undefined),
            getFiliais: jest.fn(async () => [{ filCod: 2 }]),
            getFilCodDefault: jest.fn(async () => 2),
            listGeneric: jest.fn(async () => []),
            listGenericPaginated: jest.fn(async (_p: string, body: Linha) => {
                const filtro = JSON.stringify(body);
                const doc = ['38883', '38884', '38885'].find((d) => filtro.includes(d)) ?? '0';
                return {
                    count: 1,
                    rows: [
                        {
                            docCod: doc,
                            titCod: 1,
                            totalLiquido: 525,
                            totalPago: 0,
                            totalAberto: 525,
                            titMnyJuros: 0,
                            titMnyDesconto: 0,
                        },
                    ],
                };
            }),
            getGeneric: jest.fn(),
            postGeneric: jest.fn(),
            postGenericOnce: jest.fn(),
            putGenericOnce: jest.fn(),
            postMultipartOnce: jest.fn(),
            deleteGeneric: jest.fn(),
        };
        const registro: Array<{ metodo: string; path: string }> = [];
        const guardado = GuardaSomenteLeituraConexos.envolver(
            legacy as unknown as LegacyConexosShape,
            registro,
        );
        const sispag = new ConexosSispagClient(new ConexosBaseClient(guardado));
        const r = await job(entrada(F.pedroni()), sispag as never).executar();
        for (const m of ESCRITAS) expect(legacy[m]).not.toHaveBeenCalled();
        expect(registro.filter((c) => c.metodo.startsWith('RECUSADO:'))).toEqual([]);
        for (const c of legacy.listGenericPaginated.mock.calls) expect(c[0]).toBe('fin064/list');
        expect(legacy.getGeneric).not.toHaveBeenCalled();
        expect(r.gt2.titulosLidos).toBe(3);
    });
});

describe('validate-sispag-boleto-agrupado-v1 — travas de execução', () => {
    const OK = {
        ALVO: 'prd',
        SOMENTE_LEITURA: '1',
        CONEXOS_BASE_URL: 'https://columbiatrading.conexos.cloud/api',
        CONEXOS_USERNAME: 'MPS_SERVIDOR',
        CONEXOS_PASSWORD: 'x',
        databaseConnectionString: 'postgres://u:p@db.prd.example.com:5432/app',
    };
    const FLAG = ['--eu-entendo-que-derruba-uma-sessao-viva'];

    it('aceita só com todas as travas', () => {
        expect(conferirGuardasBoletoAgrupado(OK, FLAG)).toBeUndefined();
    });

    it.each([
        ['sem ALVO=prd', { ...OK, ALVO: 'hml' }, FLAG],
        ['sem SOMENTE_LEITURA=1', { ...OK, SOMENTE_LEITURA: '' }, FLAG],
        ['sem a flag da sessão', OK, []],
        [
            'URL de HML',
            { ...OK, CONEXOS_BASE_URL: 'https://columbiatrading-hml.conexos.cloud' },
            FLAG,
        ],
        ['login CLONEX', { ...OK, CONEXOS_USERNAME: 'CLONEX' }, FLAG],
        ['sem credencial', { ...OK, CONEXOS_PASSWORD: '' }, FLAG],
        ['banco local', { ...OK, databaseConnectionString: 'postgres://u:p@localhost/x' }, FLAG],
        ['sem banco', { ...OK, databaseConnectionString: '' }, FLAG],
    ])('recusa: %s', (_nome, env, argv) => {
        expect(conferirGuardasBoletoAgrupado(env as never, argv as string[])).toEqual(
            expect.any(String),
        );
    });
});

describe('validate-sispag-boleto-agrupado-v1 — o arquivo do job', () => {
    const arquivo = path.join(__dirname, 'validate-sispag-boleto-agrupado-v1.ts');
    const CODIGO = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';

    it('usa a guarda, a trava do pg e o login único; não sobe o container de migrations', () => {
        expect(CODIGO).toContain('GuardaSomenteLeituraConexos.envolver(');
        expect(CODIGO).toContain('TravaSomenteLeituraPg.aplicar(');
        expect(CODIGO).toContain('SessaoUnicaConexos.limitarAUmLogin(');
        expect(CODIGO).toContain('new ConexosSessionStore({ db: null })');
        expect(CODIGO).not.toContain('bootstrapAppContainer(');
    });

    it('não nomeia nenhuma escrita', () => {
        for (const nome of [
            'ConexosSispagWriteClient',
            'ConexosBaixaClient',
            'criarBorderoDoGrupo',
            'criarLote',
            'importarTitulos',
            'finalizarLote',
            'postGenericOnce(',
            'putGenericOnce(',
            'deleteGeneric(',
            '.upsertMany(',
            '.inserirPar(',
            'withTransaction',
        ]) {
            expect(CODIGO).not.toContain(nome);
        }
    });

    it('só SELECT no banco e grava só o JSON de resultado', () => {
        expect(CODIGO).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/);
        expect(CODIGO).toContain('resultado.json');
    });
});
