import BoletoCodigoBarrasRepetidoError from './BoletoCodigoBarrasRepetidoError.js';

// Barras SINTÉTICAS (44 dígitos) e a linha de 47 correspondente; nunca um código real.
const BARRAS = '34191158000001412001090047729099260408340000';
const LINHA = '34191090044772909926704083400001115800000141200';
const MASCARADO = '34191…0000';

const titulo = (n: number) => ({
    docCod: String(1000 + n),
    titCod: '1',
    valor: 1412,
    vencimento: '2026-10-14',
    credor: 'PEDRONI',
});

const janelas = (codigo: string, tam = 10): string[] => {
    const r: string[] = [];
    for (let i = 0; i + tam <= codigo.length; i += 1) r.push(codigo.slice(i, i + tam));
    return r;
};

describe('BoletoCodigoBarrasRepetidoError', () => {
    const repetido = new BoletoCodigoBarrasRepetidoError({
        origem: 'lote',
        grupos: [{ mascarado: MASCARADO, itens: [titulo(1), titulo(2)] }],
        ilegiveis: [],
    });

    it('é um HandlerError 409 não retentável com code estável', () => {
        expect(repetido.statusCode).toBe(409);
        expect(repetido.retryable).toBe(false);
        expect(repetido.code).toBe('BOLETO_CODIGO_BARRAS_REPETIDO');
        expect(repetido.name).toBe('BoletoCodigoBarrasRepetidoError');
        expect(repetido).toBeInstanceOf(Error);
    });

    it('userMessage em pt-BR lista título, valor, vencimento e mascarado, e orienta', () => {
        const m = repetido.userMessage;
        expect(m).toContain('1001/1');
        expect(m).toContain('1002/1');
        expect(m).toContain('R$ 1.412,00');
        expect(m).toContain('14/10/2026');
        expect(m).toContain(MASCARADO);
        expect(m).toMatch(
            /retire o título repetido do lote aqui e peça que o rascunho seja descartado/i,
        );
        expect(m).toMatch(/rascunho deste lote no Conexos ainda contém o item repetido/);
        expect(m).toMatch(/nada foi enviado ao banco/);
    });

    it('modo ilegível: mensagem própria, sem código', () => {
        const err = new BoletoCodigoBarrasRepetidoError({
            origem: 'lote',
            grupos: [],
            ilegiveis: [titulo(7)],
        });
        expect(err.userMessage).toMatch(/ilegível|inválido/);
        expect(err.userMessage).toContain('1007/1');
        expect(err.userMessage).toMatch(/revise o boleto antes de gerar a remessa/i);
        expect(err.userMessage).not.toMatch(/\d{10,}/);
        expect((err.details as { modo: string }).modo).toBe('ilegivel');
    });

    it('modo arquivo: identifica por linha do arquivo + mascarado', () => {
        const err = new BoletoCodigoBarrasRepetidoError({
            origem: 'arquivo',
            grupos: [{ mascarado: MASCARADO, linhas: [12, 15] }],
        });
        expect(err.userMessage).toContain('12');
        expect(err.userMessage).toContain('15');
        expect(err.userMessage).toContain(MASCARADO);
        expect((err.details as { modo: string }).modo).toBe('arquivo');
    });

    it('lote: orienta a descartar o rascunho e nomeia o lote nativo; message leva o flpCod', () => {
        const err = new BoletoCodigoBarrasRepetidoError({
            origem: 'lote',
            flpCod: 12,
            grupos: [{ mascarado: MASCARADO, itens: [titulo(1), titulo(2)] }],
            ilegiveis: [],
        });
        expect(err.userMessage).toMatch(/interrompida antes de finalizar/);
        expect(err.userMessage).toMatch(/Lote nativo no Conexos: 12/);
        expect(err.message).toContain('flpCod 12');
    });

    it('ilegível: também diz que o rascunho segue no Conexos e deve ser descartado', () => {
        const err = new BoletoCodigoBarrasRepetidoError({
            origem: 'lote',
            flpCod: 12,
            grupos: [],
            ilegiveis: [titulo(7)],
        });
        expect(err.userMessage).toMatch(/interrompida antes de finalizar/);
        expect(err.userMessage).toMatch(/descartado no Conexos/);
        expect(err.userMessage).toMatch(/Lote nativo no Conexos: 12/);
        expect(err.message).toContain('flpCod 12');
    });

    it('arquivo: lote JÁ finalizado — não envie, cancele; nomeia flpCod e arquivo, sem "rascunho"', () => {
        const err = new BoletoCodigoBarrasRepetidoError({
            origem: 'arquivo',
            flpCod: 12,
            nomeArquivo: 'PG210801.REM',
            grupos: [{ mascarado: MASCARADO, linhas: [12, 15] }],
        });
        const m = err.userMessage;
        expect(m).toContain('PG210801.REM');
        expect(m).toMatch(/lote nativo 12 está FINALIZADO/);
        expect(m).toMatch(/NÃO envie este arquivo ao banco/);
        expect(m).toMatch(/cancele o arquivo e o lote no Conexos/);
        expect(m).not.toMatch(/interrompida antes de finalizar/);
        expect(m).not.toMatch(/rascunho/);
        expect(err.message).toContain('flpCod 12');
        expect(err.message).toContain('PG210801.REM');
        expect(m).toContain(MASCARADO);
        expect(m).not.toMatch(/\d{10,}/);
    });

    it('message (ledger) lista no máximo 20 títulos e resume o resto com (+N)', () => {
        const itens = Array.from({ length: 25 }, (_, i) => titulo(i));
        const err = new BoletoCodigoBarrasRepetidoError({
            origem: 'lote',
            grupos: [{ mascarado: MASCARADO, itens }],
            ilegiveis: [],
        });
        expect(err.message).toContain('(+5)');
        expect(err.message).toContain('1019/1');
        expect(err.message).not.toContain('1020/1');
        expect(err.message).toContain(MASCARADO);
        const todos = (err.details as { grupos: Array<{ itens: unknown[] }> }).grupos[0].itens;
        expect(todos).toHaveLength(25);
    });

    it('privacidade: nem o código completo nem janela de 10+ dígitos em lugar algum', () => {
        // Entrada hostil: o código completo (44 e 47) chega por onde não deveria.
        const hostil = new BoletoCodigoBarrasRepetidoError({
            origem: 'lote',
            grupos: [
                {
                    mascarado: BARRAS,
                    itens: [{ ...titulo(1), credor: `PEDRONI ${LINHA}`, extra: BARRAS } as never],
                },
            ],
            ilegiveis: [{ ...titulo(2), credor: BARRAS }],
        });
        const saidas = [
            hostil.message,
            hostil.userMessage,
            JSON.stringify(hostil.details),
            String(hostil.stack),
        ];
        for (const s of saidas) {
            expect(s).not.toContain(BARRAS);
            expect(s).not.toContain(LINHA);
            for (const j of [...janelas(BARRAS), ...janelas(LINHA)]) {
                expect(s).not.toContain(j);
            }
        }
        expect(hostil.userMessage).toContain(MASCARADO);
        expect(repetido.message).toContain(MASCARADO);
    });
});
