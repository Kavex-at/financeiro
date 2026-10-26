import { inject, injectable } from 'tsyringe';
import ConexosBaixaClient, { IDENTIDADE_BORDERO } from '../../client/ConexosBaixaClient.js';
import ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import GroupBorderoIncompleteError from '../../errors/GroupBorderoIncompleteError.js';
import GroupedBoletoNotEligibleAtRemittanceError, {
    type GrupoInelegivelNaRemessa,
} from '../../errors/GroupedBoletoNotEligibleAtRemittanceError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    ALERTA_SEVERIDADE,
    ALERTA_TIPO,
    type AlertaSeveridade,
} from '../../interface/operacao/Alerta.js';
import {
    type BorderoIdentificado,
    SITUACAO_BORDERO,
} from '../../interface/permutas/Fin010Baixa.js';
import {
    DESFECHO_LIMPEZA,
    DESFECHO_PREPARACAO,
    type LimpezaBorderoGrupoInterface,
    FOLGA_VARREDURA_BORDERO_MS,
    MARGEM_RELOGIO_BORDERO_MS,
    type PedidoConferenciaGrupos,
    type PedidoLimpezaBordero,
    type PedidoPreparacaoBordero,
    type ResultadoLimpezaBordero,
    type ResultadoPreparacaoBordero,
} from '../../interface/sispag/BorderoGrupoBoletoInterface.js';
import { ESTADO_CONFIRMACAO_EMISSOR } from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import type { ItemDeBordero } from '../../interface/sispag/Fin015Write.js';
import {
    GRUPO_BOLETO_EVENTO,
    type GrupoBoleto,
    type GrupoBoletoEvento,
    type GrupoBoletoTitulo,
    MOTIVO_GRUPO_INELEGIVEL,
    type MotivoGrupoInelegivel,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import {
    type LotePagamento,
    SISPAG_SYSTEM_ACTOR,
    SYSTEM_REMOVAL_REASON,
    type SystemRemovalReason,
} from '../../interface/sispag/SispagInterface.js';
import EtapaBorderoGrupo, {
    ETAPA_BORDERO_GRUPO,
    type EtapaBordero,
} from '../../libs/boleto/EtapaBorderoGrupo.js';
import ValorAbertoLiquido from '../../libs/boleto/ValorAbertoLiquido.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import GrupoBoletoExecucaoRepository, {
    type CamposEtapaGrupo,
    type GrupoBoletoExecucao,
    type NovaExecucaoGrupo,
} from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';

const E = ETAPA_BORDERO_GRUPO;
const R = SYSTEM_REMOVAL_REASON;

/** Progresso do caminho feliz; `failed` fica abaixo de tudo (a retomada refaz as etapas). */
const ORDEM: Partial<Record<EtapaBordero, number>> = {
    [E.INTENCAO_GRAVADA]: 0,
    [E.BORDERO_CRIADO]: 1,
    [E.BAIXAS_GRAVADAS]: 2,
    [E.REAPROVEITADO]: 2,
    [E.BORDERO_CONFERIDO]: 3,
    [E.IMPORTADO]: 4,
    [E.CODBAR_VINCULADO]: 5,
    [E.CONCLUIDO]: 6,
};

/** Etapas sem borderô nosso a apagar (já limpo, entregue à analista, nada escrito). */
const SEM_BORDERO_A_LIMPAR: ReadonlySet<EtapaBordero> = new Set<EtapaBordero>([
    E.SIMULADO,
    E.INDETERMINADO,
    E.LIMPO,
    E.LIMPEZA_PENDENTE,
]);

/** Uma preparação em curso: o grupo, a execução (etapa acompanhada em memória) e o que se sabe. */
interface Preparacao {
    pedido: PedidoPreparacaoBordero;
    exec: GrupoBoletoExecucao;
    gerNum: number;
    /** O `POST fin010` foi feito NESTA chamada (nada a reler antes das baixas). */
    criadoAgora: boolean;
    /** O borderô é o de um J rejeitado, adotado (I21s, PI-9): nunca se escreve nele. */
    reaproveitado: boolean;
}

/** Resultado de um passo: `undefined` segue; um resultado encerra a preparação. */
type Passo = ResultadoPreparacaoBordero | undefined;

const chaveDe = (docCod: string | number, titCod: string | number): string =>
    `${Number(docCod)}/${Number(titCod)}`;

/**
 * BorderoGrupoBoletoService — borderô `fin010` do grupo de boleto numa remessa (ADR-0077):
 * conferência antes de qualquer escrita (I21p(1)), preparação com write-ahead e retomada
 * (I21l, I21n, I21s) e limpeza do que o sistema criou (I21q). Nunca finaliza, cancela nem
 * estorna borderô de grupo (I21m).
 *
 * - **Write-ahead:** a execução (com `t0`) é gravada ANTES do `POST fin010`; `t1`, `borCod` e
 *   `borTimCad` logo depois. Escritas de tentativa única (no client); retry só em leitura.
 * - **Identidade** = `filCod + borCod + borTimCad`: o ERP reusa `borCod`. Resposta perdida ⇒
 *   busca por janela de `borTimCad` (um adota, zero cria, dois ou mais `indeterminado`).
 * - **Sucesso = estado observado na releitura**, nunca o 200 (H4).
 * - **Falhas:** transitória ⇒ `failed` + `GroupBorderoIncompleteError` (retomável);
 *   determinística ⇒ desfecho `retirar` (o chamador retira o grupo e pede a limpeza);
 *   estado que o sistema não reconhece ⇒ `indeterminado` + `Alerta`, nada tocado.
 */
