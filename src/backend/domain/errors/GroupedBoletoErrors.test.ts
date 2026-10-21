import 'reflect-metadata';
import type { Request, Response } from 'express';
import { respondHandlerError } from '../../http/respondHandlerError.js';
import { MOTIVO_GRUPO_INELEGIVEL as M } from '../interface/sispag/GrupoBoletoInterface.js';
import CodigoBarrasSintetico from '../libs/boleto/CodigoBarrasSintetico.js';
import { isHandlerError } from '../libs/handler/HandlerError.js';
import GroupBorderoIncompleteError from './GroupBorderoIncompleteError.js';
import GroupedBoletoCrossBranchError from './GroupedBoletoCrossBranchError.js';
import GroupedBoletoDueWindowError from './GroupedBoletoDueWindowError.js';
import GroupedBoletoIndivisibleError from './GroupedBoletoIndivisibleError.js';
import GroupedBoletoNotEligibleAtRemittanceError from './GroupedBoletoNotEligibleAtRemittanceError.js';
import GroupedBoletoNotConfirmableError from './GroupedBoletoNotConfirmableError.js';
import GroupedBoletoNotFoundError from './GroupedBoletoNotFoundError.js';
import GroupedBoletoStateConflictError from './GroupedBoletoStateConflictError.js';
import GroupedBoletoSumMismatchError from './GroupedBoletoSumMismatchError.js';
import GroupedBoletoTitleIneligibleError from './GroupedBoletoTitleIneligibleError.js';
import WarningAcknowledgementRequiredError from './WarningAcknowledgementRequiredError.js';

const BARRAS = CodigoBarrasSintetico.barras({ valor: 1575, vencimento: '2026-10-21' });
const LINHA = CodigoBarrasSintetico.linhaDigitavel({ valor: 1575, vencimento: '2026-10-21' });
const MASCARA = `${BARRAS.slice(0, 5)}…${BARRAS.slice(-4)}`;
const TITULOS = [
    { filCod: 2, docCod: '38883', titCod: '1' },
    { filCod: 2, docCod: '38884', titCod: '1' },
    { filCod: 2, docCod: '38885', titCod: '1' },
];

const semCodigoCompleto = (erro: Error & { userMessage: string; details?: unknown }): void => {
    const tudo = JSON.stringify({
        m: erro.message,
        u: erro.userMessage,
        d: erro.details,
        s: erro.stack,
    });
    expect(tudo).not.toMatch(/\d{44}/);
    expect(tudo).not.toMatch(/\d{47}/);
    expect(tudo).not.toContain(LINHA);
    expect(JSON.stringify(erro)).not.toMatch(/\d{20,}/);
};

const erros = () => ({
    soma: new GroupedBoletoSumMismatchError({
        filCod: 2,
        ddcCod: 900,
        ditCod: 332841,
        // Mesmo que alguém passe o código inteiro, só a máscara sai.
        codigoMascarado: BARRAS,
        valorBoletoCentavos: 157501,
        somaTitulosCentavos: 157500,
    }),
    titulo: new GroupedBoletoTitleIneligibleError({
        titulos: [{ filCod: 2, docCod: '38884', titCod: '1', motivo: M.NAO_LIBERADO }],
    }),
    filial: new GroupedBoletoCrossBranchError({ filiais: [4, 2], ddcCod: 900, ditCod: 332841 }),
    janela: new GroupedBoletoDueWindowError({
        vencimentoBoleto: '2026-10-26',
        titulos: [
            { filCod: 2, docCod: '501', titCod: '1', vencimento: '2026-10-15', deltaDias: 11 },
        ],
    }),
    indivisivel: new GroupedBoletoIndivisibleError({
        grupoId: 'g-1',
        codigoMascarado: LINHA,
        titulos: TITULOS,
    }),
    remessa: new GroupedBoletoNotEligibleAtRemittanceError({
        loteId: 'L-7',
        grupos: [{ grupoId: 'g-1', codigoMascarado: MASCARA, motivo: M.PAGO, titulo: TITULOS[0] }],
    }),
    bordero: new GroupBorderoIncompleteError({
        grupoId: 'g-1',
        filCod: 2,
        borCod: 252,
        flpCod: 48,
        etapa: 'baixas_gravadas',
    }),
    ausente: new GroupedBoletoNotFoundError({ grupoId: 'g-404' }),
    naoConfirmavel: new GroupedBoletoNotConfirmableError({
        ddcCod: 900,
        ditCod: 332841,
        codigoMascarado: BARRAS,
        motivos: [M.BOLETO_EM_DECISAO_1_1, M.CREDORES_DIFERENTES],
    }),
    estado: new GroupedBoletoStateConflictError({ grupoId: 'g-1', estado: 'PAGO', acao: 'anular' }),
});

