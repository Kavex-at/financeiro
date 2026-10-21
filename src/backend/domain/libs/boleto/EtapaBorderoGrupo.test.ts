import EtapaBorderoGrupo, { ETAPA_BORDERO_GRUPO, type EtapaBordero } from './EtapaBorderoGrupo.js';

const E = ETAPA_BORDERO_GRUPO;

const caminho = (...etapas: EtapaBordero[]): void => {
    for (let i = 1; i < etapas.length; i += 1) {
        const de = etapas[i - 1] as EtapaBordero;
        const para = etapas[i] as EtapaBordero;
        expect(EtapaBorderoGrupo.transicionar(de, para)).toBe(para);
    }
};

describe('EtapaBorderoGrupo — ledger do borderô do grupo (I21l–q, I21s, ADR-0077)', () => {
    it('valores tipados são exatamente a lista da Task 4 (o CHECK da 0090 usa esta lista)', () => {
        expect(Object.values(E).sort()).toEqual(
            [
                'intencao_gravada',
                'bordero_criado',
                'baixas_gravadas',
                'bordero_conferido',
                'importado',
                'codbar_vinculado',
                'concluido',
                'reaproveitado',
                'retirado',
                'limpo',
                'limpeza_pendente',
                'indeterminado',
                'failed',
                'simulado',
            ].sort(),
        );
        expect(EtapaBorderoGrupo.todas()).toEqual(Object.values(E));
    });

    it('caminho feliz: intenção (t0) → borderô → baixas → conferido → importado → codbar → concluído', () => {
        caminho(
            E.INTENCAO_GRAVADA,
            E.BORDERO_CRIADO,
            E.BAIXAS_GRAVADAS,
            E.BORDERO_CONFERIDO,
            E.IMPORTADO,
            E.CODBAR_VINCULADO,
            E.CONCLUIDO,
        );
    });

    it('reaproveitamento (I21s, PI-9): adota o borCod antigo, confere e importa sem criar outro', () => {
        caminho(
            E.INTENCAO_GRAVADA,
            E.REAPROVEITADO,
            E.BORDERO_CONFERIDO,
            E.IMPORTADO,
            E.CODBAR_VINCULADO,
            E.CONCLUIDO,
        );
        expect(EtapaBorderoGrupo.podeTransicionar(E.REAPROVEITADO, E.BORDERO_CRIADO)).toBe(false);
        expect(EtapaBorderoGrupo.podeTransicionar(E.REAPROVEITADO, E.BAIXAS_GRAVADAS)).toBe(false);
    });

    it('dry-run: a intenção vai a simulado e para', () => {
        caminho(E.INTENCAO_GRAVADA, E.SIMULADO);
        expect(EtapaBorderoGrupo.ehTerminal(E.SIMULADO)).toBe(true);
    });

    it('I21p(2): falha transitória vira failed (não terminal) e a retomada segue de onde parou', () => {
        for (const de of [
            E.INTENCAO_GRAVADA,
            E.BORDERO_CRIADO,
            E.BAIXAS_GRAVADAS,
            E.BORDERO_CONFERIDO,
            E.IMPORTADO,
            E.CODBAR_VINCULADO,
            E.REAPROVEITADO,
        ]) {
            expect(EtapaBorderoGrupo.podeTransicionar(de, E.FAILED)).toBe(true);
        }
        expect(EtapaBorderoGrupo.ehTerminal(E.FAILED)).toBe(false);
        for (const para of [
            E.BORDERO_CRIADO,
            E.BAIXAS_GRAVADAS,
            E.BORDERO_CONFERIDO,
            E.IMPORTADO,
            E.CODBAR_VINCULADO,
            E.CONCLUIDO,
            E.REAPROVEITADO,
            E.RETIRADO,
            E.INDETERMINADO,
        ]) {
            expect(EtapaBorderoGrupo.podeTransicionar(E.FAILED, para)).toBe(true);
        }
        // A retomada nunca volta a gravar a intenção (o write-ahead é um só).
        expect(EtapaBorderoGrupo.podeTransicionar(E.FAILED, E.INTENCAO_GRAVADA)).toBe(false);
    });

    it('I21p(3) + I21q: falha determinística ⇒ retirado ⇒ limpo ou limpeza_pendente', () => {
        caminho(E.INTENCAO_GRAVADA, E.BORDERO_CRIADO, E.BAIXAS_GRAVADAS, E.RETIRADO, E.LIMPO);
        caminho(E.IMPORTADO, E.RETIRADO, E.LIMPEZA_PENDENTE);
        // Borderô antigo não resolvido (I21s): retirada antes de criar qualquer coisa.
        caminho(E.INTENCAO_GRAVADA, E.RETIRADO);
    });

    it('G3: lote local cancelado depois da preparação concluída ⇒ limpeza depois do commit', () => {
        caminho(E.CONCLUIDO, E.LIMPO);
        caminho(E.CONCLUIDO, E.LIMPEZA_PENDENTE);
    });

    it('janela de identidade ambígua (dois borderôs) ou borderô finalizado por fora ⇒ indeterminado', () => {
        caminho(E.INTENCAO_GRAVADA, E.INDETERMINADO);
        caminho(E.BAIXAS_GRAVADAS, E.INDETERMINADO);
    });

    it('transição inválida lança (nunca é estado a gravar)', () => {
        expect(() => EtapaBorderoGrupo.transicionar(E.INTENCAO_GRAVADA, E.IMPORTADO)).toThrow(
            /transição inválida do borderô do grupo: intencao_gravada → importado/,
        );
        expect(() => EtapaBorderoGrupo.transicionar(E.BORDERO_CRIADO, E.CONCLUIDO)).toThrow();
        expect(() => EtapaBorderoGrupo.transicionar(E.CONCLUIDO, E.IMPORTADO)).toThrow();
    });

    it('terminais (liberam o "uma execução não terminal por grupo"): concluído, retirado, limpo, limpeza_pendente, indeterminado, simulado', () => {
        const terminais = Object.values(E).filter((e) => EtapaBorderoGrupo.ehTerminal(e));
        expect(new Set(terminais)).toEqual(
            new Set([
                E.CONCLUIDO,
                E.RETIRADO,
                E.LIMPO,
                E.LIMPEZA_PENDENTE,
                E.INDETERMINADO,
                E.SIMULADO,
            ]),
        );
    });

    it('finais não saem para lugar nenhum; concluído e retirado só saem para a limpeza', () => {
        const finais = [E.LIMPO, E.LIMPEZA_PENDENTE, E.INDETERMINADO, E.SIMULADO];
        for (const f of finais) {
            for (const para of Object.values(E)) {
                expect(EtapaBorderoGrupo.podeTransicionar(f, para)).toBe(false);
            }
        }
        for (const t of [E.CONCLUIDO, E.RETIRADO]) {
            const saidas = Object.values(E).filter((p) => EtapaBorderoGrupo.podeTransicionar(t, p));
            expect(new Set(saidas)).toEqual(new Set([E.LIMPO, E.LIMPEZA_PENDENTE]));
        }
    });
});

