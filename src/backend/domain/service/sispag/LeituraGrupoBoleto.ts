import { inject, injectable } from 'tsyringe';
import type {
    ChaveTituloGrupo,
    EstadoVivoGrupo,
    GrupoBoleto,
    ResultadoOrfao,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import type { LotePagamentoStatus } from '../../interface/sispag/SispagInterface.js';
import SituacaoGrupoBoleto, {
    type ExecucaoParaSituacao,
    type SituacaoGrupo,
} from '../../libs/boleto/SituacaoGrupoBoleto.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import GrupoBoletoExecucaoRepository, {
    type GrupoBoletoExecucao,
} from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';

/** O que o chamador já sabe do grupo no contexto dele (lote, retenção, órfão). */
export interface ContextoSituacaoGrupo {
    loteStatus?: LotePagamentoStatus;
    divergente?: boolean;
    orfao?: boolean;
    marcaRetencaoAtiva?: boolean;
}

/**
 * LeituraGrupoBoleto — leituras LOCAIS de um grupo de boleto confirmado (ADR-0077), sem Conexos:
 * órfão pela I21u (pool DDA e carteira persistidos), títulos retidos (I21c), rejeição não
 * resolvida (I21r) e a situação derivada (`SituacaoGrupoBoleto`). Serve o lote manual (I21j,
 * Task 11) e a formação automática (P1-4, Task 12), que decidem com a mesma régua.
 */
@injectable()
export default class LeituraGrupoBoleto {
    public constructor(
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(TituloAPagarRepository) private readonly titulos: TituloAPagarRepository,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueios: BloqueioDuplicidadeRepository,
        @inject(GrupoBoletoExecucaoRepository)
        private readonly execucoes: GrupoBoletoExecucaoRepository,
        @inject(RegraGrupoBoleto) private readonly regra: RegraGrupoBoleto,
    ) {}

    /** I21u com o pool e a carteira locais (o líquido ao vivo é conferido na remessa, I21p(1)). */
    public orfao = async (grupo: GrupoBoleto): Promise<ResultadoOrfao> => {
        const [boleto, ...titulos] = await Promise.all([
            this.boletos.buscarPorChave({ ddcCod: grupo.ddcCod, ditCod: grupo.ditCod }),
            ...grupo.titulos.map((t) =>
                this.titulos.buscarPorChave({
                    filCod: t.filCod,
                    docCod: t.docCod,
                    titCod: t.titCod,
                }),
            ),
        ]);
        const vivo: EstadoVivoGrupo = {
            ...(boleto
                ? {
                      boleto: {
                          ...(boleto.filCod != null ? { filCod: boleto.filCod } : {}),
                          ...(boleto.docCod ? { docCod: boleto.docCod } : {}),
                          ...(boleto.titCod ? { titCod: boleto.titCod } : {}),
                      },
                  }
                : {}),
            titulos: titulos.flatMap((t) =>
                t
                    ? [
                          {
                              filCod: t.filCod,
                              docCod: t.docCod,
                              titCod: t.titCod,
                              pago: t.pago,
                              ativo: t.ativo !== false,
                              ...(t.temBoleto !== undefined ? { temBoleto: t.temBoleto } : {}),
                          },
                      ]
                    : [],
            ),
        };
        return this.regra.orfao(grupo, vivo);
    };

    /** Títulos do grupo com `BloqueioDuplicidade ATIVO`, de qualquer origem (I21c). */
    public titulosRetidos = async (grupo: GrupoBoleto): Promise<ChaveTituloGrupo[]> => {
        const marcas = await Promise.all(
            grupo.titulos.map(async (t) => {
                const chave = { filCod: t.filCod, docCod: t.docCod, titCod: t.titCod };
                return (await this.bloqueios.findAtivo(chave)) ? [chave] : [];
            }),
        );
        return marcas.flat();
    };

    /** I21r/PI-9: a última execução teve o J rejeitado e nenhuma posterior concluiu. */
    public rejeicaoNaoResolvida = async (grupoId: string): Promise<boolean> =>
        SituacaoGrupoBoleto.rejeitado(
            this.paraSituacao(await this.execucoes.listarPorGrupo(grupoId)),
        );

    /** Situação derivada com o contexto do chamador + as execuções do ledger. */
    public situacao = async (
        grupo: GrupoBoleto,
        ctx: ContextoSituacaoGrupo = {},
    ): Promise<SituacaoGrupo> =>
        SituacaoGrupoBoleto.derivar({
            estado: grupo.estado,
            orfao: ctx.orfao === true,
            marcaRetencaoAtiva: ctx.marcaRetencaoAtiva === true,
            divergente: ctx.divergente === true,
            ...(ctx.loteStatus !== undefined ? { loteStatus: ctx.loteStatus } : {}),
            execucoes: this.paraSituacao(await this.execucoes.listarPorGrupo(grupo.id)),
        });

    private paraSituacao = (execucoes: GrupoBoletoExecucao[]): ExecucaoParaSituacao[] =>
        execucoes.map((e) => ({
            iniciadaEm: new Date(e.criadoEm).getTime(),
            etapa: e.etapa,
            ...(e.jRejeitadoEm ? { jRejeitadoEm: new Date(e.jRejeitadoEm).getTime() } : {}),
        }));
}