@injectable()
export default class BorderoGrupoBoletoService implements LimpezaBorderoGrupoInterface {
    public constructor(
        @inject(ConexosBaixaClient) private readonly baixa: ConexosBaixaClient,
        @inject(ConexosSispagWriteClient) private readonly write: ConexosSispagWriteClient,
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(GrupoBoletoExecucaoRepository)
        private readonly ledger: GrupoBoletoExecucaoRepository,
        @inject(GrupoBoletoRepository) private readonly grupos: GrupoBoletoRepository,
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(ConexosIdentityProvider) private readonly identidade: ConexosIdentityProvider,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    // ── I21p(1): conferência antes de qualquer escrita ──────────────────────────────────────

    /**
     * Só leitura: boleto no pool e sem vínculo do ERP, par `VIGENTE`, cada título ativo, liberado
     * e não pago no `fin064`, soma pela régua líquida (I17b) == boleto, boleto não vencido na
     * data de débito. Algum grupo inelegível ⇒ `GroupedBoletoNotEligibleAtRemittanceError` com
     * todos os grupos e motivos. Falha de LEITURA sobe como está (nunca vira "elegível").
     */
    public conferirAntesDaEscrita = async (pedido: PedidoConferenciaGrupos): Promise<void> => {
        const inelegiveis: GrupoInelegivelNaRemessa[] = [];
        for (const grupo of pedido.grupos) {
            const motivo = await this.motivoInelegivel(grupo, pedido.lote.dataDebito);
            if (motivo) inelegiveis.push(motivo);
        }
        if (inelegiveis.length === 0) return;
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'remessa barrada: boleto agrupado inelegível ao vivo, nada escrito no Conexos',
            data: { loteId: pedido.lote.id, grupos: inelegiveis },
        });
        throw new GroupedBoletoNotEligibleAtRemittanceError({
            loteId: pedido.lote.id,
            grupos: inelegiveis,
        });
    };

    // ── I21s: reconhecimento do item de borderô no rascunho (retomada da remessa) ───────────

    /**
     * Chave nativa `{fil}:bor:{borCod}` do item de borderô de cada grupo, só para o borderô que
     * esta remessa pode ter importado: execução DESTE lote, com `borCod` + `borTimCad` gravados e
     * a identidade (`filCod + borCod + borTimCad`) confirmada AO VIVO. O ERP reusa `borCod`:
     * borderô presente com outro `borTimCad` é alheio e não gera chave. Só leitura.
     */
    public chavesNativasConfirmadas = async (pedido: {
        lote: LotePagamento;
        grupos: GrupoBoleto[];
    }): Promise<Map<string, string>> => {
        const chaves = new Map<string, string>();
        for (const grupo of pedido.grupos) {
            const exec = await this.ledger.ultimaPorGrupo(grupo.id);
            if (!exec || exec.loteId !== pedido.lote.id) continue;
            if (exec.borCod === undefined || exec.borTimCad === undefined) continue;
            if (SEM_BORDERO_A_LIMPAR.has(exec.etapa) || exec.etapa === E.RETIRADO) continue;
            const busca = await this.baixa.buscarBorderoPorIdentidade({
                filCod: exec.filCod,
                borCod: exec.borCod,
                borTimCad: exec.borTimCad,
            });
            if (busca.situacao !== IDENTIDADE_BORDERO.PRESENTE) continue;
            chaves.set(grupo.id, `${exec.filCod}:bor:${exec.borCod}`);
        }
        return chaves;
    };

    private motivoInelegivel = async (
        grupo: GrupoBoleto,
        dataDebito?: string,
    ): Promise<GrupoInelegivelNaRemessa | undefined> => {
        const base = { grupoId: grupo.id, codigoMascarado: grupo.codbarMascarado };
        const boleto = await this.boletos.buscarPorChave({
            ddcCod: grupo.ddcCod,
            ditCod: grupo.ditCod,
        });
        if (!boleto) return { ...base, motivo: MOTIVO_GRUPO_INELEGIVEL.BOLETO_INDISPONIVEL };
        if (boleto.docCod) return { ...base, motivo: MOTIVO_GRUPO_INELEGIVEL.BOLETO_VINCULADO_ERP };
        const par = grupo.confirmacaoEmissorId
            ? await this.sugestoes.buscarParPorId(grupo.confirmacaoEmissorId)
            : null;
        if (par?.estado !== ESTADO_CONFIRMACAO_EMISSOR.VIGENTE) {
            return { ...base, motivo: MOTIVO_GRUPO_INELEGIVEL.PAR_NAO_VIGENTE };
        }
        let soma = 0;
        for (const t of grupo.titulos) {
            const vivo = await this.liquidoVivo(t);
            if (typeof vivo !== 'number') {
                const titulo = { filCod: t.filCod, docCod: t.docCod, titCod: t.titCod };
                return { ...base, titulo, motivo: vivo };
            }
            soma += vivo;
        }
        if (soma !== grupo.valorBoletoCentavos) {
            return { ...base, motivo: MOTIVO_GRUPO_INELEGIVEL.SOMA_DIFERENTE };
        }
        if (dataDebito !== undefined && grupo.vencimentoBoleto < dataDebito) {
            return { ...base, motivo: MOTIVO_GRUPO_INELEGIVEL.BOLETO_VENCIDO };
        }
        return undefined;
    };

    /** Líquido aberto ao vivo (centavos, régua da I17b) ou o motivo da inelegibilidade. */
    private liquidoVivo = async (t: GrupoBoletoTitulo): Promise<number | MotivoGrupoInelegivel> => {
        const vivo = await this.sispag.getTituloAPagar(t.filCod, t.docCod, t.titCod);
        if (!vivo) return MOTIVO_GRUPO_INELEGIVEL.INATIVO;
        if (vivo.pago) return MOTIVO_GRUPO_INELEGIVEL.PAGO;
        if (!vivo.liberado) return MOTIVO_GRUPO_INELEGIVEL.NAO_LIBERADO;
        const aberto = await this.sispag.lerValoresAberto(t.filCod, t.docCod, t.titCod);
        const liquido = aberto.legivel
            ? ValorAbertoLiquido.calcularCentavos(aberto.valores)
            : undefined;
        return liquido ?? MOTIVO_GRUPO_INELEGIVEL.VALOR_ABERTO_INDISPONIVEL;
    };

    // ── I21l/I21n/I21s: preparação ─────────────────────────────────────────────────────────

    /**
     * Prepara o borderô de UM grupo no lote nativo aberto: retoma a execução não terminal do
     * grupo, reaproveita o borderô de um J rejeitado (I21s) ou cria um novo. Devolve `pronto`
     * (item nativo observado), `retirar`, `indeterminado` ou `simulado` (dry-run); falha
     * transitória ⇒ `GroupBorderoIncompleteError`.
     */
    public preparar = async (
        pedido: PedidoPreparacaoBordero,
    ): Promise<ResultadoPreparacaoBordero> => {
        const gerNum = pedido.gerNum;
        if (gerNum === undefined || !Number.isInteger(gerNum) || gerNum <= 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'borderô do grupo não preparado: conta financeira (gerNum) ausente',
                data: { grupoId: pedido.grupo.id, loteId: pedido.lote.id },
            });
            throw new LoteEstadoInvalidoError({
                loteId: pedido.lote.id,
                statusAtual: pedido.lote.status,
                acao: 'preparar o borderô do grupo (gerNum ausente)',
                motivo:
                    'A conta pagadora do lote não tem conta financeira no Conexos: o borderô do ' +
                    'boleto agrupado não foi criado. Confira a conta do lote e gere de novo.',
            });
        }
        const env = await this.environmentProvider.getEnvironmentVars();
        if (
            env.conexosWriteEnabled !== true ||
            env.sispagLiveWriteEnabled !== true ||
            env.conexosDryRun === true
        ) {
            return this.simular(pedido);
        }
        const ultima = await this.ledger.ultimaPorGrupo(pedido.grupo.id);
        if (ultima && !EtapaBorderoGrupo.ehTerminal(ultima.etapa)) {
            return this.retomar(pedido, gerNum, ultima);
        }
        const antiga = await this.ledger.ultimaRejeitadaPorGrupo(pedido.grupo.id);
        if (antiga?.borCod !== undefined && antiga.borTimCad !== undefined) {
            const decidido = await this.decidirAposRejeicao(pedido, gerNum, antiga);
            if (decidido) return decidido;
        }
        const vivo = await this.borderoVivoDeOutraExecucao(pedido, gerNum, antiga);
        return vivo ?? this.criarNovo(pedido, gerNum);
    };

    /**
     * I21l: nunca dois borderôs vivos para o mesmo grupo. Antes de criar, relê pela identidade o
     * borderô de cada execução anterior que pode ter deixado um no ERP (limpeza pendente,
     * indeterminado, retirado ou concluído sem J rejeitado — ex.: lote local cancelado com a
     * limpeza entregue à analista). Presente e não cancelado ⇒ retirada
     * `BORDERO_ANTERIOR_NAO_RESOLVIDO` sem escrever; situação desconhecida ⇒ `indeterminado`.
     */
    private borderoVivoDeOutraExecucao = async (
        pedido: PedidoPreparacaoBordero,
        gerNum: number,
        antiga: GrupoBoletoExecucao | null,
    ): Promise<Passo> => {
        const anteriores = await this.ledger.listarPorGrupo(pedido.grupo.id);
        const vistos = new Set<string>();
        if (antiga?.borCod !== undefined) vistos.add(`${antiga.borCod}:${antiga.borTimCad}`);
        for (const e of anteriores) {
            const chave = `${e.borCod}:${e.borTimCad}`;
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            const situacao = await this.situacaoSeVivo(e);
            if (situacao === undefined) continue;
            const texto = `o borderô ${e.borCod} de uma remessa anterior do grupo segue no Conexos (${situacao})`;
            return situacao === SITUACAO_BORDERO.INDETERMINADO
                ? this.encerrarSemEscrita(pedido, gerNum, E.INDETERMINADO, undefined, texto)
                : this.encerrarSemEscrita(
                      pedido,
                      gerNum,
                      E.RETIRADO,
                      R.BORDERO_ANTERIOR_NAO_RESOLVIDO,
                      texto,
                  );
        }
        return undefined;
    };

    /** Situação do borderô de uma execução anterior, se ele ainda vive no ERP (não cancelado). */
    private situacaoSeVivo = async (e: GrupoBoletoExecucao): Promise<string | undefined> => {
        if (e.borCod === undefined || e.borTimCad === undefined) return undefined;
        if (e.etapa === E.LIMPO || e.etapa === E.SIMULADO) return undefined;
        const busca = await this.baixa.buscarBorderoPorIdentidade({
            filCod: e.filCod,
            borCod: e.borCod,
            borTimCad: e.borTimCad,
        });
        if (busca.situacao !== IDENTIDADE_BORDERO.PRESENTE || !busca.bordero) return undefined;
        const situacao = busca.bordero.situacao ?? SITUACAO_BORDERO.INDETERMINADO;
        return situacao === SITUACAO_BORDERO.CANCELADO ? undefined : situacao;
    };

    private novaExecucao = (pedido: PedidoPreparacaoBordero): NovaExecucaoGrupo => {
        const id = this.identidade.currentParams();
        return {
            grupoId: pedido.grupo.id,
            loteId: pedido.lote.id,
            filCod: pedido.lote.filCod,
            ...(pedido.remessaExecucaoId !== undefined
                ? { remessaExecucaoId: pedido.remessaExecucaoId }
                : {}),
            bncCod: pedido.bncCod,
            flpCod: pedido.flpCod,
            ...(pedido.gerNum !== undefined ? { gerNum: pedido.gerNum } : {}),
            borDtaMvto: pedido.dataDebito,
            ...(id.conexosUsername ? { conexosUsername: id.conexosUsername } : {}),
            ...(id.conexosUsnCod ? { conexosUsnCod: id.conexosUsnCod } : {}),
        };
    };

    private simular = async (
        pedido: PedidoPreparacaoBordero,
    ): Promise<ResultadoPreparacaoBordero> => {
        const { execucao } = await this.ledger.abrir({
            ...this.novaExecucao(pedido),
            etapa: E.SIMULADO,
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'dry-run: borderô do grupo montado e não enviado ao Conexos',
            data: {
                ...this.dadosDoLog(execucao, pedido.grupo),
                corpo: {
                    filCod: pedido.lote.filCod,
                    borVldTipo: 2,
                    borDtaMvto: pedido.dataDebito,
                    gerNum: pedido.gerNum,
                    titulos: pedido.grupo.titulos.map((t) => chaveDe(t.docCod, t.titCod)),
                },
            },
        });
        return {
            desfecho: DESFECHO_PREPARACAO.SIMULADO,
            execucaoId: execucao.id,
            reaproveitado: false,
        };
    };

    private criarNovo = async (
        pedido: PedidoPreparacaoBordero,
        gerNum: number,
    ): Promise<ResultadoPreparacaoBordero> => {
        const { criado, execucao } = await this.ledger.abrir({
            ...this.novaExecucao(pedido),
            escritaIniciadaEm: this.calendar.now(),
        });
        if (!criado) return this.retomar(pedido, gerNum, execucao);
        const prep: Preparacao = {
            pedido,
            exec: execucao,
            gerNum,
            criadoAgora: false,
            reaproveitado: false,
        };
        return (await this.criarBordero(prep, false)) ?? this.seguir(prep);
    };

    /** Execução não terminal do grupo: reconhece o ERP ao vivo e continua (I21s). */
    private retomar = async (
        pedido: PedidoPreparacaoBordero,
        gerNum: number,
        exec: GrupoBoletoExecucao,
    ): Promise<ResultadoPreparacaoBordero> => {
        const prep: Preparacao = {
            pedido,
            exec,
            gerNum,
            criadoAgora: false,
            reaproveitado: exec.borCodReaproveitadoDe !== undefined,
        };
        if (
            exec.loteId !== pedido.lote.id ||
            (exec.flpCod !== undefined && exec.flpCod !== pedido.flpCod)
        ) {
            return this.indeterminar(
                prep,
                'há uma execução pendente do grupo em outro lote nativo',
            );
        }
        const id = this.identidade.currentParams();
        await this.ledger.registrarTentativa(exec.id, {
            ...(id.conexosUsername ? { conexosUsername: id.conexosUsername } : {}),
            ...(id.conexosUsnCod ? { conexosUsnCod: id.conexosUsnCod } : {}),
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'retomando o borderô do grupo',
            data: this.dadosDoLog(exec, pedido.grupo),
        });
        const recuperado = await this.recuperarIdentidade(prep);
        if (recuperado) return recuperado;
        return this.seguir(prep);
    };

    /**
     * Execução sem `borCod`: reaproveitamento interrompido ⇒ adota de novo o antigo; `t0`
     * gravado ⇒ busca pela janela (resposta perdida); nada achado ⇒ cria (com `t0` novo).
     */
    private recuperarIdentidade = async (prep: Preparacao): Promise<Passo> => {
        if (prep.exec.borCod !== undefined) return undefined;
        if (prep.reaproveitado) return this.readotarAntigo(prep);
        if (prep.exec.escritaIniciadaEm !== undefined) {
            const reconhecido = await this.reconhecerPelaJanela(prep);
            if (reconhecido || prep.exec.borCod !== undefined) return reconhecido;
        }
        return this.criarBordero(prep, true);
    };

    /** Reaproveitamento interrompido antes de gravar a identidade: adota de novo a do antigo. */
    private readotarAntigo = async (prep: Preparacao): Promise<Passo> => {
        const antiga = await this.ledger.buscarPorId(prep.exec.borCodReaproveitadoDe ?? '');
        if (antiga?.borCod === undefined || antiga.borTimCad === undefined) {
            return this.indeterminar(prep, 'reaproveitamento sem o borderô antigo identificado');
        }
        return this.adotar(prep, { borCod: antiga.borCod, borTimCad: antiga.borTimCad });
    };

    /** Grava a identidade adotada; outra já gravada ⇒ `indeterminado` (nunca troca). */
    private adotar = async (
        prep: Preparacao,
        b: { borCod: number; borTimCad: number; usnCodCad?: number },
    ): Promise<Passo> => {
        const ok = await this.ledger.registrarBordero(prep.exec.id, {
            borCod: b.borCod,
            borTimCad: b.borTimCad,
            ...(b.usnCodCad !== undefined ? { usnCodCad: b.usnCodCad } : {}),
        });
        if (!ok) return this.indeterminar(prep, 'a execução já tem outro borderô gravado');
        prep.exec = { ...prep.exec, borCod: b.borCod, borTimCad: b.borTimCad };
        return undefined;
    };

    /**
     * Resposta perdida do `POST fin010` (I21s): borderôs do robô na janela de `borTimCad`
     * `[t0 − margem, (t1 ?? agora) + margem]`, com a conta e a data do lote. Um ⇒ adota; zero ⇒
     * segue para criar; dois ou mais ⇒ `indeterminado` + `Alerta`.
     */
    private reconhecerPelaJanela = async (prep: Preparacao): Promise<Passo> => {
        const { exec } = prep;
        const usnCodCad = this.usuarioDoRobo(exec);
        if (usnCodCad === undefined || exec.escritaIniciadaEm === undefined) {
            return this.indeterminar(
                prep,
                'usuário do robô desconhecido: não dá para procurar o borderô pela janela',
            );
        }
        const t1 = exec.escritaConcluidaEm?.getTime();
        let achados: BorderoIdentificado[];
        try {
            achados = await this.baixa.buscarBorderosNaJanela({
                filCod: exec.filCod,
                usnCodCad,
                gerNum: exec.gerNum ?? prep.gerNum,
                borDtaMvto: this.calendar.toErpEpoch(exec.borDtaMvto ?? prep.pedido.dataDebito),
                t0: exec.escritaIniciadaEm.getTime(),
                ...(t1 !== undefined ? { t1 } : {}),
                agora: this.calendar.now().getTime(),
                margemMs: MARGEM_RELOGIO_BORDERO_MS,
            });
        } catch (err) {
            return this.falhar(prep, err, 'busca do borderô pela janela de criação');
        }
        if (achados.length >= 2) {
            return this.indeterminar(
                prep,
                `${achados.length} borderôs na janela de criação (${achados.map((b) => b.borCod).join(', ')})`,
            );
        }
        const [unico] = achados;
        if (!unico) return this.varrerForaDaJanela(prep, usnCodCad, exec.escritaIniciadaEm);
        const adotado = await this.adotar(prep, unico);
        if (adotado) return adotado;
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô do grupo reconhecido pela janela de criação (resposta perdida)',
            data: this.dadosDoLog(prep.exec, prep.pedido.grupo),
        });
        return undefined;
    };

    /**
     * F-ft-1: a janela estreita não achou nada, mas o relógio do ERP pode estar além da margem e
     * o `POST` perdido ter criado o borderô. Varredura larga (mesma conta e data): qualquer
     * borderô do robô que não seja de outra execução nossa ⇒ `indeterminado` + `Alerta`
     * (falha fechada), em vez de criar um segundo. Nada achado ⇒ segue para criar.
     */
    private varrerForaDaJanela = async (
        prep: Preparacao,
        usnCodCad: number,
        t0: Date,
    ): Promise<Passo> => {
        const { exec } = prep;
        const agora = this.calendar.now().getTime();
        let achados: BorderoIdentificado[];
        try {
            achados = await this.baixa.buscarBorderosNaJanela({
                filCod: exec.filCod,
                usnCodCad,
                gerNum: exec.gerNum ?? prep.gerNum,
                borDtaMvto: this.calendar.toErpEpoch(exec.borDtaMvto ?? prep.pedido.dataDebito),
                t0: t0.getTime() - FOLGA_VARREDURA_BORDERO_MS,
                t1: agora + FOLGA_VARREDURA_BORDERO_MS,
                agora,
                margemMs: 0,
            });
        } catch (err) {
            return this.falhar(prep, err, 'varredura do borderô fora da janela de criação');
        }
        const nossos = new Set<string>();
        for (const e of [
            ...(await this.ledger.listarPorLote(exec.loteId)),
            ...(await this.ledger.listarPorGrupo(exec.grupoId)),
        ]) {
            if (e.borCod !== undefined) nossos.add(`${e.borCod}:${e.borTimCad}`);
        }
        const suspeitos = achados.filter((b) => !nossos.has(`${b.borCod}:${b.borTimCad}`));
        if (suspeitos.length === 0) return undefined;
        return this.indeterminar(
            prep,
            `borderô do robô fora da janela de criação (${suspeitos.map((b) => b.borCod).join(', ')}): possível relógio desencontrado com o Conexos; conferir se é deste grupo antes de criar outro`,
        );
    };

    private usuarioDoRobo = (exec: GrupoBoletoExecucao): number | undefined => {
        const n = Number(exec.conexosUsnCod ?? this.identidade.currentParams().conexosUsnCod);
        return Number.isInteger(n) && n > 0 ? n : undefined;
    };

    /** `POST fin010` (I21l(2)); na retomada grava um `t0` novo antes. */
    private criarBordero = async (prep: Preparacao, retomada: boolean): Promise<Passo> => {
        if (retomada) {
            const t0 = this.calendar.now();
            await this.ledger.registrarInicioEscrita(prep.exec.id, t0);
            prep.exec = { ...prep.exec, escritaIniciadaEm: t0 };
        }
        let criado: BorderoIdentificado;
        try {
            criado = await this.baixa.criarBorderoDoGrupo({
                filCod: prep.exec.filCod,
                dataMovto: this.calendar.toErpEpoch(prep.pedido.dataDebito),
                gerNum: prep.gerNum,
            });
        } catch (err) {
            return this.desviar(prep, err, 'criação do borderô');
        }
        const ok = await this.ledger.registrarBordero(prep.exec.id, {
            borCod: criado.borCod,
            borTimCad: criado.borTimCad,
            ...(criado.usnCodCad !== undefined ? { usnCodCad: criado.usnCodCad } : {}),
            escritaConcluidaEm: this.calendar.now(),
        });
        if (!ok) return this.indeterminar(prep, 'a execução já tem outro borderô gravado');
        prep.exec = { ...prep.exec, borCod: criado.borCod, borTimCad: criado.borTimCad };
        prep.criadoAgora = true;
        await this.garantirEtapa(prep, E.BORDERO_CRIADO);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô do grupo criado no Conexos',
            data: this.dadosDoLog(prep.exec, prep.pedido.grupo),
        });
        return undefined;
    };

    /** Do borderô identificado até o item nativo observado. */
    private seguir = async (prep: Preparacao): Promise<ResultadoPreparacaoBordero> => {
        if (!prep.criadoAgora) {
            const lido = await this.lerNosso(prep);
            if ('desfecho' in lido) return lido;
        }
        await this.garantirEtapa(prep, prep.reaproveitado ? E.REAPROVEITADO : E.BORDERO_CRIADO);
        return (
            (await this.gravarBaixas(prep)) ??
            (await this.conferirBordero(prep)) ??
            (await this.importar(prep))
        );
    };

    /**
     * Relê o nosso borderô pela identidade: tem de estar presente (mesmo `borTimCad`) e em
     * cadastro. `borCod` reusado (alheio), ausente, finalizado, cancelado ou estornado ⇒
     * `indeterminado` + `Alerta`, nada tocado.
     */
    private lerNosso = async (
        prep: Preparacao,
    ): Promise<BorderoIdentificado | ResultadoPreparacaoBordero> => {
        const { borCod, borTimCad } = prep.exec;
        if (borCod === undefined || borTimCad === undefined) {
            return this.indeterminar(prep, 'execução sem a identidade do borderô');
        }
        let busca: Awaited<ReturnType<ConexosBaixaClient['buscarBorderoPorIdentidade']>>;
        try {
            busca = await this.baixa.buscarBorderoPorIdentidade({
                filCod: prep.exec.filCod,
                borCod,
                borTimCad,
            });
        } catch (err) {
            return this.falhar(prep, err, 'releitura do borderô');
        }
        if (busca.situacao === IDENTIDADE_BORDERO.ALHEIO) {
            return this.indeterminar(
                prep,
                `o borderô ${borCod} no Conexos é de outra pessoa (o número foi reutilizado)`,
            );
        }
        if (busca.situacao !== IDENTIDADE_BORDERO.PRESENTE || !busca.bordero) {
            return this.indeterminar(prep, `o borderô ${borCod} não existe mais no Conexos`);
        }
        const situacao = busca.bordero.situacao ?? SITUACAO_BORDERO.INDETERMINADO;
        if (situacao !== SITUACAO_BORDERO.EM_CADASTRO) {
            return this.indeterminar(
                prep,
                `o borderô ${borCod} não está em cadastro no Conexos (situação: ${situacao})`,
            );
        }
        return busca.bordero;
    };

    /** I21l(3): uma baixa por título que ainda não está no borderô. */
    private gravarBaixas = async (prep: Preparacao): Promise<Passo> => {
        const borCod = this.exigido(prep.exec, prep.exec.borCod, 'borCod');
        const grupo = prep.pedido.grupo;
        let existentes: Array<{ docCod: number; titCod: number; bxaCodSeq: number }> = [];
        if (!prep.criadoAgora) {
            try {
                existentes = await this.baixa.listBaixas({ filCod: prep.exec.filCod, borCod });
            } catch (err) {
                return this.falhar(prep, err, 'leitura das baixas do borderô');
            }
        }
        const esperadas = new Set(grupo.titulos.map((t) => chaveDe(t.docCod, t.titCod)));
        const alheias = existentes.filter((b) => !esperadas.has(chaveDe(b.docCod, b.titCod)));
        if (alheias.length > 0) {
            const texto = `o borderô ${borCod} tem baixa de título que não é do grupo (${alheias.map((b) => chaveDe(b.docCod, b.titCod)).join(', ')})`;
            return prep.reaproveitado
                ? this.retirar(prep, R.BORDERO_ANTERIOR_NAO_RESOLVIDO, texto)
                : this.indeterminar(prep, texto);
        }
        const parada = await this.completarBaixas(prep, borCod, existentes);
        if (parada) return parada;
        await this.garantirEtapa(prep, E.BAIXAS_GRAVADAS);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'baixas do grupo gravadas no borderô',
            data: this.dadosDoLog(prep.exec, prep.pedido.grupo),
        });
        return undefined;
    };

    /** Grava só as baixas que faltam; as achadas no ERP e ausentes do ledger são anotadas. */
    private completarBaixas = async (
        prep: Preparacao,
        borCod: number,
        existentes: Array<{ docCod: number; titCod: number; bxaCodSeq: number }>,
    ): Promise<Passo> => {
        const presentes = new Map(existentes.map((b) => [chaveDe(b.docCod, b.titCod), b]));
        const noLedger = new Set(prep.exec.baixas.map((b) => chaveDe(b.docCod, b.titCod)));
        for (const t of prep.pedido.grupo.titulos) {
            const ja = presentes.get(chaveDe(t.docCod, t.titCod));
            if (ja) {
                if (!noLedger.has(chaveDe(t.docCod, t.titCod))) await this.anotarBaixa(prep, t, ja);
                continue;
            }
            if (prep.reaproveitado) {
                return this.retirar(
                    prep,
                    R.BORDERO_ANTERIOR_NAO_RESOLVIDO,
                    `o borderô antigo ${borCod} não tem a baixa do título ${t.docCod}/${t.titCod}`,
                );
            }
            const falhou = await this.gravarBaixa(prep, t);
            if (falhou) return falhou;
        }
        return undefined;
    };

    /** Baixa achada no ERP e ausente do ledger (resposta perdida): anotada para a limpeza. */
    private anotarBaixa = async (
        prep: Preparacao,
        t: GrupoBoletoTitulo,
        achada: { bxaCodSeq: number },
    ): Promise<void> => {
        await this.ledger.registrarBaixa(prep.exec.id, {
            docCod: t.docCod,
            titCod: t.titCod,
            bxaCodSeq: achada.bxaCodSeq,
            valorCentavos: t.valorLiquidoCentavos,
        });
    };

    private gravarBaixa = async (prep: Preparacao, t: GrupoBoletoTitulo): Promise<Passo> => {
        const borCod = this.exigido(prep.exec, prep.exec.borCod, 'borCod');
        const filCod = prep.exec.filCod;
        const onde = `baixa do título ${t.docCod}/${t.titCod}`;
        try {
            const v = await this.baixa.validarTituloBaixa({
                filCod,
                borCod,
                invoiceDocCod: Number(t.docCod),
                titCod: Number(t.titCod),
            });
            const erro = v.messages?.find((m) => m?.valid === 'ERRO');
            const dados = v.responseData;
            if (erro || !(Number(dados?.bxaMnyValor) > 0)) {
                return this.retirar(
                    prep,
                    R.GRUPO_BOLETO_FALHOU,
                    `o Conexos recusou a ${onde}${erro?.message ? ` (${erro.message})` : ''}`,
                );
            }
            const gravada = await this.baixa.gravarBaixaSimples({
                filCod,
                borCod,
                gerNum: prep.gerNum,
                docCod: Number(t.docCod),
                titCod: Number(t.titCod),
                validacao: { ...dados },
            });
            await this.ledger.registrarBaixa(prep.exec.id, {
                docCod: t.docCod,
                titCod: t.titCod,
                bxaCodSeq: gravada.bxaCodSeq,
                valorCentavos: Math.round(gravada.bxaMnyValor * 100),
            });
            return undefined;
        } catch (err) {
            return this.desviar(prep, err, onde);
        }
    };

    /** I21l(4): releitura — N baixas dos títulos esperados e `vlrTotalLiquido == valorBoleto`. */
    private conferirBordero = async (prep: Preparacao): Promise<Passo> => {
        const lido = await this.lerNosso(prep);
        if ('desfecho' in lido) return lido;
        const grupo = prep.pedido.grupo;
        let baixas: Array<{ docCod: number; titCod: number }>;
        try {
            baixas = await this.baixa.listBaixas({ filCod: prep.exec.filCod, borCod: lido.borCod });
        } catch (err) {
            return this.falhar(prep, err, 'releitura das baixas do borderô');
        }
        const esperadas = new Set(grupo.titulos.map((t) => chaveDe(t.docCod, t.titCod)));
        const chaves = baixas.map((b) => chaveDe(b.docCod, b.titCod));
        if (chaves.some((c) => !esperadas.has(c))) {
            return this.indeterminar(
                prep,
                `o borderô ${lido.borCod} tem baixa de título que não é do grupo`,
            );
        }
        if (chaves.length !== esperadas.size || new Set(chaves).size !== esperadas.size) {
            return this.falhar(prep, undefined, 'releitura das baixas inconclusiva');
        }
        if (lido.vlrTotalLiquido === undefined) {
            return this.falhar(prep, undefined, 'releitura sem o total do borderô');
        }
        const total = Math.round(lido.vlrTotalLiquido * 100);
        if (total !== grupo.valorBoletoCentavos) {
            return this.retirar(
                prep,
                prep.reaproveitado ? R.BORDERO_ANTERIOR_NAO_RESOLVIDO : R.GRUPO_BOLETO_FALHOU,
                `o total do borderô ${lido.borCod} (${total} centavos) difere do boleto (${grupo.valorBoletoCentavos} centavos)`,
            );
        }
        await this.garantirEtapa(prep, E.BORDERO_CONFERIDO);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô do grupo conferido (baixas e total)',
            data: this.dadosDoLog(prep.exec, prep.pedido.grupo),
        });
        return undefined;
    };

    /** I21n: `borderosPendentes` → `importar` (`itemy 1`) → item observado na releitura. */
    private importar = async (prep: Preparacao): Promise<ResultadoPreparacaoBordero> => {
        const { pedido } = prep;
        const borCod = this.exigido(prep.exec, prep.exec.borCod, 'borCod');
        const local = { filCod: pedido.lote.filCod, bncCod: pedido.bncCod, flpCod: pedido.flpCod };
        if (!prep.criadoAgora) {
            let ja: ItemDeBordero | undefined;
            try {
                ja = await this.write.lerItemDeBordero({ ...local, borCod });
            } catch (err) {
                return this.falhar(prep, err, 'leitura do rascunho nativo');
            }
            if (ja) return this.concluirImport(prep, ja);
        }
        let pendentes: Awaited<ReturnType<ConexosSispagWriteClient['listarBorderosPendentes']>>;
        try {
            pendentes = await this.write.listarBorderosPendentes(local);
        } catch (err) {
            return this.falhar(prep, err, 'leitura dos borderôs pendentes do lote');
        }
        const linha = pendentes.find((l) => l.borCod === borCod);
        if (!linha) {
            return this.retirar(
                prep,
                prep.reaproveitado ? R.BORDERO_ANTERIOR_NAO_RESOLVIDO : R.GRUPO_BOLETO_FALHOU,
                `o borderô ${borCod} não aparece entre os pendentes do lote nativo ${pedido.flpCod} (BORDERO_NAO_PENDENTE: confira a conta financeira)`,
            );
        }
        try {
            await this.write.importarBorderoPendente({
                linha,
                filCodLote: pedido.lote.filCod,
                bncCod: pedido.bncCod,
                flpCod: pedido.flpCod,
                bncCodFin015: pedido.bncCod,
            });
        } catch (err) {
            return this.desviar(prep, err, 'importação do borderô no lote');
        }
        let item: ItemDeBordero | undefined;
        try {
            item = await this.write.lerItemDeBordero({ ...local, borCod });
        } catch (err) {
            return this.falhar(prep, err, 'releitura do rascunho depois do importar');
        }
        if (!item) {
            return this.falhar(prep, undefined, 'importar respondeu sem o item no rascunho (H4)');
        }
        return this.concluirImport(prep, item);
    };

    private concluirImport = async (
        prep: Preparacao,
        item: ItemDeBordero,
    ): Promise<ResultadoPreparacaoBordero> => {
        const grupo = prep.pedido.grupo;
        const valor = Math.round(item.itsMnyValor * 100);
        if (valor !== grupo.valorBoletoCentavos) {
            return this.retirar(
                prep,
                prep.reaproveitado ? R.BORDERO_ANTERIOR_NAO_RESOLVIDO : R.GRUPO_BOLETO_FALHOU,
                `o item do borderô no lote (${valor} centavos) difere do boleto (${grupo.valorBoletoCentavos} centavos)`,
            );
        }
        const avancou = await this.garantirEtapa(prep, E.IMPORTADO, { itsCodSeq: item.itsCodSeq });
        if (avancou) {
            await this.registrarEvento(prep.exec, GRUPO_BOLETO_EVENTO.BORDERO_PREPARADO, grupo, {
                itsCodSeq: item.itsCodSeq,
                reaproveitado: prep.reaproveitado,
            });
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô do grupo importado no lote nativo',
            data: { ...this.dadosDoLog(prep.exec, grupo), itsCodSeq: item.itsCodSeq },
        });
        return {
            desfecho: DESFECHO_PREPARACAO.PRONTO,
            execucaoId: prep.exec.id,
            borCod: prep.exec.borCod,
            borTimCad: prep.exec.borTimCad,
            itsCodSeq: item.itsCodSeq,
            reaproveitado: prep.reaproveitado,
        };
    };

    // ── I21s: depois de J rejeitado ────────────────────────────────────────────────────────

    /**
     * O borderô antigo do grupo, relido pela identidade antes de criar outro (PI-9). Ausente ou
     * número reusado (alheio) ou cancelado ⇒ `undefined` (cria um novo). Em cadastro, nos
     * pendentes do lote, com as N baixas e o total do boleto ⇒ reaproveita. Em cadastro fora dos
     * pendentes ou divergente, finalizado ou estornado ⇒ `retirar` (`BORDERO_ANTERIOR_NAO_RESOLVIDO`)
     * sem tocar no antigo. Situação indeterminada ⇒ `indeterminado`.
     */
    private decidirAposRejeicao = async (
        pedido: PedidoPreparacaoBordero,
        gerNum: number,
        antiga: GrupoBoletoExecucao,
    ): Promise<Passo> => {
        const borCod = this.exigido(antiga, antiga.borCod, 'borCod');
        const busca = await this.baixa.buscarBorderoPorIdentidade({
            filCod: antiga.filCod,
            borCod,
            borTimCad: this.exigido(antiga, antiga.borTimCad, 'borTimCad'),
        });
        if (busca.situacao !== IDENTIDADE_BORDERO.PRESENTE || !busca.bordero) return undefined;
        const antigo = busca.bordero;
        const situacao = antigo.situacao ?? SITUACAO_BORDERO.INDETERMINADO;
        if (situacao === SITUACAO_BORDERO.CANCELADO) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'borderô antigo do grupo cancelado no Conexos: um novo será criado',
                data: { grupoId: pedido.grupo.id, borCodAntigo: borCod },
            });
            return undefined;
        }
        if (situacao === SITUACAO_BORDERO.INDETERMINADO) {
            return this.encerrarSemEscrita(
                pedido,
                gerNum,
                E.INDETERMINADO,
                undefined,
                `o borderô antigo ${borCod} está num estado que o sistema não reconhece no Conexos`,
            );
        }
        if (situacao !== SITUACAO_BORDERO.EM_CADASTRO) {
            return this.encerrarSemEscrita(
                pedido,
                gerNum,
                E.RETIRADO,
                R.BORDERO_ANTERIOR_NAO_RESOLVIDO,
                `o borderô antigo ${borCod} está ${situacao} no Conexos: resolva-o antes de pôr o grupo num lote`,
            );
        }
        const divergencia = await this.divergenciaDoAntigo(pedido, antigo);
        if (divergencia) {
            return this.encerrarSemEscrita(
                pedido,
                gerNum,
                E.RETIRADO,
                R.BORDERO_ANTERIOR_NAO_RESOLVIDO,
                divergencia,
            );
        }
        return this.reaproveitar(pedido, gerNum, antiga, antigo);
    };

    /** O antigo serve para reaproveitar? Texto do motivo quando não serve. */
    private divergenciaDoAntigo = async (
        pedido: PedidoPreparacaoBordero,
        antigo: BorderoIdentificado,
    ): Promise<string | undefined> => {
        const pendentes = await this.write.listarBorderosPendentes({
            filCod: pedido.lote.filCod,
            bncCod: pedido.bncCod,
            flpCod: pedido.flpCod,
        });
        if (!pendentes.some((l) => l.borCod === antigo.borCod)) {
            return `o borderô antigo ${antigo.borCod} está em cadastro mas fora dos pendentes do lote nativo ${pedido.flpCod}`;
        }
        const baixas = await this.baixa.listBaixas({
            filCod: antigo.filCod,
            borCod: antigo.borCod,
        });
        const esperadas = new Set(pedido.grupo.titulos.map((t) => chaveDe(t.docCod, t.titCod)));
        const chaves = baixas.map((b) => chaveDe(b.docCod, b.titCod));
        const iguais =
            chaves.length === esperadas.size &&
            new Set(chaves).size === esperadas.size &&
            chaves.every((c) => esperadas.has(c));
        const total =
            antigo.vlrTotalLiquido !== undefined
                ? Math.round(antigo.vlrTotalLiquido * 100)
                : undefined;
        if (!iguais || total !== pedido.grupo.valorBoletoCentavos) {
            return `o borderô antigo ${antigo.borCod} tem baixas ou total diferentes do grupo`;
        }
        return undefined;
    };

    private reaproveitar = async (
        pedido: PedidoPreparacaoBordero,
        gerNum: number,
        antiga: GrupoBoletoExecucao,
        antigo: BorderoIdentificado,
    ): Promise<ResultadoPreparacaoBordero> => {
        const { criado, execucao } = await this.ledger.abrir({
            ...this.novaExecucao(pedido),
            borCodReaproveitadoDe: antiga.id,
        });
        if (!criado) return this.retomar(pedido, gerNum, execucao);
        const prep: Preparacao = {
            pedido,
            exec: execucao,
            gerNum,
            criadoAgora: false,
            reaproveitado: true,
        };
        const adotado = await this.adotar(prep, antigo);
        if (adotado) return adotado;
        await this.garantirEtapa(prep, E.REAPROVEITADO);
        await this.registrarEvento(
            prep.exec,
            GRUPO_BOLETO_EVENTO.BORDERO_REAPROVEITADO,
            pedido.grupo,
            {
                execucaoAnterior: antiga.id,
            },
        );
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô antigo do grupo reaproveitado (J rejeitado antes)',
            data: this.dadosDoLog(prep.exec, pedido.grupo),
        });
        return this.seguir(prep);
    };

    /** Abre a execução só para registrar um desfecho sem escrita no ERP (retirada/indeterminado). */
    private encerrarSemEscrita = async (
        pedido: PedidoPreparacaoBordero,
        gerNum: number,
        para: typeof E.RETIRADO | typeof E.INDETERMINADO,
        motivo: SystemRemovalReason | undefined,
        detalhe: string,
    ): Promise<ResultadoPreparacaoBordero> => {
        const { criado, execucao } = await this.ledger.abrir(this.novaExecucao(pedido));
        if (!criado) return this.retomar(pedido, gerNum, execucao);
        const prep: Preparacao = {
            pedido,
            exec: execucao,
            gerNum,
            criadoAgora: false,
            reaproveitado: false,
        };
        if (para === E.INDETERMINADO || motivo === undefined)
            return this.indeterminar(prep, detalhe);
        return this.retirar(prep, motivo, detalhe);
    };

    // ── desfechos da preparação ────────────────────────────────────────────────────────────

    /** Avança até `alvo` se ainda não chegou (`failed` sempre avança). `true` = transicionou. */
    private garantirEtapa = async (
        prep: Preparacao,
        alvo: EtapaBordero,
        campos: CamposEtapaGrupo = {},
    ): Promise<boolean> => {
        const atual = prep.exec.etapa;
        if (atual !== E.FAILED && (ORDEM[atual] ?? -1) >= (ORDEM[alvo] ?? -1)) return false;
        await this.mover(prep, alvo, campos);
        return true;
    };

    private mover = async (
        prep: Preparacao,
        para: EtapaBordero,
        campos: CamposEtapaGrupo = {},
    ): Promise<void> => {
        const ok = await this.ledger.registrarEtapa(prep.exec.id, prep.exec.etapa, para, campos);
        if (!ok) throw this.incompleto(prep.exec, `${prep.exec.etapa} → ${para} (concorrência)`);
        prep.exec = { ...prep.exec, etapa: para, ...campos };
    };

    /** Falha do ERP: determinística ⇒ `retirar`; transitória/ambígua ⇒ `falhar`. */
    private desviar = async (
        prep: Preparacao,
        err: unknown,
        onde: string,
    ): Promise<ResultadoPreparacaoBordero> => {
        const falha = ConexosBaixaClient.classificarFalha(err);
        if (falha.tipo === 'DETERMINISTICA') {
            const codigo = falha.codigoErp ? ` (${falha.codigoErp})` : '';
            return this.retirar(
                prep,
                prep.reaproveitado ? R.BORDERO_ANTERIOR_NAO_RESOLVIDO : R.GRUPO_BOLETO_FALHOU,
                `o Conexos recusou a ${onde}${codigo}`,
            );
        }
        return this.falhar(prep, err, onde);
    };

    /** I21p(2): `failed`, borderô e rascunho preservados; a retomada continua. Sempre lança. */
    private falhar = async (prep: Preparacao, err: unknown, onde: string): Promise<never> => {
        const de = prep.exec.etapa;
        if (de !== E.FAILED && EtapaBorderoGrupo.podeTransicionar(de, E.FAILED)) {
            await this.ledger.registrarEtapa(prep.exec.id, de, E.FAILED, { motivo: onde });
        }
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `preparação do borderô do grupo interrompida (transitória): ${onde}`,
            data: {
                ...this.dadosDoLog(prep.exec, prep.pedido.grupo),
                erro: err instanceof Error ? err.message : undefined,
            },
        });
        throw this.incompleto(prep.exec, de);
    };

    /** I21p(3): o chamador retira o grupo e pede a limpeza do borderô criado nesta remessa. */
    private retirar = async (
        prep: Preparacao,
        motivo: SystemRemovalReason,
        detalhe: string,
    ): Promise<ResultadoPreparacaoBordero> => {
        await this.mover(prep, E.RETIRADO, { motivo: `${motivo}: ${detalhe}` });
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `grupo retirado da remessa: ${detalhe}`,
            data: { ...this.dadosDoLog(prep.exec, prep.pedido.grupo), motivo },
        });
        if (motivo === R.BORDERO_ANTERIOR_NAO_RESOLVIDO) {
            await this.alertar(prep.exec, detalhe, ALERTA_SEVERIDADE.AVISO, prep.pedido.grupo);
        }
        return {
            desfecho: DESFECHO_PREPARACAO.RETIRAR,
            execucaoId: prep.exec.id,
            ...(prep.exec.borCod !== undefined ? { borCod: prep.exec.borCod } : {}),
            ...(prep.exec.borTimCad !== undefined ? { borTimCad: prep.exec.borTimCad } : {}),
            reaproveitado: prep.reaproveitado,
            motivo,
            detalhe,
        };
    };

    /** Estado do ERP que o sistema não reconhece: nada tocado, `Alerta` (I21s). */
    private indeterminar = async (
        prep: Preparacao,
        detalhe: string,
    ): Promise<ResultadoPreparacaoBordero> => {
        await this.mover(prep, E.INDETERMINADO, { motivo: detalhe });
        await this.alertar(prep.exec, detalhe, ALERTA_SEVERIDADE.ERRO, prep.pedido.grupo);
        return {
            desfecho: DESFECHO_PREPARACAO.INDETERMINADO,
            execucaoId: prep.exec.id,
            ...(prep.exec.borCod !== undefined ? { borCod: prep.exec.borCod } : {}),
            ...(prep.exec.borTimCad !== undefined ? { borTimCad: prep.exec.borTimCad } : {}),
            reaproveitado: prep.reaproveitado,
            detalhe,
        };
    };

    // ── I21q: limpeza ──────────────────────────────────────────────────────────────────────

    /**
     * Apaga SÓ o borderô que nós criamos nesta execução, e só com o lote nativo lido ao vivo
     * aberto e sem `.REM`. Ordem imposta pelo ERP (V3): `DELETE` do item → releitura →
     * `excluirBaixa` × N → `excluirBordero` → releitura; sucesso = ausência observada. Borderô
     * reaproveitado: só o item sai. Guarda não atendida, kill-switch desligado ou recusa do ERP ⇒
     * `pendente` + `Alerta`. Falha transitória ⇒ `GroupBorderoIncompleteError` (a etapa não muda;
     * a retomada termina).
     */
    public limpar = async (pedido: PedidoLimpezaBordero): Promise<ResultadoLimpezaBordero> => {
        const exec = (await this.ledger.buscarPorId(pedido.execucao.id)) ?? pedido.execucao;
        const nada = { desfecho: DESFECHO_LIMPEZA.NADA_A_LIMPAR, execucaoId: exec.id };
        if (
            SEM_BORDERO_A_LIMPAR.has(exec.etapa) ||
            (exec.borCod === undefined &&
                (exec.etapa === E.RETIRADO || exec.escritaIniciadaEm === undefined))
        ) {
            return nada;
        }
        if (exec.borCod === undefined || exec.borTimCad === undefined) {
            return this.pendente(
                exec,
                'o borderô pode ter sido criado sem a identidade gravada',
                pedido.motivo,
            );
        }
        const env = await this.environmentProvider.getEnvironmentVars();
        if (
            env.conexosWriteEnabled !== true ||
            env.sispagLiveWriteEnabled !== true ||
            env.conexosDryRun === true
        ) {
            return this.pendente(exec, 'escrita no Conexos desligada (kill-switch)', pedido.motivo);
        }
        const guarda = await this.lerGuardaDoLoteNativo(exec);
        const reaproveitado = exec.borCodReaproveitadoDe !== undefined;
        if (!EtapaBorderoGrupo.podeLimpar(exec.etapa, { ...guarda, reaproveitado: false })) {
            return this.pendente(
                exec,
                'o lote nativo está finalizado, tem remessa gerada ou não pôde ser lido',
                pedido.motivo,
            );
        }
        const busca = await this.lerParaLimpeza(exec);
        if (busca.situacao !== IDENTIDADE_BORDERO.PRESENTE || !busca.bordero) {
            await this.transicionar(exec, E.LIMPO, { motivo: 'ausência observada' });
            return { desfecho: DESFECHO_LIMPEZA.LIMPO, execucaoId: exec.id };
        }
        if (busca.bordero.situacao !== SITUACAO_BORDERO.EM_CADASTRO) {
            return this.pendente(
                exec,
                'o borderô não está mais em cadastro no Conexos',
                pedido.motivo,
            );
        }
        const semItem = await this.removerItem(exec, pedido.motivo);
        if (semItem) return semItem;
        if (reaproveitado) {
            return this.pendente(
                exec,
                'borderô reaproveitado de um J rejeitado: só o item saiu do lote, o borderô fica',
                pedido.motivo,
            );
        }
        return this.excluirBaixasEBordero(exec, pedido.motivo);
    };

    /** Lote nativo lido AGORA; ilegível ⇒ campos ausentes (a guarda falha fechada). */
    private lerGuardaDoLoteNativo = async (
        exec: GrupoBoletoExecucao,
    ): Promise<{ loteNativoFinalizado?: boolean; remessaGerada?: boolean }> => {
        if (exec.bncCod === undefined || exec.flpCod === undefined) return {};
        const chave = { filCod: exec.filCod, bncCod: exec.bncCod, flpCod: exec.flpCod };
        try {
            const lote = await this.write.getLoteNativo(chave);
            if (!lote) return {};
            const arquivos = await this.write.listarArquivosRemessa(chave);
            // Só o rascunho (0) conta como aberto; finalizado, cancelado ou outro terminal não.
            return { loteNativoFinalizado: lote.status !== 0, remessaGerada: arquivos.length > 0 };
        } catch {
            return {};
        }
    };

    private lerParaLimpeza = async (exec: GrupoBoletoExecucao) => {
        try {
            return await this.baixa.buscarBorderoPorIdentidade({
                filCod: exec.filCod,
                borCod: this.exigido(exec, exec.borCod, 'borCod'),
                borTimCad: this.exigido(exec, exec.borTimCad, 'borTimCad'),
            });
        } catch {
            throw this.incompleto(exec, 'limpeza: releitura do borderô');
        }
    };

    /** `DELETE` do item nativo (se houver) e releitura: ausência observada. */
    private removerItem = async (
        exec: GrupoBoletoExecucao,
        motivo: string,
    ): Promise<ResultadoLimpezaBordero | undefined> => {
        const chave = {
            filCod: exec.filCod,
            bncCod: this.exigido(exec, exec.bncCod, 'bncCod'),
            flpCod: this.exigido(exec, exec.flpCod, 'flpCod'),
            borCod: this.exigido(exec, exec.borCod, 'borCod'),
        };
        try {
            const item = await this.write.lerItemDeBordero(chave);
            if (!item) return undefined;
            await this.write.removerItemDoRascunho({
                filCod: chave.filCod,
                bncCod: chave.bncCod,
                flpCod: chave.flpCod,
                itsCodSeq: item.itsCodSeq,
                filCodItem: item.filCod,
            });
            if (await this.write.lerItemDeBordero(chave)) {
                throw this.incompleto(exec, 'limpeza: item do borderô ainda no lote');
            }
            return undefined;
        } catch (err) {
            return this.falhaNaLimpeza(exec, err, 'remoção do item do lote', motivo);
        }
    };

    private excluirBaixasEBordero = async (
        exec: GrupoBoletoExecucao,
        motivo: string,
    ): Promise<ResultadoLimpezaBordero> => {
        const borCod = this.exigido(exec, exec.borCod, 'borCod');
        const doGrupo = new Set(exec.baixas.map((b) => chaveDe(b.docCod, b.titCod)));
        try {
            const baixas = await this.baixa.listBaixas({ filCod: exec.filCod, borCod });
            const alheias = baixas.filter((b) => !doGrupo.has(chaveDe(b.docCod, b.titCod)));
            if (alheias.length > 0) {
                return this.pendente(
                    exec,
                    'o borderô tem baixa de título que não é do grupo',
                    motivo,
                );
            }
            for (const b of baixas) {
                await this.baixa.excluirBaixa({
                    filCod: exec.filCod,
                    borCod,
                    invoiceDocCod: b.docCod,
                    titCod: b.titCod,
                    bxaCodSeq: b.bxaCodSeq,
                    docTip: b.docTip,
                });
            }
            await this.baixa.excluirBordero({ filCod: exec.filCod, borCod });
        } catch (err) {
            const parada = await this.falhaNaLimpeza(
                exec,
                err,
                'exclusão das baixas e do borderô',
                motivo,
            );
            if (parada) return parada;
        }
        const releitura = await this.lerParaLimpeza(exec);
        if (releitura.situacao === IDENTIDADE_BORDERO.PRESENTE) {
            throw this.incompleto(exec, 'limpeza: borderô ainda presente na releitura');
        }
        await this.transicionar(exec, E.LIMPO, { motivo });
        await this.registrarEvento(exec, GRUPO_BOLETO_EVENTO.BORDERO_LIMPO, undefined, { motivo });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'borderô do grupo limpo no Conexos (item, baixas e borderô ausentes)',
            data: { ...this.dadosDoLog(exec), motivo },
        });
        return { desfecho: DESFECHO_LIMPEZA.LIMPO, execucaoId: exec.id };
    };

    /** Recusa do ERP ⇒ `pendente` + `Alerta`; transitória ⇒ `GroupBorderoIncompleteError`. */
    private falhaNaLimpeza = async (
        exec: GrupoBoletoExecucao,
        err: unknown,
        onde: string,
        motivo: string,
    ): Promise<ResultadoLimpezaBordero> => {
        if (err instanceof GroupBorderoIncompleteError) throw err;
        const falha = ConexosBaixaClient.classificarFalha(err);
        if (falha.tipo === 'DETERMINISTICA') {
            const codigo = falha.codigoErp ? ` (${falha.codigoErp})` : '';
            return this.pendente(exec, `o Conexos recusou a ${onde}${codigo}`, motivo);
        }
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `limpeza do borderô do grupo interrompida (transitória): ${onde}`,
            data: {
                ...this.dadosDoLog(exec),
                erro: err instanceof Error ? err.message : undefined,
            },
        });
        throw this.incompleto(exec, `limpeza: ${onde}`);
    };

    /** Nada (mais) é excluído; o borderô fica para a analista com o `Alerta`. */
    private pendente = async (
        exec: GrupoBoletoExecucao,
        situacao: string,
        motivo: string,
    ): Promise<ResultadoLimpezaBordero> => {
        await this.transicionar(exec, E.LIMPEZA_PENDENTE, { motivo: `${motivo}: ${situacao}` });
        await this.alertar(exec, situacao, ALERTA_SEVERIDADE.AVISO);
        return { desfecho: DESFECHO_LIMPEZA.PENDENTE, execucaoId: exec.id };
    };

    // ── apoio ──────────────────────────────────────────────────────────────────────────────

    /** Transição sem lançar (limpeza): inválida ou já feita por outro processo ⇒ `false`. */
    private transicionar = async (
        exec: GrupoBoletoExecucao,
        para: EtapaBordero,
        campos: CamposEtapaGrupo,
    ): Promise<boolean> => {
        if (!EtapaBorderoGrupo.podeTransicionar(exec.etapa, para)) return false;
        return this.ledger.registrarEtapa(exec.id, exec.etapa, para, campos);
    };

    /**
     * Campo que a etapa já garantiu (guarda anterior). Ausente = estado inesperado: falha
     * retomável, nunca um `undefined` que vire chamada ao ERP com chave errada.
     */
    private exigido = (
        exec: GrupoBoletoExecucao,
        valor: number | undefined,
        campo: string,
    ): number => {
        if (valor === undefined) throw this.incompleto(exec, `execução sem ${campo}`);
        return valor;
    };

    private incompleto = (exec: GrupoBoletoExecucao, etapa: string): GroupBorderoIncompleteError =>
        new GroupBorderoIncompleteError({
            grupoId: exec.grupoId,
            filCod: exec.filCod,
            ...(exec.borCod !== undefined ? { borCod: exec.borCod } : {}),
            ...(exec.flpCod !== undefined ? { flpCod: exec.flpCod } : {}),
            etapa,
        });

    /**
     * `Alerta` `sispag-bordero-grupo-pendente` (no máximo um por grupo e dia civil de Brasília)
     * + log. Best-effort: falhar ao emitir fica no log, nunca muda o desfecho já gravado.
     */
    private alertar = async (
        exec: GrupoBoletoExecucao,
        situacao: string,
        severidade: AlertaSeveridade,
        grupo?: GrupoBoleto,
    ): Promise<void> => {
        const dados = this.dadosDoLog(exec, grupo);
        await this.logService.error({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `borderô do grupo pendente de decisão da analista: ${situacao}`,
            data: dados,
        });
        try {
            await this.notificacao.emitir({
                tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE,
                alvo: `${exec.filCod}:grupo:${exec.grupoId}`,
                severidade,
                janelaInicio: this.calendar.startOfTodayBrt(),
                detalhe: {
                    ...dados,
                    titulos: grupo
                        ? grupo.titulos.map((t) => `${t.docCod}/${t.titCod}`)
                        : exec.baixas.map((b) => `${b.docCod}/${b.titCod}`),
                    situacao,
                    acao: 'confira o borderô no Conexos (fin010) e decida; o sistema não o altera',
                },
            });
        } catch (err) {
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'falha ao emitir o alerta do borderô do grupo',
                data: { ...dados, erro: err instanceof Error ? err.message : undefined },
            });
        }
    };

    /** Trilha só-inclusão do grupo; o código vai só mascarado (I17j). */
    private registrarEvento = async (
        exec: GrupoBoletoExecucao,
        tipo: GrupoBoletoEvento,
        grupo: GrupoBoleto | undefined,
        dados: Record<string, unknown>,
    ): Promise<void> => {
        await this.grupos.registrarEvento({
            grupoId: exec.grupoId,
            tipo,
            ator: SISPAG_SYSTEM_ACTOR,
            filCod: exec.filCod,
            loteId: exec.loteId,
            execucaoId: exec.id,
            ...(exec.borCod !== undefined ? { borCod: exec.borCod } : {}),
            ...(grupo
                ? {
                      ddcCod: grupo.ddcCod,
                      ditCod: grupo.ditCod,
                      codigoMascarado: grupo.codbarMascarado,
                  }
                : {}),
            dados: { ...dados, flpCod: exec.flpCod, borTimCad: exec.borTimCad },
        });
    };

    private dadosDoLog = (
        exec: GrupoBoletoExecucao,
        grupo?: GrupoBoleto,
    ): Record<string, unknown> => ({
        grupoId: exec.grupoId,
        execucaoId: exec.id,
        loteId: exec.loteId,
        filCod: exec.filCod,
        flpCod: exec.flpCod,
        borCod: exec.borCod,
        etapa: exec.etapa,
        ...(grupo ? { codigoMascarado: grupo.codbarMascarado, credor: grupo.credor } : {}),
    });
}
