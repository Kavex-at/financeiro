import 'reflect-metadata';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import { CONFIG_MANIFESTO, CRITICIDADE } from '../../interface/operacao/configManifest.js';
import ConfigDoctor, { ESTADO_CONFIG } from './ConfigDoctor.js';

const notificacaoFake = () => ({ emitir: jest.fn().mockResolvedValue(null) });
const doctor = (notif = notificacaoFake()) =>
    ({ instancia: new ConfigDoctor(notif as never), notif }) as const;

const acharVar = (d: ReturnType<ConfigDoctor['diagnosticar']>, nome: string) => {
    const v = d.vars.find((x) => x.nome === nome);
    if (v === undefined) throw new Error(`${nome} ausente do diagnóstico`);
    return v;
};

describe('ConfigDoctor — classificação', () => {
    it('var presente com valor → configurado', () => {
        const d = doctor().instancia.diagnosticar({ CONEXOS_USERNAME: 'robo' });
        expect(acharVar(d, 'CONEXOS_USERNAME').estado).toBe(ESTADO_CONFIG.CONFIGURADO);
    });

    it('var ausente SEM default → ausente', () => {
        const d = doctor().instancia.diagnosticar({});
        expect(acharVar(d, 'RECEBIMENTO_TITULARES_INTERNOS').estado).toBe(ESTADO_CONFIG.AUSENTE);
    });

    it('var ausente COM default → usando-default (distinta de ausente)', () => {
        const d = doctor().instancia.diagnosticar({});
        expect(acharVar(d, 'CONEXOS_DRY_RUN').estado).toBe(ESTADO_CONFIG.USANDO_DEFAULT);
    });

    it('string VAZIA conta como ausente — desliga a regra igual à ausência total', () => {
        const d = doctor().instancia.diagnosticar({ RECEBIMENTO_TITULARES_INTERNOS: '   ' });
        expect(acharVar(d, 'RECEBIMENTO_TITULARES_INTERNOS').estado).toBe(ESTADO_CONFIG.AUSENTE);
    });

    it('conta as ausentes por criticidade', () => {
        const d = doctor().instancia.diagnosticar({});
        expect(d.totalAusentesObrigatorias).toBeGreaterThan(0);
        expect(d.totalAusentesSilenciosas).toBeGreaterThan(0);
    });
});

describe('ConfigDoctor — I3: nunca expõe valor de segredo', () => {
    const AMBIENTE_COM_SEGREDOS = {
        CONEXOS_PASSWORD: 'senha-super-secreta-123',
        databaseConnectionString: 'postgresql://user:p4ssw0rd@host:5432/db',
        AUTH_JWT_SECRET: 'jwt-secret-abcdef',
        CONEXOS_CRED_ENC_KEY: 'YmFzZTY0LWtleS0zMi1ieXRlcw==',
        CONEXOS_USERNAME: 'robo-columbia',
    };

    it('a garantia é ESTRUTURAL: nenhum valor do ambiente aparece no diagnóstico serializado', () => {
        const d = doctor().instancia.diagnosticar(AMBIENTE_COM_SEGREDOS);
        const serializado = JSON.stringify(d);

        for (const valor of Object.values(AMBIENTE_COM_SEGREDOS)) {
            expect(serializado).not.toContain(valor);
        }
    });

    it('vale inclusive para vars cujo NOME não parece segredo', () => {
        // CONEXOS_PASSWORD não contém "secret"; SN_GCD_COD contém "COD" e não é segredo.
        // Heurística de nome erraria nos dois sentidos — por isso `segredo` é marcado por var.
        const d = doctor().instancia.diagnosticar({
            ...AMBIENTE_COM_SEGREDOS,
            SN_GCD_COD: '150',
        });
        expect(JSON.stringify(d)).not.toContain('senha-super-secreta-123');
        expect(acharVar(d, 'CONEXOS_PASSWORD').segredo).toBe(true);
        expect(acharVar(d, 'SN_GCD_COD').segredo).toBe(false);
    });

    it('o alerta emitido também não carrega nada lido do ambiente', async () => {
        const { instancia, notif } = doctor();
        await instancia.verificarNoBoot(AMBIENTE_COM_SEGREDOS);

        const serializado = JSON.stringify(notif.emitir.mock.calls);
        for (const valor of Object.values(AMBIENTE_COM_SEGREDOS)) {
            expect(serializado).not.toContain(valor);
        }
    });

    it('nenhuma entrada do diagnóstico tem campo de valor', () => {
        const d = doctor().instancia.diagnosticar(AMBIENTE_COM_SEGREDOS);
        for (const v of d.vars) {
            expect(Object.keys(v)).not.toContain('valor');
            expect(Object.keys(v)).not.toContain('value');
        }
    });
});

