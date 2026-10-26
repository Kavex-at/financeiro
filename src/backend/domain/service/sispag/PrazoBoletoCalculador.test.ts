import 'reflect-metadata';
import {
    type CandidatoTitulo,
    type DesfechoTitulo,
    SITUACAO_SUGESTAO_TITULO,
    type SituacaoSugestaoTitulo,
} from '../../interface/sispag/SugestaoBoleto.js';
import PrazoBoletoCalculador from './PrazoBoletoCalculador.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';

const regra = new RegraSugestaoBoleto();
// 2026-10-26 é segunda-feira.
const HOJE = '2026-10-26';

interface Cand {
    vencBoleto: string;
    valor?: number;
    ancorado?: boolean;
    par?: boolean;
    reservadoParaOutro?: boolean;
}

const candidato = (vencTitulo: string, c: Cand, dataDebito: string): CandidatoTitulo => {
    const avaliacao = regra.avaliar({
        titulo: { valor: 100, vencimento: vencTitulo },
        boleto: { valor: c.valor ?? 100, vencimento: c.vencBoleto },
        dataDebito,
        parConfirmado: c.par ?? false,
    });
    return {
        ddcCod: 1,
        ditCod: 1,
        valorBoleto: c.valor ?? 100,
        vencimentoBoleto: c.vencBoleto,
        avaliacao,
        ancorado: c.ancorado ?? c.par ?? false,
        confirmavel: false,
        ...(c.reservadoParaOutro
            ? { reservadoParaTitulo: { filCod: 1, docCod: 'X', titCod: '9' } }
            : {}),
    };
};

const desfecho = (
    vencTitulo: string,
    situacao: SituacaoSugestaoTitulo,
    cands: Cand[],
    dataDebito = vencTitulo,
): DesfechoTitulo => ({
    filCod: 1,
    docCod: '9001',
    titCod: '1',
    valorTitulo: 100,
    vencimentoTitulo: vencTitulo,
    dataDebito,
    situacao,
    candidatos: cands.map((c) => candidato(vencTitulo, c, dataDebito)),
    totalCandidatos: cands.length,
    motivo: '',
});

const prazo = (d: DesfechoTitulo | undefined, vencTitulo: string) =>
    PrazoBoletoCalculador.paraTitulo({ vencimentoTitulo: vencTitulo, desfecho: d, hoje: HOJE });

describe('PrazoBoletoCalculador (I19t, ADR-0078) — casos canônicos 15–20', () => {
    it('15) Δ=-2, valor igual, âncora ⇒ prazo = barra, origem BOLETO_SUGERIDO (faixa "vencem hoje" no dia da barra)', () => {
        // título vence quarta 28/10; barra segunda 26/10 (hoje); lote antecipa o débito para hoje.
        const d = desfecho(
            '2026-10-28',
            SITUACAO_SUGESTAO_TITULO.SO_ATENCAO,
            [{ vencBoleto: '2026-10-26', par: true }],
            '2026-10-26',
        );
        expect(prazo(d, '2026-10-28')).toEqual({
            prazoEfetivo: '2026-10-26',
            origem: 'BOLETO_SUGERIDO',
            vencimentoTitulo: '2026-10-28',
            vencimentoBoleto: '2026-10-26',
            perdido: false,
        });
    });

    it('16) barra de sábado ⇒ prazo = segunda útil', () => {
        const d = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.SO_ATENCAO,
            [{ vencBoleto: '2026-10-31', par: true }], // sábado; 02/11 é Finados ⇒ terça 03/11
            '2026-10-30',
        );
        const r = prazo(d, '2026-11-10');
        expect(r).toMatchObject({ prazoEfetivo: '2026-11-03', origem: 'BOLETO_SUGERIDO' });
    });

    it('17) 2 seguros ⇒ os dois contam (totalCandidatos = 2); barras depois do título mantêm o título', () => {
        const d = desfecho('2026-11-10', SITUACAO_SUGESTAO_TITULO.AMBIGUA, [
            { vencBoleto: '2026-11-12' },
            { vencBoleto: '2026-11-11' },
        ]);
        expect(prazo(d, '2026-11-10')).toMatchObject({
            prazoEfetivo: '2026-11-10',
            origem: 'TITULO',
            totalCandidatos: 2,
        });
    });

    it('17b) 2 acionáveis com âncora ⇒ prazo do mais cedo e totalCandidatos = 2', () => {
        const d = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.AMBIGUA,
            [
                { vencBoleto: '2026-11-06', par: true },
                { vencBoleto: '2026-11-05', par: true },
            ],
            '2026-11-04',
        );
        expect(prazo(d, '2026-11-10')).toEqual({
            prazoEfetivo: '2026-11-05',
            origem: 'BOLETO_SUGERIDO',
            vencimentoTitulo: '2026-11-10',
            vencimentoBoleto: '2026-11-05',
            totalCandidatos: 2,
            perdido: false,
        });
    });

    it('18) SO_FRACA ⇒ prazo = título (fraco nunca puxa)', () => {
        const d = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.SO_FRACA,
            [{ vencBoleto: '2026-11-06', ancorado: false }],
            '2026-11-04',
        );
        expect(prazo(d, '2026-11-10')).toEqual({
            prazoEfetivo: '2026-11-10',
            origem: 'TITULO',
            vencimentoTitulo: '2026-11-10',
            perdido: false,
        });
    });

    it('19) barra < hoje ⇒ perdido = true (decisão CONFIRMADA cuja barra já passou)', () => {
        const d = desfecho(
            '2026-10-28',
            SITUACAO_SUGESTAO_TITULO.CONFIRMADA,
            [{ vencBoleto: '2026-10-23', par: true }], // sexta passada
            '2026-10-28',
        );
        expect(prazo(d, '2026-10-28')).toMatchObject({
            prazoEfetivo: '2026-10-23',
            origem: 'BOLETO_SUGERIDO',
            perdido: true,
        });
    });

    it('19b) candidato acionável com barra < hoje num título já vencido ⇒ perdido', () => {
        // título venceu em 21/10; a barra (valor igual, +2 dias) venceu em 23/10, antes de hoje: o débito é o título.
        const d = desfecho('2026-10-21', SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA, [
            { vencBoleto: '2026-10-23', par: true },
        ]);
        expect(prazo(d, '2026-10-21')).toMatchObject({ perdido: true });
    });

    it('19c) valor igual + âncora, VENCIDO_INFORMATIVO com barra < hoje e título a vencer ⇒ perdido, SEM puxar o prazo (G1)', () => {
        // título vence 30/10 (a vencer); barra venceu sexta 23/10; débito em 30/10 ⇒ barra < débito ⇒ VENCIDO_INFORMATIVO.
        const d = desfecho('2026-10-30', SITUACAO_SUGESTAO_TITULO.SO_VENCIDA, [
            { vencBoleto: '2026-10-23', par: true },
        ]);
        expect(prazo(d, '2026-10-30')).toEqual({
            prazoEfetivo: '2026-10-30',
            origem: 'TITULO',
            vencimentoTitulo: '2026-10-30',
            perdido: true,
        });
    });

    it('19d) o perdido por VENCIDO_INFORMATIVO exige âncora, valor igual e não reservado', () => {
        const base = { vencBoleto: '2026-10-23' };
        const sem = (c: Cand) =>
            prazo(desfecho('2026-10-30', SITUACAO_SUGESTAO_TITULO.SO_VENCIDA, [c]), '2026-10-30');
        expect(sem({ ...base, ancorado: false })).toMatchObject({ perdido: false });
        expect(sem({ ...base, par: true, valor: 101 })).toMatchObject({ perdido: false });
        expect(sem({ ...base, par: true, reservadoParaOutro: true })).toMatchObject({
            perdido: false,
        });
        // barra vencida mas ainda >= hoje: informativo comum, não perdido
        expect(sem({ vencBoleto: '2026-10-26', par: true })).toMatchObject({ perdido: false });
    });

    it('20) o VENCIDO não muda: título que vence hoje e sem candidato não é vencido nem perdido', () => {
        expect(prazo(undefined, HOJE)).toEqual({
            prazoEfetivo: HOJE,
            origem: 'TITULO',
            vencimentoTitulo: HOJE,
            perdido: false,
        });
    });
});

