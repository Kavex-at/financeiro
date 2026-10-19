import EtapaAjusteCentavos, { ETAPA_AJUSTE, type EtapaAjuste } from './EtapaAjusteCentavos.js';

const E = ETAPA_AJUSTE;

describe('EtapaAjusteCentavos — máquina do ledger (I18h, ADR-0073)', () => {
    it('caminho feliz completo é uma sequência de transições válidas', () => {
        const caminho: EtapaAjuste[] = [
            E.PENDENTE,
            E.RENEGOCIACAO_CRIADA,
            E.TITULO_INCLUIDO,
            E.COMPOSICAO_GRAVADA,
            E.AJUSTE_APLICADO,
            E.FINALIZADA,
            E.LIBERADA,
            E.RECHAVEADA,
            E.CONCLUIDO,
        ];
        for (let i = 1; i < caminho.length; i += 1) {
            const de = caminho[i - 1] as EtapaAjuste;
            const para = caminho[i] as EtapaAjuste;
            expect(EtapaAjusteCentavos.transicionar(de, para)).toBe(para);
        }
    });

    it.each([E.LIBERADA, E.SEM_BLOQUEIO])('finalizada → %s → rechaveada', (meio) => {
        expect(EtapaAjusteCentavos.podeTransicionar(E.FINALIZADA, meio)).toBe(true);
        expect(EtapaAjusteCentavos.podeTransicionar(meio, E.RECHAVEADA)).toBe(true);
    });

    it('aprovação manual: a decisão segue o título novo e o ledger termina aguardando', () => {
        expect(EtapaAjusteCentavos.podeTransicionar(E.FINALIZADA, E.RECHAVEADA)).toBe(true);
        expect(
            EtapaAjusteCentavos.podeTransicionar(E.RECHAVEADA, E.AGUARDANDO_APROVACAO_MANUAL),
        ).toBe(true);
        expect(EtapaAjusteCentavos.podeTransicionar(E.RECHAVEADA, E.CONCLUIDO_SEM_DECISAO)).toBe(
            true,
        );
    });

    it('terminais são exatamente os sete da I18h', () => {
        const terminais = Object.values(E).filter((e) => EtapaAjusteCentavos.ehTerminal(e));
        expect(new Set(terminais)).toEqual(
            new Set([
                E.CONCLUIDO,
                E.CONCLUIDO_SEM_DECISAO,
                E.AGUARDANDO_APROVACAO_MANUAL,
                E.CANCELADO,
                E.RECUSADO,
                E.INDETERMINADO,
                E.SIMULADO,
            ]),
        );
    });

    it('terminal não sai para lugar nenhum', () => {
        for (const t of Object.values(E).filter((e) => EtapaAjusteCentavos.ehTerminal(e))) {
            for (const para of Object.values(E)) {
                expect(EtapaAjusteCentavos.podeTransicionar(t, para)).toBe(false);
            }
        }
    });

    it('antesDoFinalizar só até ajuste_aplicado', () => {
        const antes = Object.values(E).filter((e) => EtapaAjusteCentavos.antesDoFinalizar(e));
        expect(new Set(antes)).toEqual(
            new Set([
                E.PENDENTE,
                E.RENEGOCIACAO_CRIADA,
                E.TITULO_INCLUIDO,
                E.COMPOSICAO_GRAVADA,
                E.AJUSTE_APLICADO,
            ]),
        );
    });

    it('antes do finalizar, toda etapa pode ir a cancelado ou indeterminado; depois, nunca a cancelado', () => {
        for (const e of [
            E.RENEGOCIACAO_CRIADA,
            E.TITULO_INCLUIDO,
            E.COMPOSICAO_GRAVADA,
            E.AJUSTE_APLICADO,
        ]) {
            expect(EtapaAjusteCentavos.podeTransicionar(e, E.CANCELADO)).toBe(true);
            expect(EtapaAjusteCentavos.podeTransicionar(e, E.INDETERMINADO)).toBe(true);
        }
        for (const e of [E.FINALIZADA, E.LIBERADA, E.SEM_BLOQUEIO, E.RECHAVEADA]) {
            expect(EtapaAjusteCentavos.podeTransicionar(e, E.CANCELADO)).toBe(false);
        }
    });

    it('pendente pode ir a recusado (inelegível) e a simulado (shadow)', () => {
        expect(EtapaAjusteCentavos.podeTransicionar(E.PENDENTE, E.RECUSADO)).toBe(true);
        expect(EtapaAjusteCentavos.podeTransicionar(E.PENDENTE, E.SIMULADO)).toBe(true);
    });

    it('transição inválida lança (pular etapa, voltar, sair de terminal)', () => {
        expect(() => EtapaAjusteCentavos.transicionar(E.PENDENTE, E.FINALIZADA)).toThrow(
            /pendente → finalizada/,
        );
        expect(() => EtapaAjusteCentavos.transicionar(E.FINALIZADA, E.PENDENTE)).toThrow();
        expect(() => EtapaAjusteCentavos.transicionar(E.CONCLUIDO, E.RECHAVEADA)).toThrow();
    });

    it('etapas são os valores do CHECK da migration 0087 (snake_case)', () => {
        for (const e of Object.values(E)) expect(e).toMatch(/^[a-z_]+$/);
    });
});
