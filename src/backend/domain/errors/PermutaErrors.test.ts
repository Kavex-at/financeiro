import { isHandlerError } from '../libs/handler/HandlerError.js';
import BorderoAmbiguousError from './BorderoAmbiguousError.js';
import BorderoNotOwnedError from './BorderoNotOwnedError.js';
import BorderoStateConflictError from './BorderoStateConflictError.js';
import ConexosWriteDisabledError from './ConexosWriteDisabledError.js';
import ErpHandshakeError from './ErpHandshakeError.js';
import InvalidAllocationError from './InvalidAllocationError.js';
import InvalidNumerarioValueError from './InvalidNumerarioValueError.js';
import OpenBalanceMismatchError from './OpenBalanceMismatchError.js';
import PermutaDataIncompleteError from './PermutaDataIncompleteError.js';
import PermutaNotFoundError from './PermutaNotFoundError.js';

/**
 * Os `throw new Error(...)` da Permuta viraram erros tipados. O que muda é o TIPO (e com ele o status
 * HTTP); o `message` técnico é o MESMO texto de antes — é ele que vai para log, trilha e
 * `ReconciliacaoLotePermutaService`. Cada caso abaixo fixa o texto exato que o `throw` antigo gerava.
 */
describe('erros tipados da Permuta — status e texto preservado', () => {
    it.each([
        [
            'adiantamento não encontrado',
            new PermutaNotFoundError({ recurso: 'adiantamento', adiantamentoDocCod: '555' }),
            404,
            'ADIANTAMENTO_NAO_ENCONTRADO',
            'adiantamento 555 not found',
        ],
        [
            'invoice fora do processo',
            new PermutaNotFoundError({
                recurso: 'invoice',
                invoiceDocCod: '777',
                invoicePriCod: '42',
            }),
            404,
            'INVOICE_NAO_ENCONTRADA',
            'invoice 777 not found in process 42',
        ],
        [
            'baixa fora da trilha',
            new PermutaNotFoundError({ recurso: 'baixa', borCod: 18538, invoiceDocCod: '777' }),
            404,
            'BAIXA_NAO_ENCONTRADA',
            'baixa não encontrada na trilha: borderô 18538 / invoice 777',
        ],
        [
            'adiantamento sem filial',
            new PermutaDataIncompleteError({ campo: 'filial', adiantamentoDocCod: '555' }),
            422,
            'PERMUTA_DADOS_INCOMPLETOS',
            'adiantamento 555 without filial',
        ],
        [
            'adiantamento sem priCod/pesCod',
            new PermutaDataIncompleteError({ campo: 'priCod-pesCod', adiantamentoDocCod: '555' }),
            422,
            'PERMUTA_DADOS_INCOMPLETOS',
            'adiantamento 555 lacks numeric priCod/pesCod (SN requires both)',
        ],
        [
            'processo diferente',
            new InvalidAllocationError({
                motivo: 'processo-diferente',
                invoicePriCod: '42',
                adiantamentoPriCod: '41',
            }),
            422,
            'ALOCACAO_INVALIDA',
            'same-process allocation required: invoice process 42 != adiantamento process 41',
        ],
        [
            'invoice sem D.I/DUIMP',
            new InvalidAllocationError({ motivo: 'sem-di-duimp', invoiceDocCod: '777' }),
            422,
            'ALOCACAO_INVALIDA',
            'invoice 777 without D.I/DUIMP — cannot be permuted',
        ],
        [
            'moeda diferente',
            new InvalidAllocationError({
                motivo: 'moeda-diferente',
                moedaAdiantamento: 'USD',
                moedaInvoice: 'EUR',
            }),
            422,
            'ALOCACAO_INVALIDA',
            'currency mismatch: adiantamento USD != invoice EUR',
        ],
        [
            'valor da SN',
            new InvalidNumerarioValueError({ valor: 0.004 }),
            422,
            'NUMERARIO_VALOR_INVALIDO',
            'invalid value for SN (0.004)',
        ],
        [
            'escrita desligada',
            new ConexosWriteDisabledError(),
            503,
            'CONEXOS_ESCRITA_DESABILITADA',
            'escrita no Conexos desabilitada (CONEXOS_WRITE_ENABLED=false)',
        ],
        [
            'borderô fora da trilha',
            new BorderoNotOwnedError({ borCod: 14918 }),
            403,
            'BORDERO_FORA_DA_TRILHA',
            'FORBIDDEN: borderô 14918 não foi criado por este sistema — ação não permitida',
        ],
        [
            'borderô fora da trilha naquela filial',
            new BorderoNotOwnedError({ borCod: 14918, filCod: 7 }),
            403,
            'BORDERO_FORA_DA_TRILHA',
            'FORBIDDEN: borderô 14918 da filial 7 não foi criado por este sistema — ação não permitida',
        ],
        [
            'borderô em duas filiais',
            new BorderoAmbiguousError({ borCod: 14918, filiais: [2, 7] }),
            400,
            'BORDERO_AMBIGUO',
            'Borderô 14918 existe na trilha em mais de uma filial (2, 7) — informe a filial (`filCod`) para identificar qual deles.',
        ],
        [
            'borderô sem baixas',
            new BorderoStateConflictError({ motivo: 'sem-baixas', borCod: 18538 }),
            409,
            'BORDERO_SEM_BAIXAS',
            'Borderô 18538 não possui baixas — não há o que aprovar. Ele ficou vazio porque a baixa falhou depois de criá-lo; use "Excluir" para removê-lo.',
        ],
        [
            'baixa sem bxaCodSeq',
            new BorderoStateConflictError({
                motivo: 'baixa-sem-seq',
                borCod: 18538,
                invoiceDocCod: '777',
            }),
            409,
            'BAIXA_SEM_SEQUENCIA_ERP',
            'baixa 18538/777 sem bxaCodSeq — não dá para excluir no ERP',
        ],
    ])('%s', (_caso, err, status, code, message) => {
        expect(isHandlerError(err)).toBe(true);
        expect(err).toBeInstanceOf(Error);
        expect(err.statusCode).toBe(status);
        expect(err.code).toBe(code);
        expect(err.retryable).toBe(false);
        expect(err.message).toBe(message);
        expect(err.userMessage.length).toBeGreaterThan(0);
    });

    it('o 403 mostra à analista o mesmo texto que a rota já exibia (sem o prefixo FORBIDDEN:)', () => {
        const err = new BorderoNotOwnedError({ borCod: 14918 });
        expect(err.userMessage).toBe(
            'borderô 14918 não foi criado por este sistema — ação não permitida',
        );
    });

    it('userMessage de recusa que chega à tela é em português, sem o texto técnico em inglês', () => {
        const err = new PermutaNotFoundError({
            recurso: 'adiantamento',
            adiantamentoDocCod: '555',
        });
        expect(err.userMessage).toContain('não encontrado');
        expect(err.userMessage).not.toContain('not found');
    });
});

