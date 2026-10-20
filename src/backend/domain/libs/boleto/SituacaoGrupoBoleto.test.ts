import { GRUPO_BOLETO_ESTADO } from '../../interface/sispag/GrupoBoletoInterface.js';
import { LOTE_STATUS } from '../../interface/sispag/SispagInterface.js';
import { ETAPA_BORDERO_GRUPO as E } from './EtapaBorderoGrupo.js';
import SituacaoGrupoBoleto, {
    type EntradaSituacaoGrupo,
    SITUACAO_GRUPO_BOLETO as S,
} from './SituacaoGrupoBoleto.js';

const base = (over: Partial<EntradaSituacaoGrupo> = {}): EntradaSituacaoGrupo => ({
    estado: GRUPO_BOLETO_ESTADO.CONFIRMADO,
    orfao: false,
    marcaRetencaoAtiva: false,
    divergente: false,
    execucoes: [],
    ...over,
});

const rejeitada = {
    iniciadaEm: '2026-10-21T10:00:00Z',
    etapa: E.CONCLUIDO,
    jRejeitadoEm: '2026-10-23T09:00:00Z',
};

describe('SituacaoGrupoBoleto — situação derivada, não persistida (grupo-boleto.md, ADR-0076)', () => {
    it('confirmado, sem lote, sem nada ⇒ DISPONIVEL', () => {
        expect(SituacaoGrupoBoleto.derivar(base())).toBe(S.DISPONIVEL);
    });

    it.each([LOTE_STATUS.RASCUNHO, LOTE_STATUS.FINALIZADO])('lote %s ⇒ EM_LOTE', (status) => {
        expect(SituacaoGrupoBoleto.derivar(base({ loteStatus: status }))).toBe(S.EM_LOTE);
    });

    it('lote REMESSA_GERADA ⇒ EM_REMESSA', () => {
        expect(SituacaoGrupoBoleto.derivar(base({ loteStatus: LOTE_STATUS.REMESSA_GERADA }))).toBe(
            S.EM_REMESSA,
        );
    });

    it('lote cancelado, retornado ou baixado não é "lote vivo" ⇒ conta como sem lote', () => {
        for (const status of [LOTE_STATUS.CANCELADO, LOTE_STATUS.RETORNADO, LOTE_STATUS.BAIXADO]) {
            expect(SituacaoGrupoBoleto.derivar(base({ loteStatus: status }))).toBe(S.DISPONIVEL);
        }
    });

    it('estado ANULADO / PAGO vence tudo', () => {
        const tudo = {
            orfao: true,
            marcaRetencaoAtiva: true,
            divergente: true,
            loteStatus: LOTE_STATUS.REMESSA_GERADA,
            execucoes: [rejeitada],
        };
        expect(
            SituacaoGrupoBoleto.derivar(base({ ...tudo, estado: GRUPO_BOLETO_ESTADO.ANULADO })),
        ).toBe(S.ANULADO);
        expect(
            SituacaoGrupoBoleto.derivar(base({ ...tudo, estado: GRUPO_BOLETO_ESTADO.PAGO })),
        ).toBe(S.PAGO);
    });

    describe('REJEITADO (I19r)', () => {
        it('última execução com J rejeitado e nenhuma posterior concluída ⇒ REJEITADO', () => {
            expect(SituacaoGrupoBoleto.derivar(base({ execucoes: [rejeitada] }))).toBe(S.REJEITADO);
        });

        it('execução posterior concluída (a remessa nova preparou o borderô) ⇒ deixa de ser REJEITADO', () => {
            const nova = { iniciadaEm: '2026-10-25T10:00:00Z', etapa: E.CONCLUIDO };
            expect(SituacaoGrupoBoleto.derivar(base({ execucoes: [nova, rejeitada] }))).toBe(
                S.DISPONIVEL,
            );
        });

        it('execução posterior NÃO concluída (falhou, retirada) ⇒ continua REJEITADO', () => {
            const falhou = { iniciadaEm: '2026-10-25T10:00:00Z', etapa: E.RETIRADO };
            expect(SituacaoGrupoBoleto.derivar(base({ execucoes: [rejeitada, falhou] }))).toBe(
                S.REJEITADO,
            );
        });

        it('execução concluída ANTES da rejeitada não limpa a rejeição', () => {
            const antiga = { iniciadaEm: '2026-10-10T10:00:00Z', etapa: E.CONCLUIDO };
            expect(SituacaoGrupoBoleto.derivar(base({ execucoes: [antiga, rejeitada] }))).toBe(
                S.REJEITADO,
            );
        });

        it('rejeitado incluído à mão num lote novo ⇒ EM_LOTE (a analista já agiu)', () => {
            expect(
                SituacaoGrupoBoleto.derivar(
                    base({ execucoes: [rejeitada], loteStatus: LOTE_STATUS.RASCUNHO }),
                ),
            ).toBe(S.EM_LOTE);
        });
    });

    describe('precedência explícita: DIVERGENTE > EM_REMESSA > ORFAO > RETIDO > EM_LOTE > REJEITADO > DISPONIVEL', () => {
        it('DIVERGENTE vence órfão e remessa (dinheiro em jogo)', () => {
            expect(
                SituacaoGrupoBoleto.derivar(
                    base({ divergente: true, orfao: true, loteStatus: LOTE_STATUS.REMESSA_GERADA }),
                ),
            ).toBe(S.DIVERGENTE);
        });

        it('EM_REMESSA vence órfão (título pago após o banco pagar é o caminho esperado)', () => {
            expect(
                SituacaoGrupoBoleto.derivar(
                    base({ orfao: true, loteStatus: LOTE_STATUS.REMESSA_GERADA }),
                ),
            ).toBe(S.EM_REMESSA);
        });

        it('órfão e retido ao mesmo tempo ⇒ ORFAO', () => {
            expect(
                SituacaoGrupoBoleto.derivar(base({ orfao: true, marcaRetencaoAtiva: true })),
            ).toBe(S.ORFAO);
        });

        it('órfão num lote RASCUNHO ⇒ ORFAO (a remessa vai barrar, I19p(1))', () => {
            expect(
                SituacaoGrupoBoleto.derivar(
                    base({ orfao: true, loteStatus: LOTE_STATUS.RASCUNHO }),
                ),
            ).toBe(S.ORFAO);
        });

        it('retido e rejeitado ⇒ RETIDO', () => {
            expect(
                SituacaoGrupoBoleto.derivar(
                    base({ marcaRetencaoAtiva: true, execucoes: [rejeitada] }),
                ),
            ).toBe(S.RETIDO);
        });

        it('retido num lote ⇒ RETIDO', () => {
            expect(
                SituacaoGrupoBoleto.derivar(
                    base({ marcaRetencaoAtiva: true, loteStatus: LOTE_STATUS.RASCUNHO }),
                ),
            ).toBe(S.RETIDO);
        });

        it('a ordem exportada é a mesma testada aqui', () => {
            expect(SituacaoGrupoBoleto.PRECEDENCIA).toEqual([
                S.ANULADO,
                S.PAGO,
                S.DIVERGENTE,
                S.EM_REMESSA,
                S.ORFAO,
                S.RETIDO,
                S.EM_LOTE,
                S.REJEITADO,
                S.DISPONIVEL,
            ]);
        });
    });

    describe('podeSerLotadoPeloCron (I19j, I19r)', () => {
        it.each([S.ORFAO, S.RETIDO, S.REJEITADO])('%s ⇒ falso', (s) => {
            expect(SituacaoGrupoBoleto.podeSerLotadoPeloCron(s)).toBe(false);
        });

        it('só DISPONIVEL ⇒ verdadeiro', () => {
            const sim = Object.values(S).filter((s) =>
                SituacaoGrupoBoleto.podeSerLotadoPeloCron(s),
            );
            expect(sim).toEqual([S.DISPONIVEL]);
        });
    });
});
