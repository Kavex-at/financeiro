import 'reflect-metadata';
// Ontology refs:
//   - ontology/integrations/conexos.md (§"Contrato de leitura de ERRO")
//   - ontology/decisions/0026-recusa-deterministica-do-erp.md

import ConexosError from './ConexosError.js';

/** Um erro do axios como ele chega ao `catch` dos clients: `err.response.{status,data}`. */
const erroDoErp = (status: number, data?: unknown): Error & { response: unknown } =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data },
    });

/** O envelope de VALIDAÇÃO do Conexos — o mesmo formato do 400 que travou o `fin014/finalizar`. */
const envelopeValidacao = (message: string): unknown => ({
    type: 'VALIDATION',
    messages: [{ message }],
});

/** O envelope `ACCESS_DENIED` (403) — permissão de tela/ação negada ao usuário do ERP. */
const envelopeAccessDenied = (form: string, acao = 'SELECT'): unknown => ({
    type: 'ACCESS_DENIED',
    permRequest: {
        usnDesNomeRequest: 'SIMONE_PEREIRA',
        cpoDesArquivo: form,
        cpoDesNome: 'DECLARAÇÃO ÚNICA DE IMPORTAÇÃO (DUIMP)',
        caminho: 'Despacho Aduaneiro / Pucomex',
        generatedBy: { type: acao, name: acao },
        gerentesUsuario: [
            { usnCod: 1, usnDesNome: 'CONEXOS' },
            { usnCod: 21, usnDesNome: 'CATIA_OLIVEIRA' },
        ],
    },
});

