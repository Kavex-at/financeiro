import ModoAjusteCentavos, {
    type ConfiguracaoModoAjuste,
    MODO_AJUSTE,
} from './ModoAjusteCentavos.js';

const cfg = (over: Partial<ConfiguracaoModoAjuste> = {}): ConfiguracaoModoAjuste => ({
    conexosLogin: 'MPS_FRANCINEI',
    sispagLiveWriteEnabled: true,
    conexosWriteEnabled: true,
    conexosDryRun: false,
    processoServidor: true,
    ...over,
});

describe('ModoAjusteCentavos.resolverModoEfetivo (I18f/I18l, ADR-0073 emenda 2026-10-20)', () => {
    it('constantes tipadas shadow/on (sem off: não há flag dedicada)', () => {
        expect(MODO_AJUSTE).toEqual({ SHADOW: 'shadow', ON: 'on' });
    });

    it('servidor + credencial + kill-switches ligados ⇒ on, sem aviso (ativo por padrão)', () => {
        expect(ModoAjusteCentavos.resolverModoEfetivo(cfg())).toEqual({
            modo: MODO_AJUSTE.ON,
            avisos: [],
        });
    });

    it('não depende de login sondado: qualquer credencial do servidor serve', () => {
        expect(ModoAjusteCentavos.resolverModoEfetivo(cfg({ conexosLogin: 'CLONEX' })).modo).toBe(
            'on',
        );
    });

    it.each(['', '   '])('credencial do servidor vazia (%j) ⇒ shadow com aviso', (conexosLogin) => {
        const r = ModoAjusteCentavos.resolverModoEfetivo(cfg({ conexosLogin }));
        expect(r.modo).toBe('shadow');
        expect(r.avisos.join(' ')).toMatch(/credencial/);
    });

    describe('kill-switches: nunca on (no máximo shadow)', () => {
        it.each<[string, Partial<ConfiguracaoModoAjuste>, RegExp]>([
            [
                'sispagLiveWriteEnabled=false',
                { sispagLiveWriteEnabled: false },
                /SISPAG_LIVE_WRITE_ENABLED/,
            ],
            ['conexosWriteEnabled=false', { conexosWriteEnabled: false }, /escrita no Conexos/],
            ['conexosDryRun=true', { conexosDryRun: true }, /CONEXOS_DRY_RUN/],
        ])('%s ⇒ shadow', (_n, over, aviso) => {
            const r = ModoAjusteCentavos.resolverModoEfetivo(cfg(over));
            expect(r.modo).toBe('shadow');
            expect(r.avisos.join(' ')).toMatch(aviso);
        });
    });

    it('caso canônico 12: fora do processo do servidor (job) ⇒ shadow com aviso', () => {
        const r = ModoAjusteCentavos.resolverModoEfetivo(cfg({ processoServidor: false }));
        expect(r.modo).toBe('shadow');
        expect(r.avisos.join(' ')).toMatch(/processo do servidor/);
    });

    it('acumula todos os motivos', () => {
        const r = ModoAjusteCentavos.resolverModoEfetivo(
            cfg({ processoServidor: false, sispagLiveWriteEnabled: false, conexosDryRun: true }),
        );
        expect(r.modo).toBe('shadow');
        expect(r.avisos).toHaveLength(3);
    });
});
