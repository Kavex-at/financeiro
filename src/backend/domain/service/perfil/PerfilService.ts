import { inject, injectable } from 'tsyringe';
import {
    EXCEPTION_EFFECT,
    PERMISSION_CATALOG,
    PERMISSION_IMPLIES,
    type Permission,
} from '../../interface/auth/Permission.js';
import {
    type AcaoAtividade,
    type AgregadosAtividade,
    type AlvoPerfil,
    type FrenteAtividade,
    type LinhaAtividade,
    type LinhaAtividadeBruta,
    STATUS_ATIVIDADE,
    STATUS_POR_FONTE,
    type StatusAtividade,
} from '../../interface/perfil/AtividadeUsuarioInterface.js';
import {
    type ExcecaoComAutoria,
    ORIGEM_PERMISSAO,
    type PerfilUsuario,
    type PermissaoComOrigem,
} from '../../interface/perfil/PerfilInterface.js';
import AtividadeUsuarioRepository from '../../repository/perfil/AtividadeUsuarioRepository.js';
import PerfilRepository from '../../repository/perfil/PerfilRepository.js';
import EffectivePermissionCalculator from '../auth/EffectivePermissionCalculator.js';
import HistoricoCursor from './HistoricoCursor.js';
import PeriodoPerfil, { type PeriodoPedido, type TipoPeriodo } from './PeriodoPerfil.js';

/** Tamanho da página do histórico. O repositório recebe +1 para saber se há próxima. */
export const HISTORICO_PAGINA = 25;

export interface FiltrosHistorico {
    frente?: FrenteAtividade;
    tipo?: AcaoAtividade;
    status?: StatusAtividade;
    /** Datas locais SP `YYYY-MM-DD`; `fim` inclusivo. */
    inicio?: string;
    fim?: string;
}

export interface PaginaHistorico {
    itens: LinhaAtividade[];
    proximoCursor?: string;
}

/** O que a explicação das origens consulta, calculado uma vez por perfil. */
interface ContextoOrigem {
    doPapel: ReadonlySet<string>;
    excecoes: readonly ExcecaoComAutoria[];
    efetivas: ReadonlySet<Permission>;
}

export interface AtualEAnterior<T> {
    atual: T;
    anterior: T;
}

export interface AtividadeUsuarioResposta {
    periodo: { tipo: TipoPeriodo; inicio: string; fim: string };
    periodoAnterior: { inicio: string; fim: string };
    permutas: AtualEAnterior<AgregadosAtividade['permutas']>;
    sispag: AtualEAnterior<AgregadosAtividade['sispag']>;
    recebimentos: AtualEAnterior<AgregadosAtividade['recebimentos']>;
}

/**
 * PerfilService — o perfil pessoal (ADR-0058): identidade, permissões com origem, KPIs por frente
 * e histórico unificado.
 *
 * Todo método recebe o `alvo = { userId, username }` como PARÂMETRO (v2-ready: um admin vendo o
 * perfil de outro reusa o serviço sem refatorar). Nada aqui lê a requisição: na v1 quem monta o
 * alvo é a rota, exclusivamente da identidade autenticada (I1). Só leitura.
 */
@injectable()
export default class PerfilService {
    public constructor(
        @inject(PerfilRepository)
        private readonly perfilRepository: PerfilRepository,
        @inject(AtividadeUsuarioRepository)
        private readonly atividadeRepository: AtividadeUsuarioRepository,
        @inject(PeriodoPerfil)
        private readonly periodo: PeriodoPerfil,
        @inject(HistoricoCursor)
        private readonly cursor: HistoricoCursor,
        @inject(EffectivePermissionCalculator)
        private readonly calculator: EffectivePermissionCalculator,
    ) {}

