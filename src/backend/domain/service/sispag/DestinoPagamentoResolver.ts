import { inject, injectable, singleton } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import {
    CHAVE_PIX_TIPO,
    type ChavePixFavorecido,
    type ContaFavorecido,
    DESTINO_MANUAL_TIPO,
    type DestinoManual,
    type DestinoManualTipo,
    type ExcecaoDestino,
    MODALIDADE,
    type Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import Logger from '../../libs/logger/Logger.js';
import { redactErrorMessage } from '../../libs/redact/redactErrorMessage.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import ExcecaoSubstituicaoService from './ExcecaoSubstituicaoService.js';

/** De onde veio o destino resolvido de um item. Constantes tipadas — nunca string crua. */
export const DESTINO_ORIGEM = {
    CADASTRO: 'CADASTRO',
    /** `ExcecaoDestino` APROVADA, só como fallback de um cadastro sem destino válido (ADR-0061). */
    EXCECAO: 'EXCECAO',
    NENHUM: 'NENHUM',
} as const;

export type DestinoOrigem = (typeof DESTINO_ORIGEM)[keyof typeof DESTINO_ORIGEM];

/** O que o resolver lê das flags (ADR-0054, ADR-0061). Vem do `EnvironmentProvider`, nunca daqui. */
export interface FlagsDestino {
    ted: boolean;
    pix: boolean;
    /** `SISPAG_EXCECAO_DESTINO_ENABLED` (alias `SISPAG_DESTINO_MANUAL_ENABLED`). */
    excecao: boolean;
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
      }
    | {
          origem: typeof DESTINO_ORIGEM.EXCECAO;
          /** Id da exceção usada: o que o ledger e o item gravam no lugar do valor (I10f). */
          excecaoId: string;
          destino: DestinoManual;
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
    /**
     * `true` só no finalizar/envio (ADR-0061 I12c): cadastro com destino válido + exceção APROVADA
     * do favorecido = a exceção é aposentada na hora (`SUBSTITUIDA`, nunca usada). O painel NÃO
     * liga isto: oferecer modalidade é leitura e não escreve.
     */
    aposentarExcecao?: boolean;
}

export interface ItemParaDestino {
    modalidade?: Modalidade;
}

const NENHUM: DestinoResolvido = { origem: DESTINO_ORIGEM.NENHUM };

/**
 * DestinoPagamentoResolver — a ÚNICA regra de destino de TED/PIX (ADR-0054, I10b "oferta =
 * envio"). O painel pergunta "posso oferecer TED/PIX?" e o envio pergunta "para onde vai?" com
 * o MESMO `resolve`. Duas regras diferentes era o bug que originou o tweak.
 *
 * ```
 * destino(item) =
 *     1. cadastro (cmn025, AO VIVO — a mesma leitura da oferta e do envio):
 *        TED  (flag TED):  conta ativa em QUALQUER banco, default 1º → CADASTRO (I10c)
 *        PIX  (flag PIX):  chave ativa do cmnPessoasPix               → CADASTRO (I10d)
 *                          ordem: CPF/CNPJ = documento do favorecido (D12), depois default, depois
 *                          as demais. Documento indisponível = ordem de antes (default 1º).
 *     2. senão, ExcecaoDestino APROVADA do favorecido, do tipo da modalidade
 *        (CONTA p/ TED, CHAVE_PIX p/ PIX; flag de exceção ligada)    → EXCECAO (ADR-0061 I12)
 *     3. senão (flag da modalidade desligada, ou CRÉDITO EM CONTA legado):
 *          regra do `main` — conta ativa NO BANCO DO LOTE, default 1º
 *     nada → NENHUM
 * ```
 *
 * O CADASTRO VENCE: cadastro com destino válido nunca é substituído por exceção. Exceção
 * `PENDENTE`/`REJEITADA`/`REVOGADA`/`SUBSTITUIDA` nunca resolve (só a `APROVADA` existe para o
 * resolver: `findAprovada`). Com `aposentarExcecao`, a exceção APROVADA que o cadastro tornou
 * desnecessária vai a `SUBSTITUIDA` (I12c) — falha ao aposentar NUNCA bloqueia: segue o cadastro.
 *
 * A regra do `main` com a flag desligada é deliberada: com as três flags desligadas o envio tem
 * de ser idêntico ao de antes (Adendo). Isso vale também para PIX: sem a flag, PIX nunca resolve
 * por CHAVE — cai na conta do banco do lote, como o `main` fazia.
 *
 * Não valida titularidade nem formato (isso é do `DestinoManualValidator`) e não escreve nada.
 */
@singleton()
@injectable()
export default class DestinoPagamentoResolver {
    public constructor(
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(MaskDestino) private readonly mask: MaskDestino,
        @inject(ExcecaoDestinoRepository) private readonly excecoes: ExcecaoDestinoRepository,
        @inject(ExcecaoSubstituicaoService)
        private readonly substituicao: ExcecaoSubstituicaoService,
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
            if (!escolhida) return this.excecao(contexto, DESTINO_MANUAL_TIPO.CONTA);
            await this.cadastroVence(contexto, DESTINO_MANUAL_TIPO.CONTA, { contas });
            return {
                origem: DESTINO_ORIGEM.CADASTRO,
                tipo: DESTINO_CADASTRO_TIPO.CONTA,
                conta: escolhida,
            };
        }
        if (modalidade === MODALIDADE.PIX && flags.pix) {
            const { chaves, doDocumento } = await this.chavesEmOrdem(contexto);
            const escolhida = chaves[0];
            if (!escolhida) return this.excecao(contexto, DESTINO_MANUAL_TIPO.CHAVE_PIX);
            await this.cadastroVence(contexto, DESTINO_MANUAL_TIPO.CHAVE_PIX, { chaves });
            return {
                origem: DESTINO_ORIGEM.CADASTRO,
                tipo: DESTINO_CADASTRO_TIPO.CHAVE_PIX,
                chave: escolhida,
                ...(doDocumento.has(escolhida) ? { chaveDoDocumentoDoFavorecido: true } : {}),
            };
        }
        return this.regraDoMain(contexto);
    };

    /** Máscara do destino resolvido (I10h) — `undefined` quando não há destino. */
    public mascarar = (resolvido: DestinoResolvido): string | undefined => {
        switch (resolvido.origem) {
            case DESTINO_ORIGEM.EXCECAO:
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
     * Fallback (I12): o cadastro não tem destino válido para a modalidade. Só a exceção
     * `APROVADA` do (favorecido, tipo) resolve, e só com a flag de exceção ligada. Falha de leitura
     * sobe: quem oferta trata como "não oferece"; quem envia, como erro (falha fechada).
     */
    private excecao = async (
        contexto: ContextoDestino,
        tipo: DestinoManualTipo,
    ): Promise<DestinoResolvido> => {
        if (!contexto.flags.excecao) return NENHUM;
        const aprovada = await this.aprovada(contexto, tipo);
        return aprovada
            ? {
                  origem: DESTINO_ORIGEM.EXCECAO,
                  excecaoId: aprovada.id,
                  destino: aprovada.destino,
              }
            : NENHUM;
    };

    /**
     * I12c — o cadastro tem destino válido e há exceção APROVADA do mesmo (favorecido, tipo): a
     * exceção é aposentada (nunca usada). Só quando o fluxo pede (`aposentarExcecao`) e a flag está
     * ligada; qualquer falha aqui é registrada e IGNORADA, porque o destino do cadastro já está
     * resolvido e é o seguro.
     */
    private cadastroVence = async (
        contexto: ContextoDestino,
        tipo: DestinoManualTipo,
        cadastro: { contas?: ContaFavorecido[]; chaves?: ChavePixFavorecido[] },
    ): Promise<void> => {
        if (!contexto.flags.excecao || contexto.aposentarExcecao !== true) return;
        try {
            const aprovada = await this.aprovada(contexto, tipo);
            if (aprovada) await this.substituicao.aposentar({ excecao: aprovada, cadastro });
        } catch (error) {
            Logger.warn(
                `[SISPAG] exceção de destino não aposentada para o favorecido ${contexto.pesCod}: ${redactErrorMessage(
                    error instanceof Error ? error.message : String(error),
                )}`,
            );
        }
    };

    private aprovada = (
        contexto: ContextoDestino,
        tipo: DestinoManualTipo,
    ): Promise<ExcecaoDestino | null> => {
        const { pesCod } = contexto;
        if (!pesCod) return Promise.resolve(null);
        return this.memo(contexto, `excecao:${pesCod}:${tipo}`, () =>
            this.excecoes.findAprovada(pesCod, tipo),
        );
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
