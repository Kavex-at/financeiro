import 'reflect-metadata';
import AncoraOrdemDps, {
    type BoletoOrdem,
    type EntradaOrdemDps,
    type ProvaDps,
    type TituloOrdem,
} from './AncoraOrdemDps.js';

const ancora = new AncoraOrdemDps();

const EMISSOR = '237:2656:0022101';

// Medido em PRD (2026-10-19), fil 2 / 237:2656:0022101: NFS-e 86666 ↔ DPS 776132 (PDF do 41155/1).
const PROVA: ProvaDps = { pesCod: '386', emissorChave: EMISSOR, nfse: 86666, dps: 776132 };

const titulo = (chave: string, nfse?: string, extra: Partial<TituloOrdem> = {}): TituloOrdem => ({
    chave,
    pesCod: '386',
    ...(nfse ? { nfse } : {}),
    ...extra,
});

const boleto = (chave: string, numero?: string, emissorChave = EMISSOR): BoletoOrdem => ({
    chave,
    emissorChave,
    ...(numero ? { numero } : {}),
});

/** Todos os títulos são candidatos de todos os boletos (o caso das tarifas de valor fixo). */
const completo = (titulos: TituloOrdem[], boletos: BoletoOrdem[]): Map<string, string[]> =>
    new Map(titulos.map((t) => [t.chave, boletos.map((b) => b.chave)]));

const parear = (e: Partial<EntradaOrdemDps> & Pick<EntradaOrdemDps, 'titulos' | 'boletos'>) =>
    ancora.parear({
        candidatos: completo(e.titulos, e.boletos),
        provas: [PROVA],
        ...e,
    });