    public perfil = async (alvo: AlvoPerfil): Promise<PerfilUsuario> => {
        const [identidade, fontes] = await Promise.all([
            this.perfilRepository.buscarIdentidade(alvo.userId),
            this.perfilRepository.buscarFontesDePermissao(alvo.userId),
        ]);
        if (!identidade) {
            throw new Error(`perfil: usuário ${alvo.userId} não encontrado`);
        }
        return {
            username: identidade.username,
            email: identidade.email ?? null,
            ativo: identidade.ativo,
            membroDesde: identidade.membroDesde,
            criadoPor: identidade.criadoPor ?? null,
            papel: {
                id: identidade.papel.id,
                nome: identidade.papel.nome,
                descricao: identidade.papel.descricao ?? null,
            },
            conexos: {
                vinculado: identidade.conexosUsername !== undefined,
                conexosUsername: identidade.conexosUsername ?? null,
            },
            permissoes: this.origens(fontes.pacote, fontes.excecoes),
        };
    };

    public atividade = async (input: {
        alvo: AlvoPerfil;
        periodo: PeriodoPedido;
    }): Promise<AtividadeUsuarioResposta> => {
        const atual = this.periodo.calcular(input.periodo);
        const anterior = this.periodo.anterior(atual);
        const [agAtual, agAnterior] = await Promise.all([
            this.atividadeRepository.agregados({
                username: input.alvo.username,
                inicio: atual.inicio.toISOString(),
                fim: atual.fim.toISOString(),
            }),
            this.atividadeRepository.agregados({
                username: input.alvo.username,
                inicio: anterior.inicio.toISOString(),
                fim: anterior.fim.toISOString(),
            }),
        ]);
        return {
            periodo: {
                tipo: atual.tipo,
                inicio: atual.inicio.toISOString(),
                fim: atual.fim.toISOString(),
            },
            periodoAnterior: {
                inicio: anterior.inicio.toISOString(),
                fim: anterior.fim.toISOString(),
            },
            permutas: { atual: agAtual.permutas, anterior: agAnterior.permutas },
            sispag: { atual: agAtual.sispag, anterior: agAnterior.sispag },
            recebimentos: { atual: agAtual.recebimentos, anterior: agAnterior.recebimentos },
        };
    };

    public historico = async (input: {
        alvo: AlvoPerfil;
        filtros: FiltrosHistorico;
        cursor?: string;
    }): Promise<PaginaHistorico> => {
        const posicao = input.cursor !== undefined ? this.cursor.decode(input.cursor) : undefined;
        const janela = this.periodo.janelaHistorico({
            inicio: input.filtros.inicio,
            fim: input.filtros.fim,
        });
        const linhas = await this.atividadeRepository.historico({
            userId: input.alvo.userId,
            username: input.alvo.username,
            inicio: janela.inicio.toISOString(),
            fim: janela.fim.toISOString(),
            ...(input.filtros.frente ? { frente: input.filtros.frente } : {}),
            ...(input.filtros.tipo ? { tipo: input.filtros.tipo } : {}),
            ...(input.filtros.status ? { status: input.filtros.status } : {}),
            ...(posicao ? { cursor: posicao } : {}),
            limit: HISTORICO_PAGINA + 1,
        });
        const pagina = linhas.slice(0, HISTORICO_PAGINA);
        const ultima = pagina[pagina.length - 1];
        const temProxima = linhas.length > HISTORICO_PAGINA && ultima !== undefined;
        return {
            itens: pagina.map(this.normalizar),
            ...(temProxima
                ? {
                      proximoCursor: this.cursor.encode({
                          em: ultima.em,
                          fonte: ultima.fonte,
                          fonteId: ultima.fonteId,
                      }),
                  }
                : {}),
        };
    };

    /** Status bruto → normalizado pela tabela única. Bruto desconhecido vira `info`. */
    private normalizar = (linha: LinhaAtividadeBruta): LinhaAtividade => {
        const { statusBruto, ...resto } = linha;
        return {
            ...resto,
            status: STATUS_POR_FONTE[linha.fonte][statusBruto] ?? STATUS_ATIVIDADE.INFO,
        };
    };

