import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import {
    type ChavePixFavorecido,
    type ContaFavorecido,
    DESTINO_MANUAL_TIPO,
    type DestinoManual,
    MODALIDADE,
    type Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';

/** De onde veio o destino resolvido de um item. Constantes tipadas — nunca string crua. */
export const DESTINO_ORIGEM = {
    CADASTRO: 'CADASTRO',
    MANUAL: 'MANUAL',
    NENHUM: 'NENHUM',
} as const;

export type DestinoOrigem = (typeof DESTINO_ORIGEM)[keyof typeof DESTINO_ORIGEM];

/** O que o resolver lê das flags (ADR-0054, Adendo). Vem do `EnvironmentProvider`, nunca daqui. */
export interface FlagsDestino {
    ted: boolean;
    pix: boolean;
    destinoManual: boolean;
}

/** Tipo do destino do cadastro: conta (`ctcorr`, via `pctCodSeq`) ou chave (`cmnPessoasPix`). */
export const DESTINO_CADASTRO_TIPO = { CONTA: 'CONTA', CHAVE_PIX: 'CHAVE_PIX' } as const;

export type DestinoResolvido =
    | { origem: typeof DESTINO_ORIGEM.NENHUM }
    | {
          origem: typeof DESTINO_ORIGEM.CADASTRO;
          tipo: typeof DESTINO_CADASTRO_TIPO.CONTA;
          conta: ContaFavorecido;
      }
    | {
          origem: typeof DESTINO_ORIGEM.CADASTRO;
          tipo: typeof DESTINO_CADASTRO_TIPO.CHAVE_PIX;
          chave: ChavePixFavorecido;
      }
    | { origem: typeof DESTINO_ORIGEM.MANUAL; destino: DestinoManual };

/**
 * Memo das leituras do cadastro por favorecido, compartilhado entre chamadas do MESMO fluxo
 * (a oferta de um lote repete favorecido; o envio também). Não é cache entre requisições.
 */
export type CacheCadastroDestino = Map<string, Promise<unknown>>;

export interface ContextoDestino {
    flags: FlagsDestino;
    /** FEBRABAN do banco do lote — só a regra antiga (flag TED desligada) usa. */
    febrabanLote: number;
    filCod: number;
    /** Favorecido do título. Ausente = nada a ler, destino do cadastro não existe. */
    pesCod?: string;
    cache?: CacheCadastroDestino;
}

export interface ItemParaDestino {
    modalidade?: Modalidade;
    destinoManual?: DestinoManual;
}

const NENHUM: DestinoResolvido = { origem: DESTINO_ORIGEM.NENHUM };

/**
 * DestinoPagamentoResolver — a ÚNICA regra de destino de TED/PIX (ADR-0054, I10b "oferta =
 * envio"). O painel pergunta "posso oferecer TED/PIX?" e o envio pergunta "para onde vai?" com
 * o MESMO `resolve`. Duas regras diferentes era o bug que originou o tweak.
 *
 * ```
 * destino(item) =
 *     destinoManual (flag manual + flag da modalidade)       → MANUAL   (vence o cadastro, D2)
 *     TED  (flag TED):  conta ativa em QUALQUER banco, default 1º → CADASTRO (I10c)
 *     PIX  (flag PIX):  chave ativa do cmnPessoasPix, default 1º  → CADASTRO (I10d)
 *     senão (flag da modalidade desligada, ou CRÉDITO EM CONTA legado):
 *          regra do `main` — conta ativa NO BANCO DO LOTE, default 1º
 *     nada → NENHUM
 * ```
 *
 * A regra do `main` com a flag desligada é deliberada: com as três flags desligadas o envio tem
 * de ser idêntico ao de antes (Adendo). Isso vale também para PIX: sem a flag, PIX nunca resolve
 * por CHAVE — cai na conta do banco do lote, como o `main` fazia.
 *
 * Não valida titularidade nem formato (isso é do `DestinoManualValidator`) e não escreve nada.
 */
@injectable()
export default class DestinoPagamentoResolver {
    public constructor(
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(MaskDestino) private readonly mask: MaskDestino,
    ) {}

    public novoCache = (): CacheCadastroDestino => new Map();

    public resolve = async (
        item: ItemParaDestino,
        contexto: ContextoDestino,
    ): Promise<DestinoResolvido> => {
        const { modalidade } = item;
        if (
            modalidade !== MODALIDADE.TED &&
            modalidade !== MODALIDADE.PIX &&
            modalidade !== MODALIDADE.CREDITO_CONTA
        ) {
            return NENHUM;
        }
        const { flags } = contexto;

        const manual = this.manualAplicavel(item, flags);
        if (manual) return { origem: DESTINO_ORIGEM.MANUAL, destino: manual };

        if (modalidade === MODALIDADE.TED && flags.ted) {
            const contas = await this.contas(contexto);
            const escolhida = contas[0];
            return escolhida
                ? {
                      origem: DESTINO_ORIGEM.CADASTRO,
                      tipo: DESTINO_CADASTRO_TIPO.CONTA,
                      conta: escolhida,
                  }
                : NENHUM;
        }
        if (modalidade === MODALIDADE.PIX && flags.pix) {
            const chaves = await this.chaves(contexto);
            const escolhida = chaves[0];
            return escolhida
                ? {
                      origem: DESTINO_ORIGEM.CADASTRO,
                      tipo: DESTINO_CADASTRO_TIPO.CHAVE_PIX,
                      chave: escolhida,
                  }
                : NENHUM;
        }
        return this.regraDoMain(contexto);
    };

    /** Máscara do destino resolvido (I10h) — `undefined` quando não há destino. */
    public mascarar = (resolvido: DestinoResolvido): string | undefined => {
        switch (resolvido.origem) {
            case DESTINO_ORIGEM.MANUAL:
                return this.mask.destinoManual(resolvido.destino);
            case DESTINO_ORIGEM.CADASTRO:
                return resolvido.tipo === DESTINO_CADASTRO_TIPO.CONTA
                    ? this.mask.contaFavorecido(resolvido.conta)
                    : this.mask.chavePixRotulada(resolvido.chave.tipo, resolvido.chave.chave);
            default:
                return undefined;
        }
    };

    /**
     * O destino manual só vale com a flag manual E a flag da modalidade que ele serve: conta
     * para TED, chave para PIX. Flag desligada = o valor persistido é ignorado (nem oferta, nem
     * envio).
     */
    private manualAplicavel = (
        item: ItemParaDestino,
        flags: FlagsDestino,
    ): DestinoManual | undefined => {
        const d = item.destinoManual;
        if (!d || !flags.destinoManual) return undefined;
        if (
            d.tipo === DESTINO_MANUAL_TIPO.CONTA &&
            item.modalidade === MODALIDADE.TED &&
            flags.ted
        ) {
            return d;
        }
        if (
            d.tipo === DESTINO_MANUAL_TIPO.CHAVE_PIX &&
            item.modalidade === MODALIDADE.PIX &&
            flags.pix
        ) {
            return d;
        }
        return undefined;
    };

    /** Regra de antes do tweak: conta ativa no banco do lote, a default primeiro. */
    private regraDoMain = async (contexto: ContextoDestino): Promise<DestinoResolvido> => {
        const noBanco = (await this.contas(contexto)).filter(
            (c) => c.banco === contexto.febrabanLote,
        );
        const escolhida = noBanco.find((c) => c.padrao) ?? noBanco[0];
        return escolhida
            ? {
                  origem: DESTINO_ORIGEM.CADASTRO,
                  tipo: DESTINO_CADASTRO_TIPO.CONTA,
                  conta: escolhida,
              }
            : NENHUM;
    };

    private contas = (contexto: ContextoDestino): Promise<ContaFavorecido[]> => {
        const { pesCod, filCod } = contexto;
        if (!pesCod) return Promise.resolve([]);
        return this.memo(contexto, `contas:${filCod}:${pesCod}`, () =>
            this.sispag.listContasFavorecido(pesCod, filCod),
        );
    };

    private chaves = (contexto: ContextoDestino): Promise<ChavePixFavorecido[]> => {
        const { pesCod, filCod } = contexto;
        if (!pesCod) return Promise.resolve([]);
        return this.memo(contexto, `chaves:${filCod}:${pesCod}`, () =>
            this.sispag.listChavesPixFavorecido(pesCod, filCod),
        );
    };

    private memo = <T>(
        contexto: ContextoDestino,
        chave: string,
        ler: () => Promise<T>,
    ): Promise<T> => {
        const cache = contexto.cache;
        if (!cache) return ler();
        const existente = cache.get(chave) as Promise<T> | undefined;
        if (existente) return existente;
        const lendo = ler();
        cache.set(chave, lendo);
        return lendo;
    };
}
