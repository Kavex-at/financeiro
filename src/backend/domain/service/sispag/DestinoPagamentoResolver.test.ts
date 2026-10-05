import 'reflect-metadata';
import { container } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type {
    ChavePixFavorecido,
    ContaFavorecido,
    DestinoManual,
    ExcecaoDestino,
    Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import DestinoPagamentoResolver, {
    DESTINO_ORIGEM,
    type FlagsDestino,
} from './DestinoPagamentoResolver.js';
import ExcecaoSubstituicaoService from './ExcecaoSubstituicaoService.js';

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
const EXC_CONTA: DestinoManual = {
    tipo: 'CONTA',
    bancoCod: '001',
    agencia: '4321',
    conta: '1122334',
    contaDv: '5',
    titularDocumento: '11144477735',
};
const EXC_PIX: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'CPF_CNPJ',
    chavePix: '11144477735',
    titularDocumento: '11144477735',
};

const TODAS: FlagsDestino = { ted: true, pix: true, excecao: true };
const NENHUMA: FlagsDestino = { ted: false, pix: false, excecao: false };

const excecaoAprovada = (destino: DestinoManual, id = 'EXC-1'): ExcecaoDestino => ({
    id,
    pesCod: '77',
    filCod: 1,
    destino,
    estado: 'APROVADA',
    origem: 'MANUAL',
    justificativa: 'cadastro desatualizado',
    cadastradoPor: 'ana',
    cadastradoEm: '2026-10-05T10:00:00.000Z',
    aprovadoPor: 'bia',
    versao: 2,
});

const build = (
    contas: ContaFavorecido[] = [],
    chaves: ChavePixFavorecido[] = [],
    documento: string | undefined = undefined,
    aprovadas: Partial<Record<'CONTA' | 'CHAVE_PIX', ExcecaoDestino>> = {},
) => {
    const sispag = {
        listContasFavorecido: jest.fn().mockResolvedValue(contas),
        listChavesPixFavorecido: jest.fn().mockResolvedValue(chaves),
        getDocumentoFavorecido: jest.fn().mockResolvedValue(documento),
    };
    const excecoes = {
        findAprovada: jest
            .fn()
            .mockImplementation(
                async (_pes: string, tipo: 'CONTA' | 'CHAVE_PIX') => aprovadas[tipo] ?? null,
            ),
    };
    const substituicao = {
        aposentar: jest.fn().mockResolvedValue({ aposentada: true, divergiu: false }),
    };
    const resolver = new DestinoPagamentoResolver(
        sispag as unknown as ConexosSispagClient,
        new MaskDestino(),
        excecoes as unknown as ExcecaoDestinoRepository,
        substituicao as unknown as ExcecaoSubstituicaoService,
    );
    return { sispag, resolver, excecoes, substituicao };
};

const ctx = (flags: FlagsDestino, over: Record<string, unknown> = {}) => ({
    flags,
    febrabanLote: ITAU,
    filCod: 1,
    pesCod: '77',
    ...over,
});
const item = (modalidade: Modalidade) => ({ modalidade });

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

    it('exceção APROVADA é IGNORADA com a flag de exceção desligada (paridade com o main)', async () => {
        const { resolver, excecoes } = build([], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA),
        });
        const r = await resolver.resolve(item('TED'), ctx({ ...TODAS, excecao: false }));
        expect(r.origem).toBe(DESTINO_ORIGEM.NENHUM);
        expect(excecoes.findAprovada).not.toHaveBeenCalled();
    });

    it('com as três flags desligadas nenhuma exceção é lida', async () => {
        const { resolver, excecoes } = build([conta({ banco: ITAU })], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA),
        });
        await resolver.resolve(item('TED'), ctx(NENHUMA));
        expect(excecoes.findAprovada).not.toHaveBeenCalled();
    });
});