/**
 * Estes rodam DENTRO do laço de baixas da reconciliação (continue-on-error). Lá o texto gravado na
 * trilha do par é `isHandlerError(err) ? err.userMessage : interpret(err).friendly`, e para um `Error`
 * cru sem resposta do ERP o `friendly` é o próprio `message`. Então `userMessage === message` é o que
 * garante que a analista lê na trilha exatamente o que lia antes da troca de tipo.
 */
describe('erros do laço de baixas — o texto da trilha não muda', () => {
    it.each([
        [
            'alocação sem taxa da invoice',
            new PermutaDataIncompleteError({
                campo: 'taxa-invoice',
                adiantamentoDocCod: 555,
                invoiceDocCod: 777,
            }),
            422,
            'alocação 555→777 sem taxa da invoice — não dá para calcular o valor da baixa',
        ],
        [
            'título sem em-aberto',
            new OpenBalanceMismatchError({
                motivo: 'zerado',
                invoiceDocCod: 777,
                titCod: 1,
                message: 'título 777/1 sem valor em aberto no ERP (bxaMnyValor=0)',
            }),
            409,
            'título 777/1 sem valor em aberto no ERP (bxaMnyValor=0)',
        ],
        [
            'anti-drift',
            new OpenBalanceMismatchError({
                motivo: 'excedido',
                invoiceDocCod: 777,
                titCod: 1,
                message: 'anti-drift: baixa 110.00 (BRL) > em-aberto do ERP 100',
            }),
            422,
            'anti-drift: baixa 110.00 (BRL) > em-aberto do ERP 100',
        ],
        [
            'fin010 com ERRO no envelope',
            new ErpHandshakeError({
                passo: 'tituloBaixa',
                message: 'fin010 tituloBaixa retornou ERRO: CONTA DE DESCONTO NÃO INFORMADA',
            }),
            502,
            'fin010 tituloBaixa retornou ERRO: CONTA DE DESCONTO NÃO INFORMADA',
        ],
    ])('%s', (_caso, err, status, texto) => {
        expect(err.statusCode).toBe(status);
        expect(err.message).toBe(texto);
        expect(err.userMessage).toBe(texto);
    });
});
