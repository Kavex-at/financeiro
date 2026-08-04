import 'reflect-metadata';
// Ontology refs:
//   - ontology/integrations/conexos.md (§"Contrato de leitura de ERRO")
//   - ontology/decisions/0026-recusa-deterministica-do-erp.md

import ConexosBaseClient from './ConexosBaseClient.js';

const erroDoErp = (status: number): Error & { response: unknown } =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data: { type: 'VALIDATION', messages: [{ message: 'RECUSADO' }] } },
    });

/** O adapter legado só precisa existir — nenhum destes testes chega a fazer HTTP. */
const legacyStub = (): never => ({}) as never;

describe('ConexosBaseClient.runWithRetry — só retenta o que pode mudar de resultado', () => {
    const build = (): ConexosBaseClient => new ConexosBaseClient(legacyStub());

    it('uma recusa determinística do ERP (4xx) é tentada UMA vez', async () => {
        // Sem isto, cada 400 custa N chamadas ao ERP e N vezes a mesma resposta — desperdício
        // medido na leg do fin014 (docs/e2e/fin014-finalizacao-hml-diagnostico.md).
        const fn = jest.fn().mockRejectedValue(erroDoErp(400));
        await expect(build().runWithRetry(fn)).rejects.toThrow();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('uma indisponibilidade (5xx) continua sendo retentada', async () => {
        const fn = jest.fn().mockRejectedValue(erroDoErp(503));
        await expect(build().runWithRetry(fn)).rejects.toThrow();
        expect(fn.mock.calls.length).toBeGreaterThan(1);
    });

    it('um erro sem status (rede/timeout) continua sendo retentado', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('socket hang up'));
        await expect(build().runWithRetry(fn)).rejects.toThrow();
        expect(fn.mock.calls.length).toBeGreaterThan(1);
    });

    it('429 é 4xx mas é transitório — retenta', async () => {
        const fn = jest.fn().mockRejectedValue(erroDoErp(429));
        await expect(build().runWithRetry(fn)).rejects.toThrow();
        expect(fn.mock.calls.length).toBeGreaterThan(1);
    });

    it('sucesso na segunda tentativa continua devolvendo o valor', async () => {
        const fn = jest.fn().mockRejectedValueOnce(erroDoErp(500)).mockResolvedValue('ok');
        await expect(build().runWithRetry(fn)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