describe('erros nomeados do boleto agrupado (I21, ADR-0077)', () => {
    it.each([
        ['soma', 'GroupedBoletoSumMismatchError', 422, 'GRUPO_BOLETO_SOMA_DIVERGENTE', false],
        [
            'titulo',
            'GroupedBoletoTitleIneligibleError',
            409,
            'GRUPO_BOLETO_TITULO_INELEGIVEL',
            false,
        ],
        ['filial', 'GroupedBoletoCrossBranchError', 422, 'GRUPO_BOLETO_CRUZA_FILIAL', false],
        ['janela', 'GroupedBoletoDueWindowError', 422, 'GRUPO_BOLETO_FORA_DA_JANELA', false],
        ['indivisivel', 'GroupedBoletoIndivisibleError', 409, 'GRUPO_BOLETO_INDIVISIVEL', false],
        [
            'remessa',
            'GroupedBoletoNotEligibleAtRemittanceError',
            409,
            'GRUPO_BOLETO_INELEGIVEL_NA_REMESSA',
            false,
        ],
        ['bordero', 'GroupBorderoIncompleteError', 409, 'GRUPO_BORDERO_INCOMPLETO', true],
        ['ausente', 'GroupedBoletoNotFoundError', 404, 'GRUPO_BOLETO_NAO_ENCONTRADO', false],
        [
            'naoConfirmavel',
            'GroupedBoletoNotConfirmableError',
            409,
            'GRUPO_BOLETO_NAO_CONFIRMAVEL',
            false,
        ],
        [
            'estado',
            'GroupedBoletoStateConflictError',
            409,
            'GRUPO_BOLETO_ESTADO_INCOMPATIVEL',
            false,
        ],
    ] as const)('%s: %s é HandlerError %i (%s)', (k, nome, status, code, retryable) => {
        const erro = erros()[k];
        expect(isHandlerError(erro)).toBe(true);
        expect(erro).toBeInstanceOf(Error);
        expect(erro).toMatchObject({ name: nome, statusCode: status, code, retryable });
        // message em inglês (operador técnico); userMessage em pt-BR (tela).
        expect(erro.message).toMatch(/^[A-Z][a-z]/);
        expect(erro.message).not.toMatch(/[ãçõéíá]/);
        expect(erro.userMessage).not.toBe(erro.message);
        semCodigoCompleto(erro);
    });

    it('soma: chaves do boleto, os dois valores, o Δ e o código mascarado', () => {
        const e = erros().soma;
        expect(e.userMessage).toContain('R$ 1.575,01');
        expect(e.userMessage).toContain('R$ 1.575,00');
        expect(e.userMessage).toContain('R$ 0,01');
        expect(e.userMessage).toContain(MASCARA);
        expect(e.userMessage).toMatch(/filial 2/);
        expect(e.details).toMatchObject({
            filCod: 2,
            ddcCod: 900,
            ditCod: 332841,
            deltaCentavos: 1,
        });
        expect(e.details.codigoMascarado).toBe(MASCARA);
        expect(e.message).toMatch(/^Grouped boleto sum mismatch/);
    });

    it('título inelegível: docCod/titCod e o motivo em pt-BR ("aguardando alçada")', () => {
        const e = erros().titulo;
        expect(e.userMessage).toContain('38884/1');
        expect(e.userMessage).toMatch(/aguardando alçada/);
        expect(e.details.titulos[0]).toMatchObject({ docCod: '38884', motivo: M.NAO_LIBERADO });
    });

    it('cruza filial: lista as filiais e orienta pagar à mão', () => {
        const e = erros().filial;
        expect(e.userMessage).toMatch(/filiais 2 e 4/);
        expect(e.userMessage).toMatch(/pague à mão/);
        expect(e.details.filiais).toEqual([2, 4]);
    });

    it('janela: título, vencimentos em DD/MM/AAAA e a janela de 0 a 10 dias', () => {
        const e = erros().janela;
        expect(e.userMessage).toContain('501/1');
        expect(e.userMessage).toContain('15/10/2026');
        expect(e.userMessage).toContain('26/10/2026');
        expect(e.userMessage).toMatch(/até 10 dias antes/);
    });

    it('indivisível: traz o id do grupo e os N títulos (a tela os lista)', () => {
        const e = erros().indivisivel;
        expect(e.details.grupoId).toBe('g-1');
        expect(e.details.titulos).toEqual(TITULOS);
        expect(e.details.codigoMascarado).toBe(`${LINHA.slice(0, 5)}…${LINHA.slice(-4)}`);
        expect(e.userMessage).toContain('38883/1, 38884/1 e 38885/1');
        expect(e.userMessage).toMatch(/grupo inteiro/);
    });

    it('remessa: barra antes de qualquer escrita, lista grupo, título e motivo', () => {
        const e = erros().remessa;
        expect(e.userMessage).toMatch(/Nada foi enviado ao Conexos/);
        expect(e.userMessage).toContain(MASCARA);
        expect(e.userMessage).toContain('38883/1');
        expect(e.userMessage).toMatch(/o título já está pago/);
        expect(e.details).toMatchObject({ loteId: 'L-7' });
    });

    it('borderô incompleto: retomável, com borCod, lote nativo e filial', () => {
        const e = erros().bordero;
        expect(e.userMessage).toMatch(/borderô 252/);
        expect(e.userMessage).toMatch(/filial 2/);
        expect(e.userMessage).toMatch(/retomad/);
        expect(e.details).toEqual({
            grupoId: 'g-1',
            filCod: 2,
            borCod: 252,
            flpCod: 48,
            etapa: 'baixas_gravadas',
        });
    });

    it('não encontrado: 404 com o id', () => {
        expect(erros().ausente.details).toEqual({ grupoId: 'g-404' });
        expect(erros().ausente.userMessage).toMatch(/Grupo de boleto não encontrado/);
    });

    it('o aviso da I21g reutiliza WarningAcknowledgementRequiredError (nenhum erro novo de aviso)', () => {
        const e = new WarningAcknowledgementRequiredError({
            filCod: 2,
            docCod: '501',
            titCod: '1',
            ddcCod: 900,
            ditCod: 333111,
            avisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
            vencimentoTitulo: '2026-10-25',
            vencimentoBoleto: '2026-10-26',
            dataDebito: '2026-10-26',
        });
        expect(e).toMatchObject({ statusCode: 422, code: 'RECONHECIMENTO_DE_AVISO_OBRIGATORIO' });
        // O aviso do grupo é o inverso do 1:1: o TÍTULO vence antes do boleto.
        expect(e.userMessage).toMatch(
            /título 501\/1 vence em 25\/10\/2026, antes do boleto \(26\/10\/2026\)/,
        );
    });

    it('não confirmável: motivos do grupo em pt-BR, só a máscara; sugestão mudou pede atualizar', () => {
        const e = erros().naoConfirmavel;
        expect(e.userMessage).toContain(MASCARA);
        expect(e.userMessage).toMatch(/já está confirmado para um título/);
        expect(e.userMessage).toMatch(/credores diferentes/);
        expect(e.details).toMatchObject({ codigoMascarado: MASCARA, sugestaoMudou: false });
        const mudou = new GroupedBoletoNotConfirmableError({
            ddcCod: 900,
            ditCod: 332841,
            sugestaoMudou: true,
        });
        expect(mudou.userMessage).toMatch(/Atualize a lista/);
        expect(mudou.details.sugestaoMudou).toBe(true);
    });

    it('estado incompatível: grupo PAGO não se anula', () => {
        expect(erros().estado.userMessage).toBe(
            'O grupo de boleto já foi pago: não pode ser anulado.',
        );
    });
});

describe('mapeamento HTTP (respondHandlerError — o mesmo de respondLoteError do SISPAG)', () => {
    const resposta = () => {
        const r = { status: 0, corpo: undefined as unknown };
        const res = {
            status: (s: number) => {
                r.status = s;
                return res;
            },
            json: (b: unknown) => {
                r.corpo = b;
                return res;
            },
        } as unknown as Response;
        return { r, res };
    };
    const req = { header: (n: string) => (n === 'x-request-id' ? 'req-1' : undefined) } as Request;

    it.each(
        Object.entries(erros()),
    )('%s responde status, code, userMessage e details', (_k, erro) => {
        const { r, res } = resposta();
        expect(respondHandlerError(req, res, erro)).toBe(true);
        expect(r.status).toBe(erro.statusCode);
        expect(r.corpo).toEqual({
            error: erro.userMessage,
            code: erro.code,
            retryable: erro.retryable,
            details: erro.details,
            requestId: 'req-1',
        });
        expect(JSON.stringify(r.corpo)).not.toMatch(/\d{20,}/);
    });
});
