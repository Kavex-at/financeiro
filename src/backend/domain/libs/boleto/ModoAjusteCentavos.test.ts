import ModoAjusteCentavos, {
    type ConfiguracaoModoAjuste,
    MODO_AJUSTE,
} from './ModoAjusteCentavos.js';
import ModoPorFilial from './ModoPorFilial.js';

const cfg = (over: Partial<ConfiguracaoModoAjuste> = {}): ConfiguracaoModoAjuste => ({
    filiais: '1:on',
    loginSondado: 'MPS_FRANCINEI',
    conexosLogin: 'MPS_FRANCINEI',
    sispagLiveWriteEnabled: true,
    conexosWriteEnabled: true,
    conexosDryRun: false,
    processoServidor: true,
    ...over,
});

describe('ModoAjusteCentavos.resolverModoEfetivo (I18f/I18l/M3, ADR-0073)', () => {
    it('constantes tipadas off/shadow/on', () => {
        expect(MODO_AJUSTE).toEqual({ OFF: 'off', SHADOW: 'shadow', ON: 'on' });
    });

    it('tudo certo ⇒ on, sem aviso', () => {
        expect(ModoAjusteCentavos.resolverModoEfetivo(1, cfg())).toEqual({
            modo: MODO_AJUSTE.ON,
            avisos: [],
        });
    });

    it('default (vazio) ⇒ off em todas as filiais', () => {
        expect(ModoAjusteCentavos.resolverModoEfetivo(1, cfg({ filiais: '' })).modo).toBe('off');
        expect(ModoAjusteCentavos.resolverModoEfetivo(7, cfg({ filiais: '' })).modo).toBe('off');
    });

    it.each([
        ['on', 7, 'on'],
        ['1:shadow,7:off', 1, 'shadow'],
        ['1:shadow,7:off', 7, 'off'],
        ['1:shadow,7:off', 2, 'off'],
        ['on,1:off', 1, 'off'],
        ['on,1:off', 2, 'off'],
        ['1:ligado', 1, 'off'],
        ['lixo', 1, 'off'],
    ])('parse da I17k: %j filial %i ⇒ %s', (filiais, filCod, modo) => {
        expect(ModoAjusteCentavos.resolverModoEfetivo(filCod, cfg({ filiais })).modo).toBe(modo);
    });

    describe('M3: on exige o login sondado igual ao do servidor', () => {
        it('igualdade case-insensitive e com trim', () => {
            const r = ModoAjusteCentavos.resolverModoEfetivo(
                1,
                cfg({ loginSondado: '  mps_francinei ' }),
            );
            expect(r.modo).toBe('on');
        });

        it.each([
            ['ausente', ''],
            ['diferente', 'CLONEX'],
        ])('login sondado %s ⇒ shadow com aviso pt-BR', (_n, loginSondado) => {
            const r = ModoAjusteCentavos.resolverModoEfetivo(1, cfg({ loginSondado }));
            expect(r.modo).toBe('shadow');
            expect(r.avisos.join(' ')).toMatch(/login/);
        });

        it('credencial do servidor vazia ⇒ shadow', () => {
            const r = ModoAjusteCentavos.resolverModoEfetivo(1, cfg({ conexosLogin: '' }));
            expect(r.modo).toBe('shadow');
            expect(r.avisos.length).toBeGreaterThan(0);
        });
    });

    describe('kill-switches: nunca on (no máximo shadow)', () => {
        it.each<[string, Partial<ConfiguracaoModoAjuste>]>([
            ['sispagLiveWriteEnabled=false', { sispagLiveWriteEnabled: false }],
            ['conexosWriteEnabled=false', { conexosWriteEnabled: false }],
            ['conexosDryRun=true', { conexosDryRun: true }],
        ])('%s ⇒ shadow', (_n, over) => {
            const r = ModoAjusteCentavos.resolverModoEfetivo(1, cfg(over));
            expect(r.modo).toBe('shadow');
            expect(r.avisos.length).toBeGreaterThan(0);
        });

        it('kill-switch não promove off a shadow', () => {
            const r = ModoAjusteCentavos.resolverModoEfetivo(
                1,
                cfg({ filiais: '', conexosDryRun: true }),
            );
            expect(r.modo).toBe('off');
        });
    });

    it('caso canônico 12: fora do processo do servidor (job) ⇒ shadow com aviso', () => {
        const r = ModoAjusteCentavos.resolverModoEfetivo(1, cfg({ processoServidor: false }));
        expect(r.modo).toBe('shadow');
        expect(r.avisos.join(' ')).toMatch(/processo do servidor/);
    });

    it('shadow configurado continua shadow, sem exigir login sondado', () => {
        const r = ModoAjusteCentavos.resolverModoEfetivo(
            1,
            cfg({ filiais: '1:shadow', loginSondado: '' }),
        );
        expect(r).toEqual({ modo: 'shadow', avisos: [] });
    });

    it('usa o MESMO parser do vínculo (ModoPorFilial), sem duplicar', () => {
        const spy = jest.spyOn(ModoPorFilial, 'parse');
        ModoAjusteCentavos.resolverModoEfetivo(1, cfg());
        expect(spy).toHaveBeenCalledWith('1:on');
        spy.mockRestore();
    });
});
