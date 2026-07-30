import 'reflect-metadata';
import type ConexosNdeClient from '../../client/ConexosNdeClient.js';
import VldTpNfDesconhecidoError from '../../errors/VldTpNfDesconhecidoError.js';
import HomologacaoRejeitadaError from '../../errors/HomologacaoRejeitadaError.js';
import { buildRecebimento } from '../../interface/recebimentos/__fixtures__/recebimento.fixture.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ContingenciaDecider from './ContingenciaDecider.js';
import ConexosNdeEmitter from './ConexosNdeEmitter.js';

const logStub = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), success: jest.fn() } as never;

const buildEnv = (conexosWriteEnabled: boolean, conexosDryRun: boolean): EnvironmentProvider =>
    ({
        getEnvironmentVars: jest.fn().mockResolvedValue({ conexosWriteEnabled, conexosDryRun }),
    }) as never;

const buildClient = (impl?: Partial<ConexosNdeClient>): ConexosNdeClient =>
    ({
        homologar: jest.fn().mockResolvedValue({
            docVldComvalidacoes: 1,
            avisoValidacoesPendentes: false,
            numeroNde: 'NDE-777',
            erpResponse: { ok: true },
        }),
        ...impl,
    }) as never;

const buildEmitter = (env: EnvironmentProvider, client: ConexosNdeClient): ConexosNdeEmitter =>
    new ConexosNdeEmitter(env, new ContingenciaDecider(), client, logStub);

describe('ConexosNdeEmitter.emitir — real NdeEmitterInterface adapter over com297 homologation', () => {
    afterEach(() => jest.clearAllMocks());

    it('sem emissaoNde → pendente (fallback idêntico ao stub; NÃO toca o ERP nem o env)', async () => {
        const env = buildEnv(true, false);
        const client = buildClient();
        const nde = await buildEmitter(env, client).emitir(buildRecebimento());
        expect(nde.statusEmissao).toBe('pendente');
        expect(nde.idempotencyKey).toBe('nde:rec-0001');
        expect(client.homologar).not.toHaveBeenCalled();
        expect(env.getEnvironmentVars).not.toHaveBeenCalled();
    });

    it('emissaoNde + escrita DESLIGADA → pendente (rota decidida, mas nada é enviado)', async () => {
        const env = buildEnv(false, true);
        const client = buildClient();
        const rec = buildRecebimento({ emissaoNde: { com297DocCod: 'DOC-9001', vldTpNf: '11' } });
        const nde = await buildEmitter(env, client).emitir(rec);
        expect(nde.statusEmissao).toBe('pendente');
        expect(nde.erpResponse).toMatchObject({ dryRun: true, verbo: 'homologaNfeContingencia' });
        expect(client.homologar).not.toHaveBeenCalled();
    });

    it('emissaoNde + escrita LIGADA → homologa de verdade e retorna emitida (rota contingência 11)', async () => {
        const env = buildEnv(true, false);
        const client = buildClient();
        const rec = buildRecebimento({ emissaoNde: { com297DocCod: 'DOC-9001', vldTpNf: '11' } });
        const nde = await buildEmitter(env, client).emitir(rec);
        expect(client.homologar).toHaveBeenCalledWith(
            expect.objectContaining({
                docCod: 'DOC-9001',
                filCod: rec.filCod,
                rota: expect.objectContaining({ verbo: 'homologaNfeContingencia' }),
            }),
        );
        expect(nde.statusEmissao).toBe('emitida');
        expect(nde.numeroNde).toBe('NDE-777');
        expect(nde.emitidaEm).toBeInstanceOf(Date);
        expect(nde.emitidaPor).toBe('analista');
    });

    it('fail-loud: vldTpNf desconhecido → VldTpNfDesconhecidoError (nunca homologa às cegas)', async () => {
        const env = buildEnv(true, false);
        const client = buildClient();
        const rec = buildRecebimento({ emissaoNde: { com297DocCod: 'DOC-9001', vldTpNf: '99' } });
        await expect(buildEmitter(env, client).emitir(rec)).rejects.toThrow(
            VldTpNfDesconhecidoError,
        );
        expect(client.homologar).not.toHaveBeenCalled();
    });

    it('propaga a rejeição do client (não engole um 200-não-sucesso como emitida)', async () => {
        const env = buildEnv(true, false);
        const client = buildClient({
            homologar: jest.fn().mockRejectedValue(
                new HomologacaoRejeitadaError({
                    docCod: 'DOC-9001',
                    motivo: 'validacao',
                    docVldComvalidacoes: 0,
                }),
            ),
        });
        const rec = buildRecebimento({ emissaoNde: { com297DocCod: 'DOC-9001', vldTpNf: '11' } });
        await expect(buildEmitter(env, client).emitir(rec)).rejects.toThrow(
            HomologacaoRejeitadaError,
        );
    });
});
