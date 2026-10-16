import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BoletoDda } from '../domain/interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../domain/interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import MotorSugestaoBoleto from '../domain/service/sispag/MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from '../domain/service/sispag/RegraSugestaoBoleto.js';
import MedirDesfechoSugestaoBoletoJob from './MedirDesfechoSugestaoBoletoJob.js';

const AGORA = new Date('2026-10-15T15:00:00Z');
const calendar = BankingCalendar.withClock(() => AGORA);
const motor = new MotorSugestaoBoleto(
    new CodigoBarrasBoleto(),
    calendar,
    new RegraSugestaoBoleto(),
);
const utc = (civil: string): number => Date.parse(`${civil}T00:00:00Z`);

const titulo = (over: Partial<TituloAPagar>): TituloAPagar => ({
    filCod: 1,
    docCod: '1',
    titCod: '1',
    pesCod: '7001',
    credor: 'ACME',
    valor: 100,
    vencimento: utc('2026-10-20'),
    liberado: true,
    pago: false,
    temBoleto: false,
    formaPagamentoConexos: 6,
    ativo: true,
    ...over,
});

const boleto = (over: Partial<BoletoDda>): BoletoDda => ({
    ddcCod: 500,
    ditCod: 1,
    valor: 100,
    vencimento: '2026-10-20',
    codbar: '',
    ...over,
});

const montar = (titulos: TituloAPagar[], boletos: BoletoDda[], sync = 1_760_000_000_000) => {
    const consultas: string[] = [];
    const job = new MedirDesfechoSugestaoBoletoJob(
        {
            listAtivos: async () => {
                consultas.push('titulos');
                return titulos;
            },
        } as never,
        {
            listBoletos: async () => {
                consultas.push('boletos');
                return boletos;
            },
            ultimaSincronizacao: async () => sync,
        } as never,
        {
            listarParesVigentes: async () => [],
            listarChaveadas: async () => [],
        } as never,
        { listTitulosEmLotesAbertos: async () => [] } as never,
        motor,
        calendar,
    );
    return { job, consultas };
};

describe('MedirDesfechoSugestaoBoletoJob (Task 1, somente leitura)', () => {
    it('conta elegíveis, com linha, sem linha e por resultado', async () => {
        const { job } = montar(
            [
                titulo({ docCod: '1' }), // FORTE com o boleto 1
                titulo({ docCod: '2', valor: 5000 }), // sem candidato
                titulo({ docCod: '3', pago: true }), // inelegível
                titulo({ docCod: '4', temBoleto: true, valor: 77 }), // inelegível
                titulo({ docCod: '5', formaPagamentoConexos: 1 }), // inelegível (não é boleto)
                titulo({ docCod: '6', filCod: 7, valor: 9000 }), // sem candidato, filial 7
            ],
            [boleto({ ditCod: 1 })],
        );
        const r = await job.executar();
        expect(r.titulosAtivos).toBe(6);
        expect(r.boletosNoPool).toBe(1);
        expect(r.elegiveis).toBe(3);
        expect(r.comLinha).toBe(1);
        expect(r.semLinha).toBe(2);
        expect(r.porResultado).toEqual({ FORTE: 1 });
        expect(r.elegiveisPorFilial).toEqual({ '1': 2, '7': 1 });
        expect(r.semLinhaPorFilial).toEqual({ '1': 1, '7': 1 });
        expect(r.chavesSemLinha).toEqual(['1:2:1', '7:6:1']);
    });

    it('Task 16: 100 % dos elegíveis têm desfecho; conta por situação e a participação de SO_FRACA', async () => {
        const { job } = montar(
            [
                titulo({ docCod: '1' }), // UNICA_SEGURA
                titulo({ docCod: '2', valor: 5000 }), // SEM_CANDIDATO
                titulo({ docCod: '3', pago: true }), // inelegível
                titulo({ docCod: '4', valor: 300 }), // SO_FRACA
                titulo({ docCod: '6', filCod: 7, valor: 9000 }), // SEM_CANDIDATO, filial 7
            ],
            [boleto({ ditCod: 1 }), boleto({ ditCod: 2, valor: 304 })],
        );
        const r = await job.executar();
        expect(r.elegiveis).toBe(4);
        expect(r.semDesfecho).toBe(0);
        expect(r.chavesSemDesfecho).toEqual([]);
        expect(r.porSituacao).toEqual({ UNICA_SEGURA: 1, SEM_CANDIDATO: 2, SO_FRACA: 1 });
        expect(Object.values(r.porSituacao).reduce((a, b) => a + b, 0)).toBe(r.elegiveis);
        expect(r.participacaoSoFraca).toBeCloseTo(0.25);
        expect(r.porSituacaoPorFilial['7']).toEqual({ SEM_CANDIDATO: 1 });
    });

    it('registra o instante, a data civil BRT e o sincronizadoEm do pool', async () => {
        const { job } = montar([], [], 1_760_000_123_000);
        const r = await job.executar();
        expect(r.executadoEm).toBe('2026-10-15T15:00:00.000Z');
        expect(r.dataCivil).toBe('2026-10-15');
        expect(r.sincronizadoEm).toBe(1_760_000_123_000);
    });

    it('só lê: consulta carteira e pool, e o resultado não carrega barras', async () => {
        const { job, consultas } = montar(
            [titulo({})],
            [boleto({ codbar: '2379'.padEnd(44, '1') })],
        );
        const r = await job.executar();
        expect(consultas.sort()).toEqual(['boletos', 'titulos']);
        expect(JSON.stringify(r)).not.toMatch(/\d{44}/);
    });

    it.each([
        ['postgres://u:p@localhost:5432/db', 'local'],
        ['postgres://u:p@127.0.0.1:5432/db', 'local'],
        ['postgres://u:p@db.exemplo.supabase.co:5432/postgres', 'prd'],
        ['isto-nao-e-url', 'prd'],
    ])('classifica o alvo de %s como %s (aborta se a flag divergir)', (url, esperado) => {
        expect(MedirDesfechoSugestaoBoletoJob.classificarAlvo(url)).toBe(esperado);
    });

    describe('guarda estática', () => {
        const ler = (arquivo: string): string =>
            readFileSync(path.join(__dirname, arquivo), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
                .join('\n');
        const fontes = [
            ['MedirDesfechoSugestaoBoletoJob.ts', ler('MedirDesfechoSugestaoBoletoJob.ts')],
            ['medir-desfecho-sugestao-boleto.ts', ler('medir-desfecho-sugestao-boleto.ts')],
        ] as const;

        it.each(fontes)('%s não resolve client do ERP nem LogService', (_n, codigo) => {
            expect(codigo).not.toMatch(
                /Conexos(Base|Sispag)?Client|LogService|bootstrapAppContainer/,
            );
        });

        it.each(
            fontes,
        )('%s não escreve (sem INSERT/UPDATE/DELETE nem métodos de escrita)', (_n, codigo) => {
            expect(codigo).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
            expect(codigo).not.toMatch(
                /\.(inserir\w*|anular\w*|revogar\w*|salvar\w*|upsert\w*|gravar\w*)\(/,
            );
        });

        it('o entry exige --alvo, confere o alvo e a sessão somente leitura', () => {
            const entry = fontes[1][1];
            expect(entry).toMatch(/--alvo/);
            expect(entry).toMatch(/classificarAlvo/);
            expect(entry).toMatch(/default_transaction_read_only/);
        });
    });
});