describe('EtapaBorderoGrupo.podeLimpar — I21q (decisão do maintainer 2026-10-21)', () => {
    const pode = { loteNativoFinalizado: false, remessaGerada: false, reaproveitado: false };

    it.each([
        E.INTENCAO_GRAVADA,
        E.BORDERO_CRIADO,
        E.BAIXAS_GRAVADAS,
        E.BORDERO_CONFERIDO,
        E.IMPORTADO,
        E.CODBAR_VINCULADO,
        E.CONCLUIDO,
        E.FAILED,
        E.RETIRADO,
    ])('%s com lote nativo aberto, sem .REM, borderô nosso ⇒ pode', (etapa) => {
        expect(EtapaBorderoGrupo.podeLimpar(etapa, pode)).toBe(true);
    });

    it('lote nativo finalizado ⇒ nunca (Alerta)', () => {
        expect(
            EtapaBorderoGrupo.podeLimpar(E.CODBAR_VINCULADO, {
                ...pode,
                loteNativoFinalizado: true,
            }),
        ).toBe(false);
    });

    it('.REM gerado ⇒ nunca (Alerta)', () => {
        expect(EtapaBorderoGrupo.podeLimpar(E.CONCLUIDO, { ...pode, remessaGerada: true })).toBe(
            false,
        );
    });

    it('estado do lote nativo não lido ⇒ nunca (fail-closed)', () => {
        const { loteNativoFinalizado: _f, ...semFinalizado } = pode;
        const { remessaGerada: _r, ...semRemessa } = pode;
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, semFinalizado)).toBe(false);
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, semRemessa)).toBe(false);
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, { reaproveitado: false })).toBe(false);
    });

    it('vldHasRemessaPgto não é guarda: é 1 enquanto o item está no lote e a limpeza o tira antes', () => {
        // A flag nem entra no contexto: a assinatura aceita só o estado do lote nativo.
        const ctx = { ...pode, vldHasRemessaPgto: 1 } as Parameters<
            typeof EtapaBorderoGrupo.podeLimpar
        >[1];
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, ctx)).toBe(true);
    });

    it('borderô reaproveitado (de um J rejeitado) ⇒ nunca: só o item nativo sai', () => {
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, { ...pode, reaproveitado: true })).toBe(
            false,
        );
        expect(EtapaBorderoGrupo.podeLimpar(E.REAPROVEITADO, pode)).toBe(false);
    });

    it.each([
        E.LIMPO,
        E.LIMPEZA_PENDENTE,
        E.INDETERMINADO,
        E.SIMULADO,
    ])('%s ⇒ nunca (já limpo, entregue à analista ou nada escrito)', (etapa) => {
        expect(EtapaBorderoGrupo.podeLimpar(etapa, pode)).toBe(false);
    });
});
