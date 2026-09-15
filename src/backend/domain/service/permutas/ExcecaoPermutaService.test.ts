import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type Adiantamento from '../../interface/permutas/Adiantamento.js';
import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
    MOTIVO_BLOQUEIO,
    type MotivoBloqueio,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import { GATE } from '../../interface/permutas/PermutaCandidata.js';
import type ExcecaoPermutaRepository from '../../repository/permutas/ExcecaoPermutaRepository.js';
import type PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import type LogService from '../LogService.js';
import ExcecaoPermutaService from './ExcecaoPermutaService.js';

const buildService = () =>
    new ExcecaoPermutaService(
        {} as unknown as PostgreeDatabaseClient,
        {} as unknown as PermutaRelationalRepository,
        {} as unknown as ExcecaoPermutaRepository,
        { info: jest.fn(), warn: jest.fn() } as unknown as LogService,
    );

const adto8721: Adiantamento = {
    docCod: '8721',
    priCod: '124',
    filCod: 2,
    dataEmissao: new Date('2026-01-10'),
    valor: 20373009.89,
    moeda: 'USD',
    pago: true,
    valorPermutar: 0,
    valorAberto: 0.02,
};

const gates8721 = [
    { gate: GATE.PROFORMA, passed: true },
    { gate: GATE.VALOR_PERMUTAR, passed: false, detail: 'sem saldo' },
    { gate: GATE.TOTALMENTE_PAGO, passed: true },
];

const candidata = (
    estado: EstadoElegibilidade,
    motivo?: MotivoBloqueio,
    over: Partial<Adiantamento> = {},
): PermutaCandidata => ({
    priCod: '124',
    adiantamento: { ...adto8721, ...over },
    estadoElegibilidade: estado,
    ...(motivo !== undefined ? { motivoBloqueio: motivo } : {}),
    gatesAvaliados: gates8721,
});

describe('ExcecaoPermutaService', () => {
    describe('guardaSatisfeita', () => {
        it('só BLOQUEADA + sem-saldo-permutar satisfaz a guarda', () => {
            const service = buildService();
            expect(
                service.guardaSatisfeita(
                    ESTADO_ELEGIBILIDADE.BLOQUEADA,
                    MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                ),
            ).toBe(true);
            expect(
                service.guardaSatisfeita(ESTADO_ELEGIBILIDADE.BLOQUEADA, MOTIVO_BLOQUEIO.NAO_PAGO),
            ).toBe(false);
            expect(
                service.guardaSatisfeita(
                    ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                    MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                ),
            ).toBe(false);
            expect(service.guardaSatisfeita(ESTADO_ELEGIBILIDADE.ELEGIVEL)).toBe(false);
        });
    });

    describe('aplicarExcecoes', () => {
        it('8721 sem saldo + exceção ativa → JA_PERMUTADO / permutado-fora-do-painel, gates intactos', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(avisos).toEqual([]);
            expect(candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.JA_PERMUTADO);
            expect(candidatas[0].motivoBloqueio).toBe(MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL);
            // Auditoria dos gates: o Gate 2 segue reprovado — a exceção só troca a classificação.
            expect(candidatas[0].gatesAvaliados).toEqual(gates8721);
            expect(
                candidatas[0].gatesAvaliados.find((g) => g.gate === GATE.VALOR_PERMUTAR)?.passed,
            ).toBe(false);
            // Não muta a candidata recebida.
            expect(original.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        });

        it('mesma candidata SEM exceção → inalterada (mesma referência)', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set());

            expect(candidatas[0]).toBe(original);
            expect(avisos).toEqual([]);
        });

        it.each([
            [ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL, MOTIVO_BLOQUEIO.CLIENTE_FILTRO],
            [ESTADO_ELEGIBILIDADE.BLOQUEADA, MOTIVO_BLOQUEIO.NAO_PAGO],
        ])('exceção ativa + calculado %s/%s → o cálculo vence e emite aviso', (estado, motivo) => {
            const service = buildService();
            const original = candidata(estado, motivo, { valorPermutar: 5000 });

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(candidatas[0]).toBe(original);
            expect(avisos).toEqual([
                {
                    docCod: '8721',
                    estadoCalculado: estado,
                    motivoCalculado: motivo,
                    transiente: false,
                },
            ]);
        });

        it('exceção ativa + calculado ja-permutado (valorPermutado > 0) → o motivo do ERP vence', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                MOTIVO_BLOQUEIO.JA_PERMUTADO,
                { valorPermutado: 20373009.87 },
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(candidatas[0].motivoBloqueio).toBe(MOTIVO_BLOQUEIO.JA_PERMUTADO);
            expect(avisos).toHaveLength(1);
            expect(avisos[0]).toMatchObject({
                docCod: '8721',
                estadoCalculado: ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                motivoCalculado: MOTIVO_BLOQUEIO.JA_PERMUTADO,
                transiente: false,
            });
        });

        it('exceção ativa + detail-indisponivel → mantém o calculado e marca o aviso como transiente', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(candidatas[0]).toBe(original);
            expect(avisos).toEqual([
                {
                    docCod: '8721',
                    estadoCalculado: ESTADO_ELEGIBILIDADE.BLOQUEADA,
                    motivoCalculado: MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
                    transiente: true,
                },
            ]);
        });

        it('exceções de docCod sem candidata na run → ignoradas, sem aviso nem erro', () => {
            const service = buildService();
            const outro = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                { docCod: '9999' },
            );

            const { candidatas, avisos } = service.aplicarExcecoes(
                [outro],
                new Set(['8721', '5555']),
            );

            expect(candidatas).toEqual([outro]);
            expect(avisos).toEqual([]);
        });
    });
});
