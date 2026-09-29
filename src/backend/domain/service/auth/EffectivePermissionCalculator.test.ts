import 'reflect-metadata';
import {
    EXCEPTION_EFFECT,
    PERMISSION,
    PERMISSION_CATALOG,
    type PermissionException,
} from '../../interface/auth/Permission.js';
import EffectivePermissionCalculator from './EffectivePermissionCalculator.js';

const calc = new EffectivePermissionCalculator();

const conceder = (permissao: string): PermissionException => ({
    permissao,
    efeito: EXCEPTION_EFFECT.CONCEDER,
});
const revogar = (permissao: string): PermissionException => ({
    permissao,
    efeito: EXCEPTION_EFFECT.REVOGAR,
});

/** O conjunto como array ordenado, para `toEqual` legível. */
const efetivas = (pacote: string[], excecoes: PermissionException[] = []): string[] =>
    [...calc.calcular(pacote, excecoes).permissoes].sort();

describe('catálogo de permissões', () => {
    it('tem exatamente as permissões decididas (nove da entrevista + a do ADR-0054 D10; mudar o catálogo exige mudar este teste)', () => {
        expect([...PERMISSION_CATALOG].sort()).toEqual(
            [
                'metricas:ver',
                'operacao:ver',
                'permutas:executar',
                'permutas:ver',
                'recebimentos:executar',
                'recebimentos:ver',
                'sispag:aprovar_destino',
                'sispag:executar',
                'sispag:ver',
                'usuarios:gerenciar',
            ].sort(),
        );
    });

    it('as constantes nomeadas são o próprio catálogo, sem sobra', () => {
        expect(new Set(Object.values(PERMISSION))).toEqual(new Set(PERMISSION_CATALOG));
    });
});

describe('EffectivePermissionCalculator.calcular — fecho(pacote ∪ concedidas) − revogadas', () => {
    it('pacote vazio e nenhuma exceção: vazio', () => {
        expect(efetivas([])).toEqual([]);
    });

    it('sispag:executar no pacote implica sispag:ver (I7)', () => {
        expect(efetivas(['sispag:executar'])).toEqual(['sispag:executar', 'sispag:ver']);
    });

    it('conceder permutas:executar dá também permutas:ver', () => {
        expect(efetivas([], [conceder('permutas:executar')])).toEqual([
            'permutas:executar',
            'permutas:ver',
        ]);
    });

    it('revogar sispag:executar com sispag:ver no pacote: fica só sispag:ver', () => {
        expect(efetivas(['sispag:ver', 'sispag:executar'], [revogar('sispag:executar')])).toEqual([
            'sispag:ver',
        ]);
    });

    it('revogar sispag:ver com sispag:executar no pacote: perde as duas', () => {
        expect(efetivas(['sispag:executar'], [revogar('sispag:ver')])).toEqual([]);
    });

    it('revogar vence: o pacote tem e a exceção revoga', () => {
        expect(efetivas(['metricas:ver'], [revogar('metricas:ver')])).toEqual([]);
    });

    it('revogar vence mesmo se a mesma permissão vier concedida e revogada', () => {
        expect(efetivas([], [conceder('operacao:ver'), revogar('operacao:ver')])).toEqual([]);
    });

    it('Administrador (as nove) sem exceções: as nove', () => {
        expect(efetivas([...PERMISSION_CATALOG])).toEqual([...PERMISSION_CATALOG].sort());
    });

    it('concedida soma ao pacote sem tirar nada', () => {
        expect(efetivas(['metricas:ver'], [conceder('usuarios:gerenciar')])).toEqual([
            'metricas:ver',
            'usuarios:gerenciar',
        ]);
    });

    describe('valor fora do catálogo (R4)', () => {
        it('no pacote: ignorado e reportado, nunca lança', () => {
            const out = calc.calcular(['permutas:ver', 'fiscal:ver'], []);
            expect([...out.permissoes]).toEqual(['permutas:ver']);
            expect(out.ignoradas).toEqual(['fiscal:ver']);
        });

        it('em exceção (qualquer efeito) e efeito desconhecido: ignorados e reportados', () => {
            const out = calc.calcular(
                ['metricas:ver'],
                [
                    conceder('fiscal:executar'),
                    revogar('legado:ver'),
                    { permissao: 'metricas:ver', efeito: 'talvez' },
                ],
            );
            expect([...out.permissoes]).toEqual(['metricas:ver']);
            expect(out.ignoradas).toEqual(['fiscal:executar', 'legado:ver', 'metricas:ver:talvez']);
        });

        it('sem nada fora do catálogo: ignoradas vazia', () => {
            expect(calc.calcular(['sispag:ver'], [conceder('sispag:executar')]).ignoradas).toEqual(
                [],
            );
        });
    });

    it('tem(): consulta sobre o resultado, sem recalcular a regra no chamador', () => {
        const { permissoes } = calc.calcular(['recebimentos:executar'], []);
        expect(calc.tem(permissoes, PERMISSION.RECEBIMENTOS_VER)).toBe(true);
        expect(calc.tem(permissoes, PERMISSION.USUARIOS_GERENCIAR)).toBe(false);
    });
});