describe('PrazoBoletoCalculador — o que é acionável', () => {
    it('VENCIDO_INFORMATIVO e perdedor de disputa nunca puxam', () => {
        const vencido = desfecho('2026-11-10', SITUACAO_SUGESTAO_TITULO.SO_VENCIDA, [
            { vencBoleto: '2026-11-03', par: true },
        ]);
        expect(prazo(vencido, '2026-11-10')).toMatchObject({ origem: 'TITULO', perdido: false });
        const disputado = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.DISPUTADA,
            [{ vencBoleto: '2026-11-05', par: true, reservadoParaOutro: true }],
            '2026-11-04',
        );
        expect(prazo(disputado, '2026-11-10')).toMatchObject({ origem: 'TITULO' });
    });

    it('ORFA nunca puxa', () => {
        const d = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.ORFA,
            [{ vencBoleto: '2026-11-05', par: true }],
            '2026-11-04',
        );
        expect(prazo(d, '2026-11-10')).toMatchObject({ origem: 'TITULO' });
    });

    it('ATENCAO sem âncora não puxa; com âncora puxa', () => {
        const sem = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.SO_FRACA,
            [{ vencBoleto: '2026-11-05' }],
            '2026-11-04',
        );
        const com = desfecho(
            '2026-11-10',
            SITUACAO_SUGESTAO_TITULO.SO_ATENCAO,
            [{ vencBoleto: '2026-11-05', par: true }],
            '2026-11-04',
        );
        expect(prazo(sem, '2026-11-10')?.origem).toBe('TITULO');
        expect(prazo(com, '2026-11-10')?.origem).toBe('BOLETO_SUGERIDO');
    });

    it('barra depois do título: o prazo é o do título', () => {
        const d = desfecho('2026-11-10', SITUACAO_SUGESTAO_TITULO.UNICA_SEGURA, [
            { vencBoleto: '2026-11-13' },
        ]);
        expect(prazo(d, '2026-11-10')).toMatchObject({
            prazoEfetivo: '2026-11-10',
            origem: 'TITULO',
        });
    });

    it('é puro: nunca lê o relógio (o "hoje" entra por argumento)', () => {
        const d = desfecho(
            '2026-10-28',
            SITUACAO_SUGESTAO_TITULO.CONFIRMADA,
            [{ vencBoleto: '2026-10-23', par: true }],
            '2026-10-28',
        );
        jest.useFakeTimers().setSystemTime(new Date('2040-01-01T00:00:00Z'));
        try {
            expect(prazo(d, '2026-10-28')?.perdido).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
});
