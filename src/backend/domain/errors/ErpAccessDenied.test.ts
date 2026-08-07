import ErpAccessDenied from './ErpAccessDenied.js';

/**
 * Envelope REAL capturado no log de produção (Render, 2026-08-06) quando o analista
 * clicou "Processar" na aba Automáticas e o `imp223/list` foi negado. Mantido literal —
 * é o contrato que o parser precisa aguentar.
 */
const ENVELOPE_REAL = {
    type: 'ACCESS_DENIED',
    permRequest: {
        usnCodRequest: 14,
        usnCodResponse: null,
        usnDesNomeRequest: 'SIMONE_PEREIRA',
        usnDesNomeResponse: null,
        gerentesUsuario: [
            { usnCod: 1, usnDesNome: 'CONEXOS' },
            { usnCod: 21, usnDesNome: 'CATIA_OLIVEIRA' },
            { usnCod: 97, usnDesNome: 'MPS_FRANCINEI' },
            { usnCod: 127, usnDesNome: 'RICARDO_PRADO' },
        ],
        caminho: 'Despacho Aduaneiro / Pucomex',
        cpoCod: 37681,
        cpoDesArquivo: 'IMP_223',
        cpoDesNome: 'DECLARAÇÃO ÚNICA DE IMPORTAÇÃO (DUIMP)',
        generatedBy: { type: 'SELECT', name: 'SELECT' },
        permissoesIniciais: {
            permissoes: { DELETE: false, INSERT: false, UPDATE: false, SELECT: false },
            acoes: { CONSULTAR: { granted: false, acoCod: 1, cpoCod: 37681 } },
            licensed: true,
        },
        gpsVldStatus: null,
        gpsCodOld: null,
        vldTipoComponente: 'FORM',
    },
};

const errWith = (data: unknown): unknown => ({
    message: 'Conexos call to imp223/list failed',
    response: { status: 403, data },
});

describe('ErpAccessDenied.parse', () => {
    it('extrai usuário, ação, tela e gerentes do envelope real de produção', () => {
        const ad = ErpAccessDenied.parse(errWith(ENVELOPE_REAL));
        expect(ad).toEqual({
            usuario: 'SIMONE_PEREIRA',
            acao: 'CONSULTA',
            form: 'IMP_223',
            formNome: 'DECLARAÇÃO ÚNICA DE IMPORTAÇÃO (DUIMP)',
            caminho: 'Despacho Aduaneiro / Pucomex',
            gerentes: ['CATIA_OLIVEIRA', 'MPS_FRANCINEI', 'RICARDO_PRADO'],
        });
    });

    it('lê o envelope aninhado no `cause` (ConexosError envolvendo o AxiosError)', () => {
        const wrapped = { message: 'wrapper', cause: errWith(ENVELOPE_REAL) };
        expect(ErpAccessDenied.parse(wrapped)?.form).toBe('IMP_223');
    });

    it('descarta o gerente genérico CONEXOS — não é uma pessoa a quem pedir acesso', () => {
        const ad = ErpAccessDenied.parse(errWith(ENVELOPE_REAL));
        expect(ad?.gerentes).not.toContain('CONEXOS');
    });

    it('devolve undefined para um erro do ERP que não é de permissão', () => {
        const outro = errWith({ messages: [{ valid: 'ERRO', message: 'Generic.ERROR_MESSAGE' }] });
        expect(ErpAccessDenied.parse(outro)).toBeUndefined();
    });

    it('devolve undefined quando não há resposta do upstream (timeout/rede)', () => {
        expect(ErpAccessDenied.parse(new Error('socket hang up'))).toBeUndefined();
        expect(ErpAccessDenied.parse(undefined)).toBeUndefined();
        expect(ErpAccessDenied.parse(null)).toBeUndefined();
    });

    // NUNCA lança: todo consumidor está num caminho de tratamento de erro, onde um throw
    // viraria justamente o 500 genérico que este parser existe para explicar.
    it('sobrevive a envelope malformado sem lançar', () => {
        const malformados: unknown[] = [
            errWith({ type: 'ACCESS_DENIED' }),
            errWith({ type: 'ACCESS_DENIED', permRequest: null }),
            errWith({ type: 'ACCESS_DENIED', permRequest: 'nope' }),
            errWith({ type: 'ACCESS_DENIED', permRequest: { gerentesUsuario: 'nope' } }),
            errWith({ type: 'ACCESS_DENIED', permRequest: { gerentesUsuario: [null, 7, {}] } }),
            errWith({ type: 'ACCESS_DENIED', permRequest: { generatedBy: { type: 42 } } }),
            errWith('string em vez de objeto'),
        ];
        for (const m of malformados) {
            expect(() => ErpAccessDenied.parse(m)).not.toThrow();
        }
    });

    it('reconhece o envelope mesmo sem `type`, quando o permRequest identifica a tela', () => {
        const semType = errWith({ permRequest: { cpoDesArquivo: 'FIN_010' } });
        expect(ErpAccessDenied.parse(semType)?.form).toBe('FIN_010');
    });

    it('traduz a operação negada a partir do `generatedBy`', () => {
        const comInsert = {
            type: 'ACCESS_DENIED',
            permRequest: { cpoDesArquivo: 'FIN_010', generatedBy: { type: 'INSERT' } },
        };
        expect(ErpAccessDenied.parse(errWith(comInsert))?.acao).toBe('INCLUSÃO');
    });
});

describe('ErpAccessDenied.describe', () => {
    /** Falha o teste (em vez de `!`) quando o parse não reconheceu o envelope. */
    const fraseDe = (err: unknown): string => {
        const info = ErpAccessDenied.parse(err);
        if (info === undefined) throw new Error('envelope não reconhecido como ACCESS_DENIED');
        return ErpAccessDenied.describe(info);
    };

    it('compõe a frase acionável aprovada (usuário, ação, tela e quem libera)', () => {
        expect(fraseDe(errWith(ENVELOPE_REAL))).toBe(
            'Seu usuário Conexos (SIMONE_PEREIRA) não tem permissão de CONSULTA em IMP_223 — ' +
                'DECLARAÇÃO ÚNICA DE IMPORTAÇÃO (DUIMP). ' +
                'Peça liberação a: CATIA_OLIVEIRA, MPS_FRANCINEI, RICARDO_PRADO.',
        );
    });

    it('degrada com elegância quando o envelope veio incompleto', () => {
        const frase = fraseDe(
            errWith({ type: 'ACCESS_DENIED', permRequest: { cpoDesArquivo: 'FIN_010' } }),
        );
        expect(frase).toContain('FIN_010');
        expect(frase).not.toContain('undefined');
        expect(frase).not.toContain('Peça liberação a:');
    });

    // O texto é de operação (PT-BR) e vai para a tela do analista; o payload cru fica no log.
    it('não vaza o payload cru na frase', () => {
        expect(fraseDe(errWith(ENVELOPE_REAL))).not.toMatch(
            /cpoCod|permissoesIniciais|usnCod|licensed/,
        );
    });
});
