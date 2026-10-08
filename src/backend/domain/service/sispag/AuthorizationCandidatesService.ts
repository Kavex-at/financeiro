import { inject, injectable } from 'tsyringe';
import {
    AUTHORIZED_PAYEE_MODALITY,
    type AuthorizedPayeeModality,
    type AuthorizedPayeeState,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import type {
    ChannelConfidence,
    ChannelGroup,
    ChannelProfile,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AuthorizedPayeeRepository from '../../repository/sispag/AuthorizedPayeeRepository.js';
import PerfilCanalFornecedorRepository from '../../repository/sispag/PerfilCanalFornecedorRepository.js';
import VerificacaoEventoRepository, {
    type RetiradoSemDado,
} from '../../repository/sispag/VerificacaoEventoRepository.js';
import DestinoPagamentoResolver, {
    type CacheCadastroDestino,
    DESTINO_ORIGEM,
} from './DestinoPagamentoResolver.js';

/** O que o cadastro tem para a modalidade: dado, sem dado, ou não deu para ler. */
export const CADASTRO_TEM = { SIM: 'SIM', NAO: 'NAO', FALHA_LEITURA: 'FALHA_LEITURA' } as const;

export type CadastroTem = (typeof CADASTRO_TEM)[keyof typeof CADASTRO_TEM];

/** Estado da autorização na linha: o vigente, ou nenhuma. */
export type EstadoAutorizacaoLinha = AuthorizedPayeeState | 'NENHUMA';

export interface CandidatoAutorizacao {
    pesCod: string;
    credor?: string;
    grupoDominante: ChannelGroup;
    participacao: number;
    pagamentos: number;
    pagamentosTedPix: number;
    meses: number;
    confianca: ChannelConfidence;
    /** Tem conta (TED) / chave (PIX) no `cmn025`? Lido ao vivo, com cache por favorecido. */
    cadastro: Record<AuthorizedPayeeModality, CadastroTem>;
    autorizacao: Record<AuthorizedPayeeModality, { estado: EstadoAutorizacaoLinha; id?: string }>;
}

export interface RelatorioCandidatos {
    candidatos: CandidatoAutorizacao[];
    total: number;
    pagina: number;
    limite: number;
    retiradosSemDado: RetiradoSemDado[];
}

/** Quantos retirados por falta de dado a seção mostra. */
const RETIRADOS_LIMITE = 100;

/**
 * AuthorizationCandidatesService — ação read-only `listarCandidatosAutorizacao` (ADR-0065). Lista
 * os favorecidos pagos por TED/PIX ou com perfil `TED_PIX` (`PerfilCanalFornecedor`), com o que o
 * cadastro do Conexos tem para cada modalidade e o estado da autorização, mais a seção "TED/PIX
 * retirados por falta de dado". NENHUMA escrita, em lugar nenhum: a ação de linha ("pedir
 * autorização") é outra rota.
 *
 * O `cmn025` é lido só para a PÁGINA pedida, um favorecido por vez (limite de sessões do Conexos),
 * com cache por favorecido. Nunca devolve conta ou chave: só se existe.
 */
@injectable()
export default class AuthorizationCandidatesService {
    public constructor(
        @inject(PerfilCanalFornecedorRepository)
        private readonly perfis: PerfilCanalFornecedorRepository,
        @inject(AuthorizedPayeeRepository) private readonly autorizacoes: AuthorizedPayeeRepository,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
        @inject(DestinoPagamentoResolver) private readonly resolver: DestinoPagamentoResolver,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
    ) {}

    public listar = async (params: {
        pagina: number;
        limite: number;
    }): Promise<RelatorioCandidatos> => {
        const { perfis, total } = await this.perfis.listarCandidatos({
            limite: params.limite,
            deslocamento: (params.pagina - 1) * params.limite,
        });
        const vigentes = await this.autorizacoes.listarVigentesPorPesCods(
            perfis.map((p) => p.pesCod),
        );
        const env = await this.environmentProvider.getEnvironmentVars();
        const cache = this.resolver.novoCache();
        const candidatos: CandidatoAutorizacao[] = [];
        for (const perfil of perfis) {
            candidatos.push(
                await this.linha(perfil, vigentes, { cache, filCod: env.conexosFilCod }),
            );
        }
        return {
            candidatos,
            total,
            pagina: params.pagina,
            limite: params.limite,
            retiradosSemDado: await this.eventos.listarRetiradosSemDado(RETIRADOS_LIMITE),
        };
    };

    private linha = async (
        perfil: ChannelProfile,
        vigentes: ReadonlyArray<{
            id: string;
            pesCod: string;
            modalidade: string;
            estado: AuthorizedPayeeState;
        }>,
        ctx: { cache: CacheCadastroDestino; filCod: number },
    ): Promise<CandidatoAutorizacao> => {
        const autorizacao = (m: AuthorizedPayeeModality) => {
            const v = vigentes.find((a) => a.pesCod === perfil.pesCod && a.modalidade === m);
            return v ? { estado: v.estado, id: v.id } : { estado: 'NENHUMA' as const };
        };
        return {
            pesCod: perfil.pesCod,
            ...(perfil.credor ? { credor: perfil.credor } : {}),
            grupoDominante: perfil.grupoDominante,
            participacao: perfil.participacao,
            pagamentos: perfil.pagamentosUnicos,
            pagamentosTedPix: perfil.contagens.TED_PIX ?? 0,
            meses: perfil.mesesDistintos,
            confianca: perfil.confianca,
            cadastro: {
                TED: await this.temNoCadastro(perfil.pesCod, AUTHORIZED_PAYEE_MODALITY.TED, ctx),
                PIX: await this.temNoCadastro(perfil.pesCod, AUTHORIZED_PAYEE_MODALITY.PIX, ctx),
            },
            autorizacao: {
                TED: autorizacao(AUTHORIZED_PAYEE_MODALITY.TED),
                PIX: autorizacao(AUTHORIZED_PAYEE_MODALITY.PIX),
            },
        };
    };

    /** Só a existência do dado (regra do cadastro, I10). Falha de leitura é dita, não escondida. */
    private temNoCadastro = async (
        pesCod: string,
        modalidade: AuthorizedPayeeModality,
        ctx: { cache: CacheCadastroDestino; filCod: number },
    ): Promise<CadastroTem> => {
        try {
            const r = await this.resolver.resolve(
                { modalidade },
                { flags: { ted: true, pix: true }, filCod: ctx.filCod, pesCod, cache: ctx.cache },
            );
            return r.origem === DESTINO_ORIGEM.CADASTRO ? CADASTRO_TEM.SIM : CADASTRO_TEM.NAO;
        } catch {
            return CADASTRO_TEM.FALHA_LEITURA;
        }
    };
}
