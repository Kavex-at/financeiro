import 'reflect-metadata';
import ErpErrorInterpreter from './ErpErrorInterpreter.js';

const buildErr = (
    messages: Array<{ valid?: string; message?: string; vars?: Record<string, unknown> }>,
    opts: { nested?: boolean; status?: number } = {},
): unknown => {
    const response = { status: opts.status ?? 400, data: { messages } };
    return opts.nested
        ? Object.assign(new Error('conexos'), { cause: { response } })
        : Object.assign(new Error('conexos'), { response });
};

describe('ErpErrorInterpreter', () => {
    const interpreter = new ErpErrorInterpreter();

    it('Generic.ERROR_MESSAGE com vars.msg → surface a razão real', () => {
        const out = interpreter.interpret(
            buildErr([
                {
                    message: 'Generic.ERROR_MESSAGE',
                    vars: { msg: 'CONTA DE DESCONTO NÃO INFORMADA!!!' },
                },
            ]),
        );
        expect(out.friendly).toBe('CONTA DE DESCONTO NÃO INFORMADA!!!');
        expect(out.key).toBe('Generic.ERROR_MESSAGE');
        expect(out.reason).toBe('CONTA DE DESCONTO NÃO INFORMADA!!!');
        expect(out.status).toBe(400);
    });

    it('Generic.ERROR_MESSAGE SEM vars → cai no fallback PT genérico', () => {
        const out = interpreter.interpret(buildErr([{ message: 'Generic.ERROR_MESSAGE' }]));
        expect(out.friendly).toMatch(/ERP recusou/);
        expect(out.reason).toBeUndefined();
    });

    it('key mapeada → tradução PT curada (razão não sobrepõe a curada)', () => {
        const out = interpreter.interpret(
            buildErr([{ message: 'FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE' }]),
        );
        expect(out.friendly).toMatch(/período fechado/);
    });

    it('key NÃO mapeada e sem vars → surface a própria key', () => {
        const out = interpreter.interpret(buildErr([{ message: 'FIN_010.ALGO_NAO_MAPEADO' }]));
        expect(out.friendly).toBe('FIN_010.ALGO_NAO_MAPEADO');
        expect(out.key).toBe('FIN_010.ALGO_NAO_MAPEADO');
    });

    it('lê o erro aninhado no cause (ConexosError)', () => {
        const out = interpreter.interpret(
            buildErr([{ message: 'Generic.ERROR_MESSAGE', vars: { msg: 'PERÍODO BLOQUEADO' } }], {
                nested: true,
            }),
        );
        expect(out.friendly).toBe('PERÍODO BLOQUEADO');
        expect(out.status).toBe(400);
    });

    it('vars.msg não-string ou vazio → ignora (usa a key)', () => {
        const naoString = interpreter.interpret(
            buildErr([{ message: 'Generic.ERROR_MESSAGE', vars: { msg: 42 } }]),
        );
        expect(naoString.friendly).toMatch(/ERP recusou/);
        const vazio = interpreter.interpret(
            buildErr([{ message: 'Generic.ERROR_MESSAGE', vars: { msg: '   ' } }]),
        );
        expect(vazio.friendly).toMatch(/ERP recusou/);
    });

    it('múltiplas mensagens → prefere a que tem valid==="ERRO"', () => {
        const out = interpreter.interpret(
            buildErr([
                { valid: 'AVISO', message: 'PESSOA_POSSUI_ADIANTAMENTO' },
                { valid: 'ERRO', message: 'Generic.ERROR_MESSAGE', vars: { msg: 'RAZÃO ERRO' } },
            ]),
        );
        expect(out.friendly).toBe('RAZÃO ERRO');
    });

    it('erro sem response (Error puro) → fallback para Error.message', () => {
        const out = interpreter.interpret(new Error('ERP 500'));
        expect(out.friendly).toBe('ERP 500');
        expect(out.key).toBeUndefined();
    });

    it('describeMessage: Generic + vars → razão real', () => {
        expect(
            interpreter.describeMessage({
                valid: 'ERRO',
                message: 'Generic.ERROR_MESSAGE',
                vars: { msg: 'TÍTULO SEM SALDO' },
            }),
        ).toBe('TÍTULO SEM SALDO');
    });

    it('describeMessage: key sem vars → key', () => {
        expect(interpreter.describeMessage({ valid: 'ERRO', message: 'ALGUMA_KEY' })).toBe(
            'ALGUMA_KEY',
        );
    });

    it('SELECTION_ERROR gcdDesNomeProc NOT_VALID → mensagem de processo INELEGÍVEL (não "call failed")', () => {
        const err = Object.assign(new Error('Conexos call to com299/gerDocProcesso failed'), {
            cause: {
                response: {
                    status: 400,
                    data: {
                        type: 'SELECTION_ERROR',
                        validation: {
                            main: {
                                itemMessages: [
                                    {
                                        frontModelName: 'gerDocProcesso',
                                        item: 'gcdDesNomeProc',
                                        messages: [
                                            {
                                                message: 'Generic.NOT_VALID',
                                                vars: {
                                                    atributo:
                                                        'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA',
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });
        const friendly = interpreter.interpret(err).friendly;
        expect(friendly).toContain('SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA');
        expect(friendly).toContain('não é elegível');
        expect(friendly).not.toContain('call to com299');
    });

    it('VALIDATION itemMessages (item genérico) → "Campo X inválido" (não o fallback cru)', () => {
        const err = Object.assign(new Error('failed'), {
            response: {
                status: 400,
                data: {
                    type: 'VALIDATION',
                    itemMessages: [
                        {
                            item: 'borVldTipo',
                            messages: [{ message: 'CnxValidatorVld', constraint: 'required' }],
                        },
                    ],
                },
            },
        });
        expect(interpreter.interpret(err).friendly).toContain('borVldTipo');
    });

    it('envelope malformado (messages não-array ou com null) NÃO lança — cai no fallback', () => {
        // Error-handler não pode lançar: messages não-array.
        const naoArray = Object.assign(new Error('conexos'), {
            response: { status: 400, data: { messages: { message: 'x' } } },
        });
        expect(() => interpreter.interpret(naoArray)).not.toThrow();
        expect(interpreter.interpret(naoArray).friendly).toBe('conexos');
        // messages array com item null.
        const comNull = Object.assign(new Error('conexos'), {
            response: { status: 400, data: { messages: [null] } },
        });
        expect(() => interpreter.interpret(comNull)).not.toThrow();
    });
});