describe('AncoraOrdemDps — pareamento por ordem no escopo provado (I15p(2), ADR-0073)', () => {
    // Grupo real R$ 286,37 (fil 2, 23/10): 5 títulos × 5 boletos, offset 689465.
    const titulos286 = [
        titulo('2:41172:1', '86180'),
        titulo('2:41154:1', '86186'),
        titulo('2:41173:1', '86188'),
        titulo('2:41164:1', '86193'),
        titulo('2:41168:1', '86203'),
    ];
    const boletos286 = [
        boleto('b5', '775668000'),
        boleto('b1', '775645000'),
        boleto('b3', '775653000'),
        boleto('b2', '775651000'),
        boleto('b4', '775658000'),
    ];

    it('casa o k-ésimo título por NFS-e com o k-ésimo boleto por número', () => {
        const pares = parear({ titulos: titulos286, boletos: boletos286 });
        expect([...pares].sort()).toEqual(
            ['2:41154:1|b2', '2:41164:1|b4', '2:41168:1|b5', '2:41172:1|b1', '2:41173:1|b3'].sort(),
        );
    });

    it('é determinístico: a ordem de entrada não muda o resultado', () => {
        const a = parear({ titulos: titulos286, boletos: boletos286 });
        const b = parear({
            titulos: [...titulos286].reverse(),
            boletos: [...boletos286].reverse(),
        });
        expect([...a].sort()).toEqual([...b].sort());
    });

    it('escopo sem prova (nenhum DPS lido) não pareia nada', () => {
        expect(parear({ titulos: titulos286, boletos: boletos286, provas: [] }).size).toBe(0);
    });

    it('prova de OUTRO emissor do mesmo credor não vale (I15g)', () => {
        const provas = [{ ...PROVA, emissorChave: '237:2656:0092740' }];
        expect(parear({ titulos: titulos286, boletos: boletos286, provas }).size).toBe(0);
    });

    it('prova de OUTRO credor no mesmo emissor não vale (I15g)', () => {
        const provas = [{ ...PROVA, pesCod: '999' }];
        expect(parear({ titulos: titulos286, boletos: boletos286, provas }).size).toBe(0);
    });

    it('contagens diferentes (boleto a mais no grupo) → nada pareado, vai para o PDF', () => {
        const pares = parear({
            titulos: titulos286.slice(0, 4),
            boletos: boletos286,
        });
        expect(pares.size).toBe(0);
    });

    it('título sem NFS-e no grupo → o grupo inteiro fica sem âncora de ordem', () => {
        const titulos = [...titulos286.slice(0, 4), titulo('2:41168:1')];
        expect(parear({ titulos, boletos: boletos286 }).size).toBe(0);
    });

    it('boleto fora do formato N000 no grupo → nada pareado', () => {
        const boletos = [...boletos286.slice(0, 4), boleto('b5', '775668123')];
        expect(parear({ titulos: titulos286, boletos }).size).toBe(0);
    });

    it('boleto do grupo também candidato de título de fora do grupo → nada pareado', () => {
        // O R$ 97,06 real: títulos sem NFS-e disputam os mesmos boletos.
        const fora = titulo('2:38538:1');
        const titulos = [...titulos286, fora];
        const candidatos = completo(titulos, boletos286);
        expect(parear({ titulos, boletos: boletos286, candidatos }).size).toBe(0);
    });

    it('par que cruza um DPS conhecido do escopo é rejeitado (monotonicidade com a prova)', () => {
        // NFS-e > 86666 tem de ter DPS > 776132; aqui o boleto fica abaixo da prova.
        const titulos = [titulo('t1', '86700'), titulo('t2', '86710')];
        const boletos = [boleto('x1', '776100000'), boleto('x2', '776150000')];
        expect(parear({ titulos, boletos }).size).toBe(0);
    });

    it('caso do print: 41155 (DPS lido) fica de fora; 41156 sozinho com o boleto restante', () => {
        // 41155 já tem DPS (âncora direta); seu boleto sai do grupo pela regra 1, no motor.
        const titulos = [titulo('2:41156:1', '86672')];
        const boletos = [boleto('b138', '776138000')];
        expect([...parear({ titulos, boletos })]).toEqual(['2:41156:1|b138']);
    });

    it('título com DPS conhecido não entra no pareamento por ordem', () => {
        const titulos = [titulo('2:41155:1', '86666', { dps: '776132' })];
        const boletos = [boleto('b132', '776132000')];
        expect(parear({ titulos, boletos }).size).toBe(0);
    });

    it('título com DPS conhecido não disputa os outros boletos, e o boleto do DPS sai da ordem', () => {
        // O motor lista 776132000 e 776138000 como candidatos de 41155 e de 41156 (mesmo valor).
        const titulos = [
            titulo('2:41155:1', '86666', { dps: '776132' }),
            titulo('2:41156:1', '86672'),
        ];
        const boletos = [boleto('b132', '776132000'), boleto('b138', '776138000')];
        expect([...parear({ titulos, boletos })]).toEqual(['2:41156:1|b138']);
    });

    it('pareia só pelas arestas de candidato: par fora do envelope não é inventado', () => {
        const titulos = [titulo('t1', '86700'), titulo('t2', '86710')];
        const boletos = [boleto('x1', '776166000'), boleto('x2', '776176000')];
        // t1 só é candidato de x2 (ex.: x1 fora do envelope de t1): o k-ésimo par não é aresta.
        const candidatos = new Map([
            ['t1', ['x2']],
            ['t2', ['x1', 'x2']],
        ]);
        expect(parear({ titulos, boletos, candidatos }).size).toBe(0);
    });
});

describe('AncoraOrdemDps — provas a partir dos DPS lidos (I15p)', () => {
    it('DPS lido que casa um boleto do pool (livre ou vinculado) prova o escopo do emissor', () => {
        const provas = ancora.provas(
            [{ pesCod: '386', nfse: '86666', dps: '776132' }],
            [
                { numero: '776132000', emissorChave: EMISSOR },
                { numero: '776138000', emissorChave: EMISSOR },
            ],
        );
        expect(provas).toEqual([PROVA]);
    });

    it('DPS lido sem boleto correspondente no pool não prova nada', () => {
        expect(
            ancora.provas(
                [{ pesCod: '386', nfse: '86666', dps: '776132' }],
                [{ numero: '776138000', emissorChave: EMISSOR }],
            ),
        ).toEqual([]);
    });

    it('DPS lido sem credor ou sem NFS-e não prova nada', () => {
        const pool = [{ numero: '776132000', emissorChave: EMISSOR }];
        expect(ancora.provas([{ nfse: '86666', dps: '776132' }], pool)).toEqual([]);
        expect(ancora.provas([{ pesCod: '386', dps: '776132' }], pool)).toEqual([]);
    });
});