describe('DestinoPagamentoResolver — cadastro primeiro, exceção APROVADA como fallback (ADR-0061)', () => {
    it('cadastro com conta ativa vence a exceção APROVADA (a exceção nunca é lida sem aposentar)', async () => {
        const { resolver, excecoes } = build(
            [conta({ banco: 237, pctCodSeq: 42 })],
            [],
            undefined,
            {
                CONTA: excecaoAprovada(EXC_CONTA),
            },
        );
        const r = await resolver.resolve(item('TED'), ctx(TODAS));
        expect(r).toMatchObject({ origem: DESTINO_ORIGEM.CADASTRO, tipo: 'CONTA' });
        expect(excecoes.findAprovada).not.toHaveBeenCalled();
    });

    it('TED sem conta ativa no cadastro usa a exceção CONTA APROVADA, com o id dela', async () => {
        const { resolver, excecoes } = build([], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA, 'EXC-9'),
        });
        const r = await resolver.resolve(item('TED'), ctx(TODAS));
        expect(r).toEqual({
            origem: DESTINO_ORIGEM.EXCECAO,
            excecaoId: 'EXC-9',
            destino: EXC_CONTA,
        });
        expect(excecoes.findAprovada).toHaveBeenCalledWith('77', 'CONTA');
    });

    it('PIX sem chave ativa no cadastro usa a exceção CHAVE_PIX APROVADA (e só ela)', async () => {
        const { resolver, excecoes } = build([conta()], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA, 'EXC-CONTA'),
            CHAVE_PIX: excecaoAprovada(EXC_PIX, 'EXC-PIX'),
        });
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r).toMatchObject({ origem: DESTINO_ORIGEM.EXCECAO, excecaoId: 'EXC-PIX' });
        expect(excecoes.findAprovada).toHaveBeenCalledWith('77', 'CHAVE_PIX');
    });

    it('exceção CONTA não serve para PIX, nem exceção CHAVE_PIX para TED', async () => {
        const so = (tipo: 'CONTA' | 'CHAVE_PIX', d: DestinoManual) =>
            build([], [], undefined, { [tipo]: excecaoAprovada(d) });
        expect(
            (await so('CONTA', EXC_CONTA).resolver.resolve(item('PIX'), ctx(TODAS))).origem,
        ).toBe(DESTINO_ORIGEM.NENHUM);
        expect(
            (await so('CHAVE_PIX', EXC_PIX).resolver.resolve(item('TED'), ctx(TODAS))).origem,
        ).toBe(DESTINO_ORIGEM.NENHUM);
    });

    it('só a APROVADA existe para o resolver: sem aprovada (PENDENTE/REJEITADA/REVOGADA/SUBSTITUIDA) → NENHUM', async () => {
        // O repositório só devolve a APROVADA (`findAprovada`); null = nada a resolver.
        const { resolver } = build([], [], undefined, {});
        expect((await resolver.resolve(item('TED'), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });

    it('exceção exige também a flag da modalidade (TED p/ conta, PIX p/ chave)', async () => {
        const { resolver } = build([], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA),
            CHAVE_PIX: excecaoAprovada(EXC_PIX),
        });
        expect((await resolver.resolve(item('TED'), ctx({ ...TODAS, ted: false }))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
        expect((await resolver.resolve(item('PIX'), ctx({ ...TODAS, pix: false }))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });

    it('sem pesCod a exceção não é procurada', async () => {
        const { resolver, excecoes } = build([], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA),
        });
        const r = await resolver.resolve(item('TED'), ctx(TODAS, { pesCod: undefined }));
        expect(r.origem).toBe(DESTINO_ORIGEM.NENHUM);
        expect(excecoes.findAprovada).not.toHaveBeenCalled();
    });

    it('falha ao ler a exceção sobe (falha fechada: o painel trata como "não oferece")', async () => {
        const { resolver, excecoes } = build();
        excecoes.findAprovada.mockRejectedValue(new Error('banco fora'));
        await expect(resolver.resolve(item('TED'), ctx(TODAS))).rejects.toThrow('banco fora');
    });

    describe('I12c — cadastro válido aposenta a exceção APROVADA (só quando pedido)', () => {
        it('com aposentarExcecao: cadastro + aprovada → SUBSTITUIDA, e o destino é o do cadastro', async () => {
            const contaCadastro = conta({ banco: 237, pctCodSeq: 42 });
            const aprovada = excecaoAprovada(EXC_CONTA);
            const { resolver, substituicao } = build([contaCadastro], [], undefined, {
                CONTA: aprovada,
            });
            const r = await resolver.resolve(item('TED'), ctx(TODAS, { aposentarExcecao: true }));
            expect(r).toMatchObject({ origem: DESTINO_ORIGEM.CADASTRO, tipo: 'CONTA' });
            expect(substituicao.aposentar).toHaveBeenCalledWith({
                excecao: aprovada,
                cadastro: { contas: [contaCadastro] },
            });
        });

        it('PIX: passa as chaves do cadastro para a comparação', async () => {
            const chaveCadastro = chave({ cixCod: 3 });
            const aprovada = excecaoAprovada(EXC_PIX);
            const { resolver, substituicao } = build([], [chaveCadastro], undefined, {
                CHAVE_PIX: aprovada,
            });
            await resolver.resolve(item('PIX'), ctx(TODAS, { aposentarExcecao: true }));
            expect(substituicao.aposentar).toHaveBeenCalledWith({
                excecao: aprovada,
                cadastro: { chaves: [chaveCadastro] },
            });
        });

        it('sem aposentarExcecao (painel/oferta) NADA é escrito nem lido', async () => {
            const { resolver, substituicao, excecoes } = build([conta()], [], undefined, {
                CONTA: excecaoAprovada(EXC_CONTA),
            });
            await resolver.resolve(item('TED'), ctx(TODAS));
            expect(substituicao.aposentar).not.toHaveBeenCalled();
            expect(excecoes.findAprovada).not.toHaveBeenCalled();
        });

        it('sem exceção aprovada: nada a aposentar', async () => {
            const { resolver, substituicao } = build([conta()]);
            await resolver.resolve(item('TED'), ctx(TODAS, { aposentarExcecao: true }));
            expect(substituicao.aposentar).not.toHaveBeenCalled();
        });

        it('falha ao aposentar NÃO bloqueia: segue o destino do cadastro', async () => {
            const { resolver, substituicao } = build([conta({ pctCodSeq: 8 })], [], undefined, {
                CONTA: excecaoAprovada(EXC_CONTA),
            });
            substituicao.aposentar.mockRejectedValue(new Error('banco fora'));
            const r = await resolver.resolve(item('TED'), ctx(TODAS, { aposentarExcecao: true }));
            expect(r.origem === 'CADASTRO' && r.tipo === 'CONTA' && r.conta.pctCodSeq).toBe(8);
        });

        it('a exceção é lida uma vez por favorecido no cache do fluxo', async () => {
            const { resolver, excecoes } = build([conta()], [], undefined, {
                CONTA: excecaoAprovada(EXC_CONTA),
            });
            const cache = resolver.novoCache();
            await resolver.resolve(item('TED'), ctx(TODAS, { cache, aposentarExcecao: true }));
            await resolver.resolve(item('TED'), ctx(TODAS, { cache, aposentarExcecao: true }));
            expect(excecoes.findAprovada).toHaveBeenCalledTimes(1);
        });
    });
});

describe('DestinoPagamentoResolver — PIX (flag ligada, I10d)', () => {
    it('caso 5: chave ativa default primeiro', async () => {
        const { resolver } = build([], [chave({ cixCod: 9, padrao: true }), chave({ cixCod: 5 })]);
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r.origem === 'CADASTRO' && r.tipo === 'CHAVE_PIX' && r.chave.cixCod).toBe(9);
    });

    it('caso 6: sem chave e sem exceção → nenhum (conta no cadastro não serve para PIX)', async () => {
        const { resolver } = build([conta()], []);
        expect((await resolver.resolve(item('PIX'), ctx(TODAS))).origem).toBe(
            DESTINO_ORIGEM.NENHUM,
        );
    });

    it('chave do cadastro vence a exceção PIX APROVADA', async () => {
        const { resolver } = build([], [chave()], undefined, {
            CHAVE_PIX: excecaoAprovada(EXC_PIX),
        });
        const r = await resolver.resolve(item('PIX'), ctx(TODAS));
        expect(r.origem).toBe(DESTINO_ORIGEM.CADASTRO);
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
        const { resolver: semCadastro } = build([], [], undefined, {
            CONTA: excecaoAprovada(EXC_CONTA),
        });
        const excecao = await semCadastro.resolve(item('TED'), ctx(TODAS));
        expect(resolver.mascarar(ted)).toBe('banco 237 · ag. 1234 · cc ****4321-0');
        expect(resolver.mascarar(pix)).toBe('PIX e-mail f***@empresa.com.br');
        expect(resolver.mascarar(excecao)).toBe('banco 001 · ag. 4321 · cc ****2334-5');
        expect(resolver.mascarar({ origem: DESTINO_ORIGEM.NENHUM })).toBeUndefined();
    });
});

describe('DestinoPagamentoResolver — uma instância só (I10b)', () => {
    it('é singleton: oferta (painel) e envio (remessa) recebem a MESMA instância', () => {
        container.registerInstance(ConexosSispagClient, {} as never);
        container.registerInstance(ExcecaoDestinoRepository, {} as never);
        container.registerInstance(ExcecaoSubstituicaoService, {} as never);
        const a = container.resolve(DestinoPagamentoResolver);
        const b = container.resolve(DestinoPagamentoResolver);
        expect(a).toBe(b);
        container.clearInstances();
    });
});
