import 'reflect-metadata';
import { container } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type {
    ChavePixFavorecido,
    ContaFavorecido,
    DestinoManual,
    Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import DestinoPagamentoResolver, {
    DESTINO_ORIGEM,
    type FlagsDestino,
} from './DestinoPagamentoResolver.js';

const ITAU = 341;

const conta = (over: Partial<ContaFavorecido> = {}): ContaFavorecido => ({
    pctCodSeq: 10,
    banco: 237,
    agencia: '1234',
    conta: '87654321',
    dvConta: '0',
    padrao: false,
    ...over,
});
const chave = (over: Partial<ChavePixFavorecido> = {}): ChavePixFavorecido => ({
    cixCod: 5,
    chave: 'fornecedor@empresa.com.br',
    tipo: 'EMAIL',
    padrao: false,
    pesCod: '77',
    ...over,
});
const MANUAL_CONTA: DestinoManual = {
    tipo: 'CONTA',
    bancoCod: '001',
    agencia: '4321',
    conta: '1122334',
    contaDv: '5',
    titularDocumento: '11144477735',
};
const MANUAL_PIX: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'ALEATORIA',
    chavePix: '123e4567-e89b-12d3-a456-426614174000',
    titularDocumento: '11144477735',
};

const TODAS: FlagsDestino = { ted: true, pix: true, destinoManual: true };
const NENHUMA: FlagsDestino = { ted: false, pix: false, destinoManual: false };

const build = (
    contas: ContaFavorecido[] = [],
    chaves: ChavePixFavorecido[] = [],
    documento: string | undefined = undefined,
) => {
    const sispag = {
        listContasFavorecido: jest.fn().mockResolvedValue(contas),
        listChavesPixFavorecido: jest.fn().mockResolvedValue(chaves),
        getDocumentoFavorecido: jest.fn().mockResolvedValue(documento),
    };
    const resolver = new DestinoPagamentoResolver(
        sispag as unknown as ConexosSispagClient,
        new MaskDestino(),
    );
    return { sispag, resolver };
};

const ctx = (flags: FlagsDestino, over: Record<string, unknown> = {}) => ({
    flags,
    febrabanLote: ITAU,
    filCod: 1,
    pesCod: '77',
    ...over,
});
const item = (modalidade: Modalidade, destinoManual?: DestinoManual) => ({
    modalidade,
    ...(destinoManual ? { destinoManual } : {}),
});