    /**
     * Origem de cada permissão do catálogo. O conjunto efetivo vem do
     * `EffectivePermissionCalculator` (nenhuma regra duplicada aqui); este método só EXPLICA de
     * onde cada efetiva veio e por que uma que o usuário teria está ausente:
     * papel > concedida > implicada; ausente por revogação (direta ou do `ver` do mesmo módulo).
     * Permissão que o usuário nunca teve não aparece.
     */
    private origens = (
        pacote: readonly string[],
        excecoes: readonly ExcecaoComAutoria[],
    ): PermissaoComOrigem[] => {
        const efetivas = this.calculator.calcular(
            pacote,
            excecoes.map((e) => ({ permissao: e.permissao, efeito: e.efeito })),
        ).permissoes;
        const ctx: ContextoOrigem = { doPapel: new Set(pacote), excecoes, efetivas };
        return PERMISSION_CATALOG.flatMap((codigo) => {
            const item = efetivas.has(codigo)
                ? this.origemDaEfetiva(codigo, ctx)
                : this.origemDaAusente(codigo, ctx);
            return item ? [item] : [];
        });
    };

    /** papel > concedida > implicada. */
    private origemDaEfetiva = (codigo: Permission, ctx: ContextoOrigem): PermissaoComOrigem => {
        if (ctx.doPapel.has(codigo)) {
            return { codigo, efetiva: true, origem: ORIGEM_PERMISSAO.PAPEL };
        }
        const concedida = this.excecao(ctx, codigo, EXCEPTION_EFFECT.CONCEDER);
        if (concedida) {
            return {
                codigo,
                efetiva: true,
                origem: ORIGEM_PERMISSAO.CONCEDIDA,
                por: concedida.concedidoPor,
                em: concedida.concedidoEm,
            };
        }
        const implicadaPor = this.quemImplica(codigo, ctx.efetivas);
        return {
            codigo,
            efetiva: true,
            origem: ORIGEM_PERMISSAO.IMPLICADA,
            ...(implicadaPor ? { implicadaPor } : {}),
        };
    };

    /**
     * Ausente por revogação: direta, ou — se o usuário a teria pelo papel/concessão — pela
     * revogação do `ver` do mesmo módulo. Ausente por nunca ter tido: `undefined` (não aparece).
     */
    private origemDaAusente = (
        codigo: Permission,
        ctx: ContextoOrigem,
    ): PermissaoComOrigem | undefined => {
        const teria =
            ctx.doPapel.has(codigo) ||
            this.excecao(ctx, codigo, EXCEPTION_EFFECT.CONCEDER) !== undefined;
        const implicada = PERMISSION_IMPLIES[codigo];
        const viaVer =
            teria && implicada !== undefined
                ? this.excecao(ctx, implicada, EXCEPTION_EFFECT.REVOGAR)
                : undefined;
        const revogacao = this.excecao(ctx, codigo, EXCEPTION_EFFECT.REVOGAR) ?? viaVer;
        if (!revogacao) return undefined;
        return {
            codigo,
            efetiva: false,
            origem: ORIGEM_PERMISSAO.REVOGADA,
            por: revogacao.concedidoPor,
            em: revogacao.concedidoEm,
        };
    };

    private excecao = (
        ctx: ContextoOrigem,
        permissao: Permission,
        efeito: string,
    ): ExcecaoComAutoria | undefined =>
        ctx.excecoes.find((e) => e.permissao === permissao && e.efeito === efeito);

    /** A permissão efetiva que arrasta `codigo` (`X:executar ⇒ X:ver`). */
    private quemImplica = (
        codigo: Permission,
        efetivas: ReadonlySet<Permission>,
    ): Permission | undefined =>
        PERMISSION_CATALOG.find((p) => PERMISSION_IMPLIES[p] === codigo && efetivas.has(p));
}
