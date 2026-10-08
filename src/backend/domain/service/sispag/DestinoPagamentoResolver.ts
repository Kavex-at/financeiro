import { inject, injectable, singleton } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import {
    AUTHORIZED_PAYEE_MODALITY,
    type PayeeDestination,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import {
    CHAVE_PIX_TIPO,
    type ChavePixFavorecido,
    type ContaFavorecido,
    MODALIDADE,
    type Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';

/** De onde veio o destino resolvido de um item. Constantes tipadas — nunca string crua. */
export const DESTINO_ORIGEM = {
    CADASTRO: 'CADASTRO',
    NENHUM: 'NENHUM',
} as const;

export type DestinoOrigem = (typeof DESTINO_ORIGEM)[keyof typeof DESTINO_ORIGEM];

/** O que o resolver lê das flags (ADR-0054). Vem do `EnvironmentProvider`, nunca daqui. */
export interface FlagsDestino {
    ted: boolean;
    pix: boolean;
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
          /**
           * D12: a chave escolhida é do tipo CPF/CNPJ e é o PRÓPRIO documento do favorecido — a
           * única que o banco amarra ao favorecido. A tela sugere PIX antes de TED quando `true`.
           */
          chaveDoDocumentoDoFavorecido?: boolean;
      };

/**
 * Memo das leituras do cadastro por favorecido, compartilhado entre chamadas do MESMO fluxo
 * (a oferta de um lote repete favorecido; o envio também). Não é cache entre requisições.
 */
export type CacheCadastroDestino = Map<string, Promise<unknown>>;

export interface ContextoDestino {
    flags: FlagsDestino;
    /**
     * FEBRABAN do banco do lote — só a regra antiga (flag da modalidade desligada) usa. A oferta
     * não conhece o banco do lote e só pergunta por modalidades ligadas: ausente = regra antiga
     * não resolve nada.
     */
    febrabanLote?: number;
    filCod: number;
    /** Favorecido do título. Ausente = nada a ler, destino do cadastro não existe. */
    pesCod?: string;
    cache?: CacheCadastroDestino;
}

export interface ItemParaDestino {
    modalidade?: Modalidade;
}

const NENHUM: DestinoResolvido = { origem: DESTINO_ORIGEM.NENHUM };

/**
 * DestinoPagamentoResolver — a ÚNICA regra de destino de TED/PIX (ADR-0054, I10b "oferta =
 * envio"; ADR-0065 reescreveu I10: só o cadastro). O painel, a verificação, a autorização do
 * favorecido e o envio perguntam "para onde vai?" com o MESMO `resolve`.
 *
 * ```
 * destino(item) =
 *     cadastro (cmn025, AO VIVO):
 *        TED  (flag TED):  conta ativa em QUALQUER banco, default 1º → CADASTRO (I10c)
 *        PIX  (flag PIX):  chave ativa do cmnPessoasPix               → CADASTRO (I10d)
 *                          ordem I10k: CPF/CNPJ = documento do favorecido (D12), depois default,
 *                          depois as demais. Documento indisponível = default 1º.
 *     flag da modalidade desligada, ou CRÉDITO EM CONTA legado:
 *          regra do `main` — conta ativa NO BANCO DO LOTE, default 1º
 *     nada → NENHUM
 * ```
 *
 * Não há destino fora do cadastro (I14i): a `ExcecaoDestino` foi apagada pela ADR-0065. Quem
 * decide se o destino resolvido PODE receber é a guarda do favorecido autorizado (I14), sobre a
 * impressão de `destinoFavorecido`. Não valida titularidade e não escreve nada.
 */
@singleton()
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

        if (modalidade === MODALIDADE.TED && flags.ted) {
            const contas = await this.contas(contexto);
            const escolhida = contas[0];
            if (!escolhida) return NENHUM;
            return {
                origem: DESTINO_ORIGEM.CADASTRO,
                tipo: DESTINO_CADASTRO_TIPO.CONTA,
                conta: escolhida,
            };
        }
        if (modalidade === MODALIDADE.PIX && flags.pix) {
            const { chaves, doDocumento } = await this.chavesEmOrdem(contexto);
            const escolhida = chaves[0];
            if (!escolhida) return NENHUM;
            return {
                origem: DESTINO_ORIGEM.CADASTRO,
                tipo: DESTINO_CADASTRO_TIPO.CHAVE_PIX,
                chave: escolhida,
                ...(doDocumento.has(escolhida) ? { chaveDoDocumentoDoFavorecido: true } : {}),
            };
        }
        return this.regraDoMain(contexto);
    };

    /** Máscara do destino resolvido (I10h, I14l) — `undefined` quando não há destino. */
    public mascarar = (resolvido: DestinoResolvido): string | undefined => {
        const destino = this.destinoFavorecido(resolvido);
        return destino ? this.mask.destino(destino) : undefined;
    };

    /**
     * O destino resolvido na forma normalizável do favorecido autorizado (ADR-0065 I14b): o que a
     * impressão digital e a máscara recebem. USO INTERNO — nunca persistido, logado ou devolvido,
     * exceto pelo "revelar" auditado. `undefined` quando não há destino.
     */
    public destinoFavorecido = (resolvido: DestinoResolvido): PayeeDestination | undefined => {
        if (resolvido.origem !== DESTINO_ORIGEM.CADASTRO) return undefined;
        if (resolvido.tipo === DESTINO_CADASTRO_TIPO.CONTA) {
            const { conta } = resolvido;
            return {
                tipo: AUTHORIZED_PAYEE_MODALITY.TED,
                banco: String(conta.banco),
                ...(conta.agencia ? { agencia: conta.agencia } : {}),
                conta: conta.conta ?? '',
                ...(conta.dvConta ? { contaDv: conta.dvConta } : {}),
            };
        }
        return {
            tipo: AUTHORIZED_PAYEE_MODALITY.PIX,
            ...(resolvido.chave.tipo ? { chaveTipo: resolvido.chave.tipo } : {}),
            chave: resolvido.chave.chave,
        };
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

    /**
     * D12: entre as chaves ativas (já com a default primeiro, pelo client), as de tipo CPF/CNPJ
     * iguais ao documento do favorecido vêm antes. O documento só é lido quando existe alguma
     * chave CPF/CNPJ (sem ela a ordem não muda e nada novo é consultado). Documento ausente ou
     * inválido = ordem de antes. Falha de rede sobe, como a das chaves: quem oferta trata como
     * "não oferece"; quem envia, como erro.
     */
    private chavesEmOrdem = async (
        contexto: ContextoDestino,
    ): Promise<{ chaves: ChavePixFavorecido[]; doDocumento: ReadonlySet<ChavePixFavorecido> }> => {
        const chaves = await this.chaves(contexto);
        const cpfCnpj = chaves.filter((c) => c.tipo === CHAVE_PIX_TIPO.CPF_CNPJ);
        if (cpfCnpj.length === 0) return { chaves, doDocumento: new Set() };
        const documento = await this.documento(contexto);
        if (!documento) return { chaves, doDocumento: new Set() };
        const doDocumento = new Set(
            cpfCnpj.filter((c) => c.chave.replace(/\D/g, '') === documento),
        );
        if (doDocumento.size === 0) return { chaves, doDocumento };
        return {
            chaves: [
                ...chaves.filter((c) => doDocumento.has(c)),
                ...chaves.filter((c) => !doDocumento.has(c)),
            ],
            doDocumento,
        };
    };

    private documento = (contexto: ContextoDestino): Promise<string | undefined> => {
        const { pesCod, filCod } = contexto;
        if (!pesCod) return Promise.resolve(undefined);
        return this.memo(contexto, `documento:${filCod}:${pesCod}`, () =>
            this.sispag.getDocumentoFavorecido(pesCod, filCod),
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
