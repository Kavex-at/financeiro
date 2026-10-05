import 'reflect-metadata';
import DocumentoFavorecidoIndisponivelError from '../../errors/DocumentoFavorecidoIndisponivelError.js';
import ExcecaoAprovacaoProprioCadastranteError from '../../errors/ExcecaoAprovacaoProprioCadastranteError.js';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import ExcecaoSemPermissaoError from '../../errors/ExcecaoSemPermissaoError.js';
import ExcecaoTitularidadeError from '../../errors/ExcecaoTitularidadeError.js';
import {
    type DestinoManual,
    EXCECAO_ESTADO,
    type ExcecaoEstado,
} from '../../interface/sispag/SispagInterface.js';
import DestinoManualValidator from './DestinoManualValidator.js';
import ExcecaoDestinoRule, { EXCECAO_ACAO } from './ExcecaoDestinoRule.js';

const DOC = '11144477735';

const CONTA: DestinoManual = {
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta: '99887766',
    contaDv: '1',
    titularDocumento: DOC,
};
const CHAVE_CPF: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'CPF_CNPJ',
    chavePix: DOC,
    titularDocumento: DOC,
};
const CHAVE_EMAIL: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'EMAIL',
    chavePix: 'fornecedor@empresa.com',
    titularDocumento: DOC,
};

