import EtapaBorderoGrupo, { ETAPA_BORDERO_GRUPO, type EtapaBordero } from './EtapaBorderoGrupo.js';

const E = ETAPA_BORDERO_GRUPO;

const caminho = (...etapas: EtapaBordero[]): void => {
    for (let i = 1; i < etapas.length; i += 1) {
        const de = etapas[i - 1] as EtapaBordero;
        const para = etapas[i] as EtapaBordero;
        expect(EtapaBorderoGrupo.transicionar(de, para)).toBe(para);
    }
};

describe('EtapaBorderoGrupo — ledger do borderô do grupo (I19l–q, I19s, ADR-0076)', () => {
    it('valores tipados são exatamente a lista da Task 4 (o CHECK da 0089 usa esta lista)', () => {
        expect(Object.values(E).sort()).toEqual(
            [
                'marcador_gravado',
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

    it('caminho feliz: marcador → borderô → baixas → conferido → importado → codbar → concluído', () => {
        caminho(
            E.MARCADOR_GRAVADO,
            E.BORDERO_CRIADO,
            E.BAIXAS_GRAVADAS,
            E.BORDERO_CONFERIDO,
            E.IMPORTADO,
            E.CODBAR_VINCULADO,
            E.CONCLUIDO,
        );
    });

    it('reaproveitamento (I19s, PI-9): adota o borCod antigo, confere e importa sem criar outro', () => {
        caminho(
            E.MARCADOR_GRAVADO,
            E.REAPROVEITADO,
            E.BORDERO_CONFERIDO,
            E.IMPORTADO,
            E.CODBAR_VINCULADO,
            E.CONCLUIDO,
        );
        expect(EtapaBorderoGrupo.podeTransicionar(E.REAPROVEITADO, E.BORDERO_CRIADO)).toBe(false);
        expect(EtapaBorderoGrupo.podeTransicionar(E.REAPROVEITADO, E.BAIXAS_GRAVADAS)).toBe(false);
    });

    it('dry-run: o marcador vai a simulado e para', () => {
        caminho(E.MARCADOR_GRAVADO, E.SIMULADO);
        expect(EtapaBorderoGrupo.ehTerminal(E.SIMULADO)).toBe(true);
    });

    it('I19p(2): falha transitória vira failed (não terminal) e a retomada segue de onde parou', () => {
        for (const de of [
            E.MARCADOR_GRAVADO,
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
        // A retomada nunca volta a gravar o marcador (o write-ahead é um só).
        expect(EtapaBorderoGrupo.podeTransicionar(E.FAILED, E.MARCADOR_GRAVADO)).toBe(false);
    });

    it('I19p(3) + I19q: falha determinística ⇒ retirado ⇒ limpo ou limpeza_pendente', () => {
        caminho(E.MARCADOR_GRAVADO, E.BORDERO_CRIADO, E.BAIXAS_GRAVADAS, E.RETIRADO, E.LIMPO);
        caminho(E.IMPORTADO, E.RETIRADO, E.LIMPEZA_PENDENTE);
        // Borderô antigo não resolvido (I19s): retirada antes de criar qualquer coisa.
        caminho(E.MARCADOR_GRAVADO, E.RETIRADO);
    });

    it('G3: lote local cancelado depois da preparação concluída ⇒ limpeza depois do commit', () => {
        caminho(E.CONCLUIDO, E.LIMPO);
        caminho(E.CONCLUIDO, E.LIMPEZA_PENDENTE);
    });

    it('marcador ambíguo (dois borderôs) ou borderô finalizado por fora ⇒ indeterminado', () => {
        caminho(E.MARCADOR_GRAVADO, E.INDETERMINADO);
        caminho(E.BAIXAS_GRAVADAS, E.INDETERMINADO);
    });

    it('transição inválida lança (nunca é estado a gravar)', () => {
        expect(() => EtapaBorderoGrupo.transicionar(E.MARCADOR_GRAVADO, E.IMPORTADO)).toThrow(
            /transição inválida do borderô do grupo: marcador_gravado → importado/,
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

describe('EtapaBorderoGrupo.podeLimpar — I19q', () => {
    const pode = { vldHasRemessaPgto: 0, loteNativoFinalizado: false, reaproveitado: false };

    it.each([
        E.MARCADOR_GRAVADO,
        E.BORDERO_CRIADO,
        E.BAIXAS_GRAVADAS,
        E.BORDERO_CONFERIDO,
        E.IMPORTADO,
        E.CODBAR_VINCULADO,
        E.CONCLUIDO,
        E.FAILED,
        E.RETIRADO,
    ])('%s com vldHasRemessaPgto = 0, lote nativo aberto, borderô nosso ⇒ pode', (etapa) => {
        expect(EtapaBorderoGrupo.podeLimpar(etapa, pode)).toBe(true);
    });

    it('vldHasRemessaPgto = 1 ⇒ nunca (Alerta)', () => {
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, { ...pode, vldHasRemessaPgto: 1 })).toBe(
            false,
        );
    });

    it('vldHasRemessaPgto não lido ⇒ nunca (fail-closed)', () => {
        const { vldHasRemessaPgto: _omitido, ...semFlag } = pode;
        expect(EtapaBorderoGrupo.podeLimpar(E.IMPORTADO, semFlag)).toBe(false);
    });

    it('lote nativo finalizado ⇒ nunca', () => {
        expect(
            EtapaBorderoGrupo.podeLimpar(E.CODBAR_VINCULADO, {
                ...pode,
                loteNativoFinalizado: true,
            }),
        ).toBe(false);
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
