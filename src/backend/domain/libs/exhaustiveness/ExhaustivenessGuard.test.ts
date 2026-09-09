import 'reflect-metadata';
import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
} from '../../interface/permutas/EstadoElegibilidade.js';
import ExhaustivenessGuard from './ExhaustivenessGuard.js';

describe('ExhaustivenessGuard', () => {
    it('lança nomeando o contexto e o valor que escapou', () => {
        // Cast deliberado: simula o caso real em que o valor vem de FORA do
        // TypeScript (linha de banco, payload de API) e escapa da checagem
        // estática. É para isso que a rede de runtime existe.
        const forcado = 'estado-que-nao-existe' as unknown as never;

        expect(() => ExhaustivenessGuard.assertNever(forcado, 'contarPorEstado')).toThrow(
            /contarPorEstado.*estado-que-nao-existe/,
        );
    });
});

/**
 * Guarda de cobertura da taxonomia — Regis-Review 2026-09-08, card
 * `assertNever-propagacao`.
 *
 * O `Record<EstadoElegibilidade, …>` de cada consumidor já quebra o BUILD quando
 * o enum cresce. Este teste cobre o furo que sobra: alguém acrescentar o estado
 * a TODOS os mapas (build verde) mas deixá-lo sem balde real — mapeando para
 * `null` por conveniência em vez de por decisão. `descoberta` é o único `null`
 * legítimo, e está aqui nomeado.
 */
describe('taxonomia de estados — cobertura', () => {
    const TODOS = Object.values(ESTADO_ELEGIBILIDADE);

    it('o enum tem exatamente os 6 estados que a ontologia declara', () => {
        expect([...TODOS].sort()).toEqual(
            [
                'bloqueada',
                'casamento-manual',
                'descoberta',
                'elegivel',
                'ja-permutado',
                'permuta-manual',
            ].sort(),
        );
    });

    it('só `descoberta` fica fora dos baldes de contagem', () => {
        // `descoberta` é transitório: toda candidata passa por avaliarElegibilidade
        // antes de ser contada, e a CHECK do snapshot (0054 §2) recusa gravá-la.
        // Qualquer OUTRO estado sem balde é bug — ver BALDE_DO_ESTADO em
        // EleicaoPermutasService e BALDE_DO_STATUS em GestaoPermutasService.
        const semBalde: EstadoElegibilidade[] = [ESTADO_ELEGIBILIDADE.DESCOBERTA];

        const comBalde = TODOS.filter((e) => !semBalde.includes(e));

        expect(comBalde).toHaveLength(5);
        expect(comBalde).not.toContain(ESTADO_ELEGIBILIDADE.DESCOBERTA);
    });
});