describe('ExcecaoDestinoRule (ADR-0060, I12)', () => {
    const rule = new ExcecaoDestinoRule(new DestinoManualValidator());

    describe('I12b — aprovador diferente do cadastrante (falha fechada)', () => {
        it('ids diferentes passam', () => {
            expect(() =>
                rule.exigirAprovadorDiferente({ cadastradoPor: 'ana', aprovadoPor: 'bia' }),
            ).not.toThrow();
        });

        it('o mesmo id lança ExcecaoAprovacaoProprioCadastranteError', () => {
            expect(() =>
                rule.exigirAprovadorDiferente({ cadastradoPor: 'ana', aprovadoPor: 'ana' }),
            ).toThrow(ExcecaoAprovacaoProprioCadastranteError);
        });

        it.each([
            ['cadastrante indefinido', undefined, 'bia'],
            ['aprovador indefinido', 'ana', undefined],
            ['os dois indefinidos', undefined, undefined],
            ['cadastrante vazio', '', 'bia'],
            ['aprovador só espaços', 'ana', '   '],
            ['os dois vazios (iguais)', '', ''],
        ])('%s: lança, nunca presume "diferente"', (_nome, cadastradoPor, aprovadoPor) => {
            expect(() => rule.exigirAprovadorDiferente({ cadastradoPor, aprovadoPor })).toThrow(
                ExcecaoAprovacaoProprioCadastranteError,
            );
        });

        it('o valor "unknown" do ator não autenticado nunca aprova', () => {
            expect(() =>
                rule.exigirAprovadorDiferente({ cadastradoPor: 'ana', aprovadoPor: 'unknown' }),
            ).toThrow(ExcecaoAprovacaoProprioCadastranteError);
        });

        it('diferenças só de caixa ou espaços contam como a mesma pessoa', () => {
            expect(() =>
                rule.exigirAprovadorDiferente({ cadastradoPor: 'Ana', aprovadoPor: ' ana ' }),
            ).toThrow(ExcecaoAprovacaoProprioCadastranteError);
        });
    });

    describe('permissão (segunda trava, além do guard da rota)', () => {
        it('sem sispag:excecao lança ExcecaoSemPermissaoError', () => {
            expect(() => rule.exigirPermissao(false)).toThrow(ExcecaoSemPermissaoError);
            expect(() => rule.exigirPermissao(true)).not.toThrow();
        });
    });

    describe('máquina de estados', () => {
        const ESTADOS = Object.values(EXCECAO_ESTADO) as ExcecaoEstado[];
        const base = { cadastradoPor: 'ana', ator: 'bia' };

        it('PENDENTE → APROVADA e PENDENTE → REJEITADA', () => {
            expect(
                rule.decidir(EXCECAO_ACAO.APROVAR, { ...base, estado: EXCECAO_ESTADO.PENDENTE }),
            ).toBe(EXCECAO_ESTADO.APROVADA);
            expect(
                rule.decidir(EXCECAO_ACAO.REJEITAR, { ...base, estado: EXCECAO_ESTADO.PENDENTE }),
            ).toBe(EXCECAO_ESTADO.REJEITADA);
        });

        it('APROVADA → REVOGADA | SUBSTITUIDA', () => {
            expect(
                rule.decidir(EXCECAO_ACAO.REVOGAR, { ...base, estado: EXCECAO_ESTADO.APROVADA }),
            ).toBe(EXCECAO_ESTADO.REVOGADA);
            expect(
                rule.decidir(EXCECAO_ACAO.SUBSTITUIR, {
                    ...base,
                    estado: EXCECAO_ESTADO.APROVADA,
                }),
            ).toBe(EXCECAO_ESTADO.SUBSTITUIDA);
        });

        const VALIDAS: Array<[string, ExcecaoEstado]> = [
            [EXCECAO_ACAO.APROVAR, EXCECAO_ESTADO.PENDENTE],
            [EXCECAO_ACAO.REJEITAR, EXCECAO_ESTADO.PENDENTE],
            [EXCECAO_ACAO.REVOGAR, EXCECAO_ESTADO.APROVADA],
            [EXCECAO_ACAO.SUBSTITUIR, EXCECAO_ESTADO.APROVADA],
        ];

        it('qualquer outra combinação ação × estado lança ExcecaoEstadoInvalidoError', () => {
            for (const acao of Object.values(EXCECAO_ACAO)) {
                for (const estado of ESTADOS) {
                    if (VALIDAS.some(([a, e]) => a === acao && e === estado)) continue;
                    expect(() => rule.decidir(acao, { ...base, estado })).toThrow(
                        ExcecaoEstadoInvalidoError,
                    );
                }
            }
        });

        it('estados terminais não saem (REJEITADA, SUBSTITUIDA, REVOGADA)', () => {
            for (const estado of [
                EXCECAO_ESTADO.REJEITADA,
                EXCECAO_ESTADO.SUBSTITUIDA,
                EXCECAO_ESTADO.REVOGADA,
            ]) {
                expect(rule.ehTerminal(estado)).toBe(true);
                for (const acao of Object.values(EXCECAO_ACAO)) {
                    expect(() => rule.decidir(acao, { ...base, estado })).toThrow(
                        ExcecaoEstadoInvalidoError,
                    );
                }
            }
            expect(rule.ehTerminal(EXCECAO_ESTADO.PENDENTE)).toBe(false);
            expect(rule.ehTerminal(EXCECAO_ESTADO.APROVADA)).toBe(false);
        });

        it('aprovar a própria PENDENTE lança; rejeitar a própria PENDENTE é permitido', () => {
            const propria = { cadastradoPor: 'ana', ator: 'ana', estado: EXCECAO_ESTADO.PENDENTE };
            expect(() => rule.decidir(EXCECAO_ACAO.APROVAR, propria)).toThrow(
                ExcecaoAprovacaoProprioCadastranteError,
            );
            expect(rule.decidir(EXCECAO_ACAO.REJEITAR, propria)).toBe(EXCECAO_ESTADO.REJEITADA);
        });

        it('qualquer titular revoga APROVADA, inclusive o cadastrante', () => {
            expect(
                rule.decidir(EXCECAO_ACAO.REVOGAR, {
                    cadastradoPor: 'ana',
                    ator: 'ana',
                    estado: EXCECAO_ESTADO.APROVADA,
                }),
            ).toBe(EXCECAO_ESTADO.REVOGADA);
        });
    });

    describe('titularidade e tipo da chave (I12i, I10i)', () => {
        it('conta com titular = documento do favorecido passa (documento com pontuação normaliza)', () => {
            expect(() => rule.conferirTitularidade(CONTA, DOC)).not.toThrow();
            expect(() => rule.conferirTitularidade(CONTA, '111.444.777-35')).not.toThrow();
        });

        it('titular diferente do favorecido lança ExcecaoTitularidadeError', () => {
            expect(() =>
                rule.conferirTitularidade({ ...CONTA, titularDocumento: '52998224725' }, DOC),
            ).toThrow(ExcecaoTitularidadeError);
        });

        it('PIX: só chave CPF/CNPJ igual ao documento do favorecido', () => {
            expect(() => rule.conferirTitularidade(CHAVE_CPF, DOC)).not.toThrow();
            expect(() =>
                rule.conferirTitularidade({ ...CHAVE_CPF, chavePix: '52998224725' }, DOC),
            ).toThrow(ExcecaoTitularidadeError);
        });

        it.each([
            ['EMAIL', CHAVE_EMAIL],
            ['TELEFONE', { ...CHAVE_EMAIL, chavePixTipo: 'TELEFONE', chavePix: '+5511999998888' }],
            [
                'ALEATORIA',
                {
                    ...CHAVE_EMAIL,
                    chavePixTipo: 'ALEATORIA',
                    chavePix: '123e4567-e89b-12d3-a456-426614174000',
                },
            ],
        ] as Array<[string, DestinoManual]>)('PIX com chave %s é rejeitado', (_t, destino) => {
            expect(() => rule.conferirTitularidade(destino, DOC)).toThrow(ExcecaoTitularidadeError);
        });

        it('documento do favorecido ausente ou inválido: falha fechada', () => {
            expect(() => rule.conferirTitularidade(CONTA, undefined)).toThrow(
                DocumentoFavorecidoIndisponivelError,
            );
            expect(() => rule.conferirTitularidade(CONTA, '123')).toThrow(
                DocumentoFavorecidoIndisponivelError,
            );
        });

        it('o erro nunca carrega conta, chave ou documento', () => {
            let msg = '';
            try {
                rule.conferirTitularidade({ ...CHAVE_CPF, chavePix: '52998224725' }, DOC);
            } catch (e) {
                const err = e as ExcecaoTitularidadeError;
                msg = `${err.message} ${err.userMessage} ${JSON.stringify(err.details)}`;
            }
            expect(msg).not.toBe('');
            expect(msg).not.toContain('52998224725');
            expect(msg).not.toContain(DOC);
        });
    });

    describe('TED e PIX igualmente exigem aprovação (sem isenção do PIX, ao contrário da ADR-0054 D11)', () => {
        it.each([CONTA, CHAVE_CPF])('exigeAprovacao(%j.tipo) é true', (destino) => {
            expect(rule.exigeAprovacao(destino)).toBe(true);
        });
    });
});
