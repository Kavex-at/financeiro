import 'reflect-metadata';
import type { ConexosService } from '../../services/conexos.js';
import { conexosRequestContext } from '../libs/requestContext/ConexosRequestContext.js';
import ConexosIdentityProvider from './ConexosIdentityProvider.js';

const sessionWithUsnCod = (usnCod: string | null) =>
    ({ getCapturedUsnCod: () => usnCod }) as unknown as ConexosService;

describe('ConexosIdentityProvider', () => {
    const provider = new ConexosIdentityProvider();

    it('fora de request → undefined (o ledger grava NULL = "não capturada", nunca "robô")', () => {
        expect(provider.current()).toBeUndefined();
        expect(provider.currentParams()).toEqual({ conexosUsername: null, conexosUsnCod: null });
    });

    it('dentro de request sem identidade publicada → undefined', () => {
        conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, () => {
            expect(provider.current()).toBeUndefined();
        });
    });

    it('lê o usnCod da sessão VIVA, não de um snapshot da publicação', () => {
        // No write-ahead a sessão pode não ter logado ainda (usnCod null); no markSettled já
        // logou. Por isso o usnCod sai de `state.resolved` na hora da LEITURA.
        const session = { getCapturedUsnCod: () => null as string | null } as unknown as {
            getCapturedUsnCod: () => string | null;
        };
        conexosRequestContext.run(
            {
                platformUsername: 's@kavex.com',
                identity: { conexosUsername: 'SIMONE_PEREIRA', viaRobo: false },
                resolved: session as unknown as ConexosService,
            },
            () => {
                expect(provider.current()).toEqual({
                    conexosUsername: 'SIMONE_PEREIRA',
                    viaRobo: false,
                });

                session.getCapturedUsnCod = () => '14';

                expect(provider.current()).toEqual({
                    conexosUsername: 'SIMONE_PEREIRA',
                    viaRobo: false,
                    usnCod: '14',
                });
                expect(provider.currentParams()).toEqual({
                    conexosUsername: 'SIMONE_PEREIRA',
                    conexosUsnCod: '14',
                });
            },
        );
    });

    it('identidade do robô é gravada PELO NOME — nunca confundida com ausência', () => {
        conexosRequestContext.run(
            {
                platformUsername: 'm@kavex.com',
                identity: { conexosUsername: 'MPS_ROBO', viaRobo: true },
                resolved: sessionWithUsnCod('97'),
            },
            () => {
                expect(provider.currentParams()).toEqual({
                    conexosUsername: 'MPS_ROBO',
                    conexosUsnCod: '97',
                });
            },
        );
    });
});