describe('ConexosError — recusa determinística × indisponibilidade', () => {
    describe('indisponibilidade (retentável): o retry pode mudar o resultado', () => {
        it('sem `cause` (falha de rede/parse, sem status) segue retentável em 504', () => {
            const e = new ConexosError({ endpoint: 'fin014/finalizar/135' });
            expect(e.retryable).toBe(true);
            expect(e.statusCode).toBe(504);
            expect(e.code).toBe('CONEXOS_UPSTREAM_ERROR');
        });

        it('5xx do ERP segue retentável — o servidor caiu, não recusou', () => {
            const e = new ConexosError({
                endpoint: 'fin014/finalizar/135',
                cause: erroDoErp(500, { messages: [{ message: 'NullPointerException' }] }),
            });
            expect(e.retryable).toBe(true);
            expect(e.statusCode).toBe(504);
        });

        it.each([408, 429])('%i é 4xx mas é transitório — segue retentável', (status) => {
            const e = new ConexosError({ endpoint: 'com299', cause: erroDoErp(status) });
            expect(e.retryable).toBe(true);
            expect(e.statusCode).toBe(504);
        });

        it('timeout declarado pelo caller vence qualquer status', () => {
            const e = new ConexosError({
                endpoint: 'com299',
                code: 'CONEXOS_UPSTREAM_TIMEOUT',
                cause: erroDoErp(400, envelopeValidacao('SEJA_LA_O_QUE_FOR')),
            });
            expect(e.code).toBe('CONEXOS_UPSTREAM_TIMEOUT');
            expect(e.retryable).toBe(true);
        });
    });

    describe('recusa determinística (não-retentável): repetir nunca vai passar', () => {
        it('o 400 que travou o fin014 no HML NÃO é retentável e não manda tentar de novo', () => {
            // A assinatura medida em 2026-08-03: `POST fin014/finalizar/135` → 400 VALIDATION.
            // Ver docs/e2e/fin014-finalizacao-hml-diagnostico.md — é defeito de ambiente, determinístico.
            const e = new ConexosError({
                endpoint: 'fin014/finalizar/135',
                cause: erroDoErp(400, envelopeValidacao('CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE')),
            });
            expect(e.retryable).toBe(false);
            expect(e.statusCode).toBe(502);
            expect(e.code).toBe('CONEXOS_UPSTREAM_REJECTED');
            // A mensagem do analista tem que carregar a razão do ERP, não um "tente novamente".
            expect(e.userMessage).toContain('CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE');
            expect(e.userMessage).not.toMatch(/tente novamente/i);
        });

        it('a razão real do envelope `Generic.ERROR_MESSAGE` vem em `vars.msg`', () => {
            const e = new ConexosError({
                endpoint: 'fin010/finalizar/14918',
                cause: erroDoErp(400, {
                    messages: [
                        {
                            valid: 'ERRO',
                            message: 'Generic.ERROR_MESSAGE',
                            vars: { msg: 'CONTA DE DESCONTO NÃO INFORMADA!!!' },
                        },
                    ],
                }),
            });
            expect(e.retryable).toBe(false);
            expect(e.userMessage).toContain('CONTA DE DESCONTO NÃO INFORMADA!!!');
        });

        it.each([
            400, 401, 403, 404, 405, 409, 422,
        ])('%i é recusa: retryable=false em 502', (status) => {
            const e = new ConexosError({ endpoint: 'com297', cause: erroDoErp(status) });
            expect(e.retryable).toBe(false);
            expect(e.statusCode).toBe(502);
        });

        it('sem razão legível, a mensagem ainda diz que repetir não adianta', () => {
            const e = new ConexosError({ endpoint: 'com297', cause: erroDoErp(400) });
            expect(e.userMessage).not.toMatch(/tente novamente/i);
            expect(e.userMessage.length).toBeGreaterThan(0);
        });

        it('lê o status através de um `cause` aninhado (ConexosError envolvendo ConexosError)', () => {
            const interno = new ConexosError({
                endpoint: 'fin014/baixas',
                cause: erroDoErp(400, envelopeValidacao('CnxValidatorCod')),
            });
            const externo = new ConexosError({ endpoint: 'fin014', cause: interno });
            expect(externo.retryable).toBe(false);
            expect(externo.statusCode).toBe(502);
        });

        it('`details` continua carregando endpoint e priCod para o log', () => {
            const e = new ConexosError({
                endpoint: 'com299',
                priCod: '186',
                cause: erroDoErp(400, envelopeValidacao('X')),
            });
            expect(e.details).toEqual({ endpoint: 'com299', priCod: '186' });
        });
    });

    // Permissão negada é uma recusa como as outras (não retentável), mas com um desfecho que
    // só ela tem: o próprio ERP diz qual tela falta e quem libera. Por isso ganha código e
    // status próprios — o 403 diz ao front que o problema é de acesso, não do dado enviado.
    describe('ACCESS_DENIED (403): a recusa que já vem com a solução', () => {
        it('classifica como acesso negado, em 403 e não-retentável', () => {
            const e = new ConexosError({
                endpoint: 'imp223/list',
                cause: erroDoErp(403, envelopeAccessDenied('IMP_223')),
            });
            expect(e.code).toBe('CONEXOS_ACCESS_DENIED');
            expect(e.statusCode).toBe(403);
            expect(e.retryable).toBe(false);
        });

        it('a mensagem nomeia usuário, ação, tela e quem libera', () => {
            const e = new ConexosError({
                endpoint: 'imp223/list',
                cause: erroDoErp(403, envelopeAccessDenied('IMP_223')),
            });
            expect(e.userMessage).toContain('SIMONE_PEREIRA');
            expect(e.userMessage).toContain('CONSULTA');
            expect(e.userMessage).toContain('IMP_223');
            expect(e.userMessage).toContain('CATIA_OLIVEIRA');
            // Repetir não resolve permissão — o conselho errado de sempre.
            expect(e.userMessage).not.toMatch(/tente novamente/i);
        });

        it('atravessa o `cause` aninhado sem perder a frase', () => {
            const interno = new ConexosError({
                endpoint: 'imp223/list',
                cause: erroDoErp(403, envelopeAccessDenied('IMP_223')),
            });
            const externo = new ConexosError({ endpoint: 'permutas', cause: interno });
            expect(externo.code).toBe('CONEXOS_ACCESS_DENIED');
            expect(externo.statusCode).toBe(403);
        });

        it('um 403 SEM envelope de permissão continua sendo recusa comum (502)', () => {
            const e = new ConexosError({ endpoint: 'fin010', cause: erroDoErp(403) });
            expect(e.code).toBe('CONEXOS_UPSTREAM_REJECTED');
            expect(e.statusCode).toBe(502);
        });

        it('o timeout declarado pelo caller ainda vence o envelope', () => {
            const e = new ConexosError({
                endpoint: 'imp223/list',
                code: 'CONEXOS_UPSTREAM_TIMEOUT',
                cause: erroDoErp(403, envelopeAccessDenied('IMP_223')),
            });
            expect(e.code).toBe('CONEXOS_UPSTREAM_TIMEOUT');
        });
    });
});
