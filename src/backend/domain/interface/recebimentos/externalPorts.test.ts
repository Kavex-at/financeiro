import 'reflect-metadata';
import {
    ERP_WRITE_TIMEOUT_MS,
    NDE_EMIT_TIMEOUT_MS,
    NEXXERA_FETCH_TIMEOUT_MS,
} from './constants.js';
import ErpReceivablesGatewayStub from '../../service/recebimentos/stubs/ErpReceivablesGatewayStub.js';
import NdeEmitterStub from '../../service/recebimentos/stubs/NdeEmitterStub.js';
import NexxeraGatewayStub from '../../service/recebimentos/stubs/NexxeraGatewayStub.js';
import { buildRecebimento } from './__fixtures__/recebimento.fixture.js';

/**
 * Regis availability-2 / performance-2 — every external port carries an OPTIONAL `timeoutMs` so the
 * real adapter is forced to decide a latency ceiling. The default lives in `constants.ts`. These
 * assertions lock the contract in (a signature change that drops the option breaks compilation + this).
 */
describe('external ports honour ExternalCallOptions (timeoutMs)', () => {
    it('declares non-zero default timeouts for the 3 external ports', () => {
        expect(NEXXERA_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
        expect(ERP_WRITE_TIMEOUT_MS).toBeGreaterThan(0);
        expect(NDE_EMIT_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('NexxeraGatewayStub.fetch accepts a timeoutMs option', async () => {
        await expect(
            new NexxeraGatewayStub().fetch(
                { de: new Date(), ate: new Date() },
                { timeoutMs: NEXXERA_FETCH_TIMEOUT_MS },
            ),
        ).resolves.toEqual([]);
    });

    it('ErpReceivablesGatewayStub.criarBordero/gravarBaixa accept a timeoutMs option', async () => {
        const erp = new ErpReceivablesGatewayStub();
        await expect(
            erp.criarBordero(
                {
                    filCod: 4,
                    borVldTipo: 2,
                    contaDestino: '55795-4',
                    valor: 1,
                    correlationId: 'c',
                    dryRun: true,
                },
                { timeoutMs: ERP_WRITE_TIMEOUT_MS },
            ),
        ).resolves.toMatchObject({ borCod: 999000 });
    });

    it('NdeEmitterStub.emitir accepts a timeoutMs option', async () => {
        await expect(
            new NdeEmitterStub().emitir(buildRecebimento(), { timeoutMs: NDE_EMIT_TIMEOUT_MS }),
        ).resolves.toMatchObject({ recebimentoId: expect.any(String) });
    });
});
