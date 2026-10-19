import 'reflect-metadata';
import type { DesfechoTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import type { TentativaDps } from '../../interface/sispag/TituloDps.js';
import SelecaoLeituraDps, { MAX_TENTATIVAS_DPS } from './SelecaoLeituraDps.js';

const selecao = new SelecaoLeituraDps();
const AGORA = Date.parse('2026-10-19T18:00:00Z');

const desfecho = (
    docCod: string,
    situacao: DesfechoTitulo['situacao'],
    numeros: string[] = ['776132000'],
): DesfechoTitulo =>
    ({
        filCod: 2,
        docCod,
        titCod: '1',
        situacao,
        candidatos: numeros.map((numeroBoleto) => ({ numeroBoleto })),
    }) as unknown as DesfechoTitulo;

const tentativa = (docCod: string, over: Partial<TentativaDps> = {}): TentativaDps => ({
    filCod: 2,
    docCod,
    titCod: '1',
    status: 'SEM_PDF',
    tentativas: 1,
    lidoEm: '2026-10-18T00:00:00.000Z',
    ...over,
});

describe('SelecaoLeituraDps — quem precisa do PDF (D2, ADR-0073)', () => {
    it('lê só o que a ordem não resolveu: AMBIGUA, SO_FRACA e DISPUTADA', () => {
        const alvos = selecao.selecionar(
            [
                desfecho('a', 'AMBIGUA'),
                desfecho('b', 'SO_FRACA'),
                desfecho('c', 'DISPUTADA'),
                desfecho('d', 'UNICA_SEGURA'),
                desfecho('e', 'SO_ATENCAO'),
                desfecho('f', 'SEM_CANDIDATO', []),
                desfecho('g', 'SO_VENCIDA'),
            ],
            [],
            AGORA,
            10,
        );
        expect(alvos.map((a) => a.docCod)).toEqual(['a', 'b', 'c']);
    });

    it('só emissor de NFS-e: precisa de candidato com número no formato N000', () => {
        const alvos = selecao.selecionar(
            [
                desfecho('a', 'AMBIGUA', ['12345', '4400123']),
                desfecho('b', 'AMBIGUA', ['77613200']),
            ],
            [],
            AGORA,
            10,
        );
        expect(alvos).toEqual([]);
    });

    it('título com DPS já LIDO não é relido', () => {
        const alvos = selecao.selecionar(
            [desfecho('a', 'AMBIGUA')],
            [tentativa('a', { status: 'LIDO' })],
            AGORA,
            10,
        );
        expect(alvos).toEqual([]);
    });

    it('tentativa falha volta depois de 12 h, até o limite de tentativas', () => {
        const recente = tentativa('a', { lidoEm: '2026-10-19T10:00:00.000Z' });
        const antiga = tentativa('b');
        const esgotada = tentativa('c', { tentativas: MAX_TENTATIVAS_DPS });
        const alvos = selecao.selecionar(
            [desfecho('a', 'AMBIGUA'), desfecho('b', 'AMBIGUA'), desfecho('c', 'AMBIGUA')],
            [recente, antiga, esgotada],
            AGORA,
            10,
        );
        expect(alvos.map((a) => a.docCod)).toEqual(['b']);
    });

    it('respeita o limite por execução, na ordem dos desfechos (menor vencimento primeiro)', () => {
        const alvos = selecao.selecionar(
            [desfecho('a', 'AMBIGUA'), desfecho('b', 'AMBIGUA'), desfecho('c', 'AMBIGUA')],
            [],
            AGORA,
            2,
        );
        expect(alvos.map((a) => a.docCod)).toEqual(['a', 'b']);
    });
});
