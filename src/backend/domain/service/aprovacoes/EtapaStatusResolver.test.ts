import 'reflect-metadata';
import { ETAPA_STATUS, LACUNA } from '../../interface/aprovacoes/constants.js';
import type { FinTituloBloqRow } from '../../interface/aprovacoes/EtapaAprovacao.js';
import EtapaStatusResolver from './EtapaStatusResolver.js';

/**
 * Os casos vêm da sondagem read-only em produção (2026-08-18/19), não de imaginação —
 * ver `ontology/_inbox/frente-v-probe-resultado.md`.
 */
describe('EtapaStatusResolver', () => {
    const resolver = new EtapaStatusResolver();

    /** Etapa real: doc 4156/1, filial 1 — CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA. */
    const etapaReal = (over: Partial<FinTituloBloqRow> = {}): FinTituloBloqRow => ({
        filCod: 1,
        docTip: 2,
        docCod: 4156,
        titCod: 1,
        fblCod: 6,
        ftbCod: 1,
        fblDesNome: 'CONTROLLER',
        aprovador: 'COMPRAS',
        fbaDesNome: 'LIBERAR',
        usnDesNomeCmd: 'DANILO_LARA',
        ftbVldStatus: 2,
        ftbTimBloq: 1778753566000, // 2026-05-14 07:12:46 BRT
        ftbTimCmd: 1778838100000, // 2026-05-15 06:41:40 BRT
        ...over,
    });

    it('caso canônico do doc 4156 é CONCLUIDA, sem lacunas', () => {
        const r = resolver.resolver(etapaReal());

        expect(r.status).toBe(ETAPA_STATUS.CONCLUIDA);
        expect(r.lacunas).toEqual([]);
    });

    describe('status desconhecido — PV-01', () => {
        it('ftbVldStatus=7 vira INDETERMINADO, nunca CONCLUIDA', () => {
            const r = resolver.resolver(etapaReal({ ftbVldStatus: 7 }));

            expect(r.status).toBe(ETAPA_STATUS.INDETERMINADO);
            expect(r.lacunas).toContain(LACUNA.STATUS_ETAPA_DESCONHECIDO);
        });

        it('status ausente vira INDETERMINADO', () => {
            const r = resolver.resolver(etapaReal({ ftbVldStatus: null }));
            expect(r.status).toBe(ETAPA_STATUS.INDETERMINADO);
        });
    });

    describe('etapa pendente', () => {
        it('ftbVldStatus=1 é PENDENTE', () => {
            const r = resolver.resolver(
                etapaReal({ ftbVldStatus: 1, fbaDesNome: null, usnDesNomeCmd: null }),
            );

            expect(r.status).toBe(ETAPA_STATUS.PENDENTE);
            expect(r.lacunas).toContain(LACUNA.ETAPA_SEM_RESPONSAVEL);
        });
    });

    describe('ação — PV-02', () => {
        it('APROVAR também conclui a etapa', () => {
            const r = resolver.resolver(etapaReal({ fbaDesNome: 'APROVAR' }));
            expect(r.status).toBe(ETAPA_STATUS.CONCLUIDA);
        });

        it('respondido SEM ação registrada não vira aprovação', () => {
            const r = resolver.resolver(etapaReal({ fbaDesNome: null }));

            expect(r.status).toBe(ETAPA_STATUS.INDETERMINADO);
            expect(r.lacunas).toContain(LACUNA.ACAO_ETAPA_DESCONHECIDA);
        });

        it('ação desconhecida não vira aprovação', () => {
            const r = resolver.resolver(etapaReal({ fbaDesNome: 'ENCAMINHAR' }));

            expect(r.status).toBe(ETAPA_STATUS.INDETERMINADO);
            expect(r.lacunas).toContain(LACUNA.ACAO_ETAPA_DESCONHECIDA);
        });

        it('ação de recusa vira REJEITADA', () => {
            const r = resolver.resolver(etapaReal({ fbaDesNome: 'CANCELAR' }));
            expect(r.status).toBe(ETAPA_STATUS.REJEITADA);
        });

        it('normaliza caixa e espaços do rótulo', () => {
            const r = resolver.resolver(etapaReal({ fbaDesNome: '  liberar ' }));
            expect(r.status).toBe(ETAPA_STATUS.CONCLUIDA);
        });
    });

    it('timestamps invertidos mantêm o status mas registram lacuna', () => {
        const r = resolver.resolver(
            etapaReal({ ftbTimBloq: 1778838100000, ftbTimCmd: 1778753566000 }),
        );

        expect(r.status).toBe(ETAPA_STATUS.CONCLUIDA);
        expect(r.lacunas).toContain(LACUNA.TIMESTAMPS_INCONSISTENTES);
    });
});
