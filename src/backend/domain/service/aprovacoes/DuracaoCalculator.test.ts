import 'reflect-metadata';
import { ETAPA_STATUS } from '../../interface/aprovacoes/constants.js';
import DuracaoCalculator from './DuracaoCalculator.js';

describe('DuracaoCalculator', () => {
    const calc = new DuracaoCalculator();

    // Doc 4156/1, filial 1 (produção): recebido 2026-05-14 07:12:46, liberado 2026-05-15 06:41:40.
    const recebidoEm = new Date(1778753566000);
    const agidoEm = new Date(1778838100000);

    describe('duração da etapa', () => {
        it('caso canônico do doc 4156 dá 23h29m', () => {
            const s = calc.calcularDuracaoSegundos({
                recebidoEm,
                agidoEm,
                status: ETAPA_STATUS.CONCLUIDA,
            });

            expect(s).toBe(84534);
            expect((s ?? 0) / 3600).toBeCloseTo(23.48, 2);
        });

        it('etapa pendente não tem duração — nunca estimada (I3)', () => {
            expect(
                calc.calcularDuracaoSegundos({
                    recebidoEm,
                    agidoEm,
                    status: ETAPA_STATUS.PENDENTE,
                }),
            ).toBeUndefined();
        });

        it('etapa indeterminada não tem duração', () => {
            expect(
                calc.calcularDuracaoSegundos({
                    recebidoEm,
                    agidoEm,
                    status: ETAPA_STATUS.INDETERMINADO,
                }),
            ).toBeUndefined();
        });

        it('agidoEm igual a recebidoEm não vira duração zero', () => {
            // O Conexos carimba o mesmo instante enquanto ninguém age; zero afundaria a mediana.
            expect(
                calc.calcularDuracaoSegundos({
                    recebidoEm,
                    agidoEm: recebidoEm,
                    status: ETAPA_STATUS.CONCLUIDA,
                }),
            ).toBeUndefined();
        });

        it('agidoEm anterior a recebidoEm não é clampado para zero', () => {
            expect(
                calc.calcularDuracaoSegundos({
                    recebidoEm: agidoEm,
                    agidoEm: recebidoEm,
                    status: ETAPA_STATUS.CONCLUIDA,
                }),
            ).toBeUndefined();
        });

        it('rejeição também produz duração', () => {
            expect(
                calc.calcularDuracaoSegundos({
                    recebidoEm,
                    agidoEm,
                    status: ETAPA_STATUS.REJEITADA,
                }),
            ).toBe(84534);
        });
    });

    describe('parada há — métrica separada da duração', () => {
        it('mede espera em curso de etapa pendente', () => {
            const agora = new Date(recebidoEm.getTime() + 3600 * 1000);

            expect(
                calc.calcularParadaHaSegundos({
                    recebidoEm,
                    status: ETAPA_STATUS.PENDENTE,
                    agora,
                }),
            ).toBe(3600);
        });

        it('não se aplica a etapa concluída — somá-la à duração enviesaria a média', () => {
            expect(
                calc.calcularParadaHaSegundos({
                    recebidoEm,
                    status: ETAPA_STATUS.CONCLUIDA,
                    agora: agidoEm,
                }),
            ).toBeUndefined();
        });
    });

    describe('tempo total do título', () => {
        it('usa dataFinalizacao como marco zero quando ela existir (PV-04)', () => {
            const dataFinalizacao = new Date(recebidoEm.getTime() - 7200 * 1000);

            expect(
                calc.calcularTempoTotalSegundos({
                    dataFinalizacao,
                    primeiraEtapaEm: recebidoEm,
                    ultimaAcaoEm: agidoEm,
                    temPendente: false,
                    agora: agidoEm,
                }),
            ).toBe(84534 + 7200);
        });

        it('cai para a primeira etapa quando dataFinalizacao não existe', () => {
            expect(
                calc.calcularTempoTotalSegundos({
                    primeiraEtapaEm: recebidoEm,
                    ultimaAcaoEm: agidoEm,
                    temPendente: false,
                    agora: agidoEm,
                }),
            ).toBe(84534);
        });

        it('conta até agora enquanto houver etapa pendente', () => {
            const agora = new Date(recebidoEm.getTime() + 10_000);

            expect(
                calc.calcularTempoTotalSegundos({
                    primeiraEtapaEm: recebidoEm,
                    ultimaAcaoEm: undefined,
                    temPendente: true,
                    agora,
                }),
            ).toBe(10);
        });
    });
});