describe('ConfigDoctor — alerta no boot', () => {
    it('alerta as obrigatórias ausentes como erro', async () => {
        const { instancia, notif } = doctor();
        await instancia.verificarNoBoot({});

        const alvos = notif.emitir.mock.calls.map(([a]: [{ alvo: string }]) => a.alvo);
        expect(alvos).toContain('CONEXOS_PASSWORD');
        const chamada = notif.emitir.mock.calls.find(
            ([a]: [{ alvo: string }]) => a.alvo === 'CONEXOS_PASSWORD',
        );
        expect(chamada?.[0]).toMatchObject({
            tipo: ALERTA_TIPO.CONFIG_AUSENTE,
            severidade: ALERTA_SEVERIDADE.ERRO,
        });
    });

    it('alerta as que degradam em silêncio como AVISO — as duas que já causaram defeito', async () => {
        const { instancia, notif } = doctor();
        await instancia.verificarNoBoot({});

        const alvos = notif.emitir.mock.calls.map(([a]: [{ alvo: string }]) => a.alvo);
        expect(alvos).toContain('RECEBIMENTO_TITULARES_INTERNOS');
        expect(alvos).toContain('COM297_GCD_NOTA_DEBITO');

        const titulares = notif.emitir.mock.calls.find(
            ([a]: [{ alvo: string }]) => a.alvo === 'RECEBIMENTO_TITULARES_INTERNOS',
        );
        expect(titulares?.[0].severidade).toBe(ALERTA_SEVERIDADE.AVISO);
    });

    it('NÃO alerta as opcionais ausentes — ruído treina o time a ignorar o canal', async () => {
        const { instancia, notif } = doctor();
        await instancia.verificarNoBoot({});

        const alvos = notif.emitir.mock.calls.map(([a]: [{ alvo: string }]) => a.alvo);
        expect(alvos).not.toContain('CONEXOS_DRY_RUN');
        expect(alvos).not.toContain('SISPAG_ENABLED');
    });

    it('ambiente completo não gera alerta nenhum', async () => {
        const completo: NodeJS.ProcessEnv = {};
        for (const m of CONFIG_MANIFESTO) completo[m.nome] = 'x';

        const { instancia, notif } = doctor();
        await instancia.verificarNoBoot(completo);
        expect(notif.emitir).not.toHaveBeenCalled();
    });

    it('NÃO derruba o boot quando a emissão do alerta falha', async () => {
        const notif = { emitir: jest.fn().mockRejectedValue(new Error('db fora')) };
        await expect(new ConfigDoctor(notif as never).verificarNoBoot({})).resolves.toBeDefined();
    });
});

describe('CONFIG_MANIFESTO — sanidade do próprio manifesto', () => {
    it('não tem nome duplicado (duplicata alertaria duas vezes o mesmo problema)', () => {
        const nomes = CONFIG_MANIFESTO.map((m) => m.nome);
        expect(new Set(nomes).size).toBe(nomes.length);
    });

    it('toda var declara a consequência de faltar — é o texto que evita a próxima surpresa', () => {
        for (const m of CONFIG_MANIFESTO) {
            expect(m.consequenciaSeAusente.length).toBeGreaterThan(20);
        }
    });

    it('cobre nomeadamente as duas vars que já produziram defeito em produção', () => {
        const nomes = CONFIG_MANIFESTO.map((m) => m.nome);
        expect(nomes).toContain('RECEBIMENTO_TITULARES_INTERNOS');
        expect(nomes).toContain('COM297_GCD_NOTA_DEBITO');
    });

    it('nenhuma var obrigatória é classificada como opcional por engano', () => {
        const obrigatorias = CONFIG_MANIFESTO.filter(
            (m) => m.criticidade === CRITICIDADE.OBRIGATORIA,
        ).map((m) => m.nome);
        expect(obrigatorias).toEqual(
            expect.arrayContaining([
                'databaseConnectionString',
                'CONEXOS_USERNAME',
                'CONEXOS_PASSWORD',
            ]),
        );
    });
});