describe('DestinoPagamentoResolver — TED (flag ligada, I10c)', () => {
    it('caso 1: lote Itaú, favorecido só com conta no Bradesco → resolve pelo cadastro', async () => {
        const { resolver } = build([conta({ banco: 237, pctCodSeq: 42 })]);
        const r = await resolver.resolve(item('TED'), ctx(TODAS));
        expect(r).toMatchObject({ origem: DESTINO_ORIGEM.CADASTRO, tipo: 'CONTA' });
        expect(r.origem === 'CADASTRO' && r.tipo === 'CONTA' && r.conta.pctCodSeq).toBe(42);
    });

    it('caso 2: duas contas ativas → a default', async () => {
        // O client já devolve default primeiro; o resolver não reordena por banco.
        const { resolver } = build([
            conta({ pctCodSeq: 2, padrao: true, banco: 1 }),
            conta({ pctCodSeq: 1, banco: ITAU }),
        ]);
        const r = await resolver.resolve(item('TED'), ctx(TODAS));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CONTA' && r.conta.pctCodSeq).toBe(2);
    });

    it('caso 3: só conta inativa (o client já a filtrou) → nenhum', async () => {
        const { resolver } = build([]);
        expect((await resolver.resolve(item('TED'), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });
});

describe('DestinoPagamentoResolver — flags desligadas = regra do main', () => {
    it('TED com flag desligada: só conta NO BANCO do lote', async () => {
        const { resolver } = build([conta({ banco: 237 })]);
        expect((await resolver.resolve(item('TED'), ctx(NENHUMA))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );

        const noItau = build([
            conta({ banco: 237, pctCodSeq: 1 }),
            conta({ banco: ITAU, pctCodSeq: 9 }),
        ]);
        const r = await noItau.resolver.resolve(item('TED'), ctx(NENHUMA));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CONTA' && r.conta.pctCodSeq).toBe(9);
    });

    it('no banco do lote a default vence, como no main', async () => {
        const { resolver } = build([
            conta({ banco: ITAU, pctCodSeq: 1 }),
            conta({ banco: ITAU, pctCodSeq: 2, padrao: true }),
        ]);
        const r = await resolver.resolve(item('TED'), ctx(NENHUMA));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CONTA' && r.conta.pctCodSeq).toBe(2);
    });

    it('PIX com flag desligada NUNCA resolve por chave (cai na regra de conta do main)', async () => {
        const { resolver, sispag } = build([], [chave()]);
        expect((await resolver.resolve(item('PIX'), ctx(NENHUMA))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
        expect(sispag.listChavesPixFavorecido).not.toHaveBeenCalled();
    });

    it('crédito em conta (legado) segue a regra do main mesmo com as flags ligadas', async () => {
        const { resolver } = build([conta({ banco: 237 })]);
        expect((await resolver.resolve(item('CREDITO_CONTA'), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });

    it('destino manual persistido é IGNORADO com a flag manual desligada', async () => {
        const { resolver } = build([]);
        const r = await resolver.resolve(
            item('TED', MANUAL_CONTA),
            ctx({ ...TODAS, destinoManual: false }),
        );
        expect(r.origem).toBe(DESTINO_ORIGEM.NENHUM);
    });
});

describe('DestinoPagamentoResolver — precedência do manual (ADR-0054 D2)', () => {
    it('manual vence o cadastro', async () => {
        const { resolver } = build([conta({ banco: 237 })]);
        const r = await resolver.resolve(item('TED', MANUAL_CONTA), ctx(TODAS));
        expect(r).toEqual({ origem: DESTINO_ORIGEM.MANUAL, destino: MANUAL_CONTA });
    });

    it('manual CONTA não serve para PIX, nem manual CHAVE_PIX para TED', async () => {
        const { resolver } = build([], []);
        expect((await resolver.resolve(item('PIX', MANUAL_CONTA), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
        expect((await resolver.resolve(item('TED', MANUAL_PIX), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });

    it('manual CONTA exige também a flag TED; manual PIX, a flag PIX', async () => {
        const { resolver } = build([], []);
        expect(
            (await resolver.resolve(item('TED', MANUAL_CONTA), ctx({ ...TODAS, ted: false })))
                .origem,
        ).toBe(DESTINO_ORIGEM.NENHUM);
        expect(
            (await resolver.resolve(item('PIX', MANUAL_PIX), ctx({ ...TODAS, pix: false }))).origem,
        ).toBe(DESTINO_ORIGEM.NENHUM);
    });
});

describe('DestinoPagamentoResolver — PIX (flag ligada, I10d)', () => {
    it('caso 5: chave ativa default primeiro', async () => {
        const { resolver } = build([], [chave({ cixCod: 9, padrao: true }), chave({ cixCod: 5 })]);
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CHAVE_PIX' && r.chave.cixCod).toBe(9);
    });

    it('caso 6: sem chave e sem manual → nenhum (conta no cadastro não serve para PIX)', async () => {
        const { resolver } = build([conta()], []);
        expect((await resolver.resolve(item('PIX'), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });

    it('manual PIX vence a chave do cadastro', async () => {
        const { resolver } = build([], [chave()]);
        const r = await resolver.resolve(item('PIX', MANUAL_PIX), ctx(TODAS));
        expect(r.origem).toBe(DESTINO_ORIGEM.MANUAL);
    });
});

describe('DestinoPagamentoResolver — D12: chave CPF/CNPJ do favorecido antes da default', () => {
    const DOC = '11144477735';
    const cpfDoFavorecido = chave({ cixCod: 7, tipo: 'CPF_CNPJ', chave: '111.444.777-35' });

    it('CPF/CNPJ igual ao documento vence a default e vem marcada', async () => {
        const { resolver } = build([], [chave({ cixCod: 9, padrao: true }), cpfDoFavorecido], DOC);
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r).toMatchObject({
            origem: 'CADASTRO',
            tipo: 'CHAVE_PIX',
            chave: { cixCod: 7 },
            chaveDoDocumentoDoFavorecido: true,
        });
    });

    it('CPF/CNPJ de OUTRO documento não sobe: vale a default, sem marca', async () => {
        const { resolver } = build(
            [],
            [
                chave({ cixCod: 9, padrao: true }),
                chave({ cixCod: 7, tipo: 'CPF_CNPJ', chave: '52998224725' }),
            ],
            DOC,
        );
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CHAVE_PIX' && r.chave.cixCod).toBe(9);
        expect(r).not.toHaveProperty('chaveDoDocumentoDoFavorecido');
    });

    it('documento indisponível: ordem de antes (default primeiro)', async () => {
        const { resolver } = build(
            [],
            [chave({ cixCod: 9, padrao: true }), cpfDoFavorecido],
            undefined,
        );
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CHAVE_PIX' && r.chave.cixCod).toBe(9);
    });

    it('sem chave CPF/CNPJ no cadastro, o documento nem é lido', async () => {
        const { resolver, sispag } = build([], [chave({ cixCod: 9, padrao: true })], DOC);
        await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(sispag.getDocumentoFavorecido).not.toHaveBeenCalled();
    });

    it('flag PIX desligada: nada de chave nem documento (regra do main)', async () => {
        const { resolver, sispag } = build([], [cpfDoFavorecido], DOC);
        await resolver.resolve(item('PIX'), ctx(NENHUMA));
        expect(sispag.getDocumentoFavorecido).not.toHaveBeenCalled();
        expect(sispag.listChavesPixFavorecido).not.toHaveBeenCalled();
    });

    it('o documento entra no cache do fluxo (lido uma vez por favorecido)', async () => {
        const { resolver, sispag } = build([], [cpfDoFavorecido], DOC);
        const cache = resolver.novoCache();
        await resolver.resolve(item('PIX'), ctx(TODAS, { cache }));
        await resolver.resolve(item('PIX'), ctx(TODAS, { cache }));
        expect(sispag.getDocumentoFavorecido).toHaveBeenCalledTimes(1);
    });
});

describe('DestinoPagamentoResolver — bordas', () => {
    it('boleto e "a definir" não têm destino de conta (sem leitura)', async () => {
        const { resolver, sispag } = build([conta()], [chave()]);
        expect((await resolver.resolve(item('BOLETO'), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
        expect((await resolver.resolve({}, ctx(TODAS))).origem).toBe(DESTINO_ORIGEM.NENHUM);
        expect(sispag.listContasFavorecido).not.toHaveBeenCalled();
    });

    it('sem pesCod → nenhum, sem ida ao ERP', async () => {
        const { resolver, sispag } = build([conta()]);
        expect(
            (await resolver.resolve(item('TED'), ctx(TODAS, { pesCod: undefined }))).origem,
        ).toBe(DESTINO_ORIGEM.NENHUM);
        expect(sispag.listContasFavorecido).not.toHaveBeenCalled();
    });

    it('cache do contexto: o mesmo favorecido é lido uma vez só', async () => {
        const { resolver, sispag } = build([conta()], [chave()]);
        const cache = resolver.novoCache();
        await resolver.resolve(item('TED'), ctx(TODAS, { cache }));
        await resolver.resolve(item('TED'), ctx(TODAS, { cache }));
        await resolver.resolve(item('PIX'), ctx(TODAS, { cache }));
        await resolver.resolve(item('PIX'), ctx(TODAS, { cache }));
        expect(sispag.listContasFavorecido).toHaveBeenCalledTimes(1);
        expect(sispag.listChavesPixFavorecido).toHaveBeenCalledTimes(1);
    });

    it('mascarar devolve só a máscara do destino resolvido', async () => {
        const { resolver } = build([conta()], [chave()]);
        const ted = await resolver.resolve(item('TED'), ctx(TODAS));
        const pix = await resolver.resolve(item('PIX'), ctx(TODAS));
        const manual = await resolver.resolve(item('TED', MANUAL_CONTA), ctx(TODAS));
        expect(resolver.mascarar(ted)).toBe('banco 237 · ag. 1234 · cc ****4321-0');
        expect(resolver.mascarar(pix)).toBe('PIX e-mail f***@empresa.com.br');
        expect(resolver.mascarar(manual)).toBe('banco 001 · ag. 4321 · cc ****2334-5');
        expect(resolver.mascarar({ origem: DESTINO_ORIGEM.NENHUM })).toBeUndefined();
    });
});

describe('DestinoPagamentoResolver — uma instância só (I10b)', () => {
    it('é singleton: oferta (painel) e envio (remessa) recebem a MESMA instância', () => {
        container.registerInstance(ConexosSispagClient, {} as never);
        const a = container.resolve(DestinoPagamentoResolver);
        const b = container.resolve(DestinoPagamentoResolver);
        expect(a).toBe(b);
        container.clearInstances();
    });
});
