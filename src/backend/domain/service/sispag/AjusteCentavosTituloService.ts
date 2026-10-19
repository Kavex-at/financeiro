import { inject, injectable } from 'tsyringe';
import ConexosRenegociacaoClient from '../../client/ConexosRenegociacaoClient.js';
import ConexosSessionRegistry from '../../client/ConexosSessionRegistry.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import CentsAdjustmentIncompleteError from '../../errors/CentsAdjustmentIncompleteError.js';
import CentsAdjustmentNotEligibleError from '../../errors/CentsAdjustmentNotEligibleError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type AjusteCentavosExecucao,
    GATILHO_AJUSTE,
    type GatilhoAjuste,
} from '../../interface/sispag/AjusteCentavos.js';
import {
    DECISAO_SUGESTAO_BOLETO,
    EVENTO_SUGESTAO_BOLETO,
    type EventoSugestaoBoleto,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import {
    FTB_VLD_STATUS,
    type SessaoConexos,
    type TituloDoDocumento,
} from '../../interface/sispag/RenegociacaoInterface.js';
import { SISPAG_SYSTEM_ACTOR } from '../../interface/sispag/SispagInterface.js';
import ElegibilidadeAjusteCentavos, {
    type EntradaElegibilidadeAjuste,
    MOTIVO_INELEGIVEL_AJUSTE,
    type ResultadoElegibilidadeAjuste,
} from '../../libs/boleto/ElegibilidadeAjusteCentavos.js';
import EtapaAjusteCentavos, {
    ETAPA_AJUSTE,
    type EtapaAjuste,
} from '../../libs/boleto/EtapaAjusteCentavos.js';
import ModoAjusteCentavos, {
    MODO_AJUSTE,
    type ModoAjuste,
    type ModoEfetivoAjuste,
} from '../../libs/boleto/ModoAjusteCentavos.js';
import ValorAbertoLiquido from '../../libs/boleto/ValorAbertoLiquido.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import ServerProcessMarker from '../../libs/runtime/ServerProcessMarker.js';
import AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LogService from '../LogService.js';

export const RESULTADO_AJUSTE = {
    DESLIGADO: 'desligado',
    SIMULADO: 'simulado',
    NAO_CANDIDATO: 'nao_candidato',
    RECUSADO: 'recusado',
    EM_ANDAMENTO: 'em_andamento',
    EXECUTADO: 'executado',
} as const;
export type ResultadoAjusteTipo = (typeof RESULTADO_AJUSTE)[keyof typeof RESULTADO_AJUSTE];

export interface ResultadoAjuste {
    resultado: ResultadoAjusteTipo;
    modo: ModoAjuste;
    etapa?: EtapaAjuste;
    motivo?: string;
    execucaoId?: string;
}

export interface PedidoAjuste {
    filCod: number;
    docCod: string;
    titCod: string;
    decisaoId: string;
    gatilho: GatilhoAjuste;
}

/** Prefixo do motivo quando a liberação ficou para outra pessoa (I18e) — o terminal é `aguardando`. */
const MOTIVO_APROVACAO_MANUAL = 'APROVACAO_MANUAL';

/** Guarda do laço da máquina: o caminho mais longo tem 9 transições. */
const MAX_PASSOS = 16;

/** Comando que libera o bloqueio criado pela renegociação (HML: `fbaCod 3` "APROVAR"). */
const COMANDO_APROVAR = 'APROVAR';

type Chave = { filCod: number; docCod: string; titCod: string };

/** O que a avaliação AO VIVO leu — a base de todas as etapas antes do `finalizar`. */
interface Contexto {
    elegibilidade: ResultadoElegibilidadeAjuste;
    original?: TituloDoDocumento;
    /** `titCod`s do documento ANTES da renegociação (I18d: o novo não existia). */
    titCodsAntes: string[];
}

type Passo = AjusteCentavosExecucao | 'parar';

const centavos = (v: number): number => Math.round(v * 100);

/** Chave inteira do advisory lock por título (serialização I18h). FNV-1a 32 bits. */
const chaveDeLock = (k: Chave): number => {
    let h = 0x811c9dc5;
    for (const ch of `ajuste-centavos:${k.filCod}:${k.docCod}:${k.titCod}`) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 0x01000193);
    }
    return h | 0;
};

/**
 * AjusteCentavosTituloService — ajuste de centavos do título por renegociação no `fin070` (ADR-0073,
 * I18). Três gatilhos, UMA ação (I18g): logo após o commit do `confirmar` (assíncrono, fora da
 * transação), "tentar de novo" e a varredura de retomada — sempre no processo do servidor.
 *
 * Pilares:
 *  1. **Identidade (I18f):** toda chamada usa `ConexosSessionRegistry.robot()` explícita (a
 *     credencial do servidor); nunca o resolver por-request. Fora do servidor o modo cai a `shadow`.
 *  2. **Elegibilidade ao vivo (I18a):** a mesma regra pura no início, antes do `finalizar` e no
 *     "tentar de novo"; `shadow` lê e não escreve (M7).
 *  3. **Write-ahead (I18h):** a intenção vai ao ledger antes de cada chamada; antes do `finalizar`
 *     qualquer falha cancela a renegociação; depois, só para a frente. Escrita em tentativa única;
 *     sucesso é o que a releitura observa.
 *  4. **Reconhecimento (I18i):** retomada pelo marcador da obs; nunca segunda renegociação.
 *  5. **Rechaveamento (I18j):** transação local no repositório; aprovação humana pendente termina
 *     `aguardando_aprovacao_manual` (a decisão segue o título novo mesmo assim).
 */
@injectable()
export default class AjusteCentavosTituloService {
    public constructor(
        @inject(ConexosRenegociacaoClient) private readonly renegociacao: ConexosRenegociacaoClient,
        @inject(ConexosSessionRegistry) private readonly registry: ConexosSessionRegistry,
        @inject(AjusteCentavosExecucaoRepository)
        private readonly ledger: AjusteCentavosExecucaoRepository,
        @inject(SugestaoBoletoRepository) private readonly sugestoes: SugestaoBoletoRepository,
        @inject(BoletoDdaRepository) private readonly boletos: BoletoDdaRepository,
        @inject(TituloAPagarRepository) private readonly titulos: TituloAPagarRepository,
        @inject(LotePagamentoRepository) private readonly lotes: LotePagamentoRepository,
        @inject(ElegibilidadeAjusteCentavos)
        private readonly elegibilidade: ElegibilidadeAjusteCentavos,
        @inject(ServerProcessMarker) private readonly marcador: ServerProcessMarker,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
    ) {}

    // ── API ─────────────────────────────────────────────────────────────────

    /** Modo efetivo da filial (I18f/I18l/M3), com os motivos de rebaixamento a `shadow`. */
    public resolverModo = async (filCod: number): Promise<ModoEfetivoAjuste> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        return ModoAjusteCentavos.resolverModoEfetivo(filCod, {
            filiais: env.sispagAjusteCentavosFiliais ?? '',
            loginSondado: env.sispagAjusteCentavosLoginSondado ?? '',
            conexosLogin: env.conexosLogin ?? '',
            sispagLiveWriteEnabled: env.sispagLiveWriteEnabled === true,
            conexosWriteEnabled: env.conexosWriteEnabled === true,
            conexosDryRun: env.conexosDryRun !== false,
            processoServidor: this.marcador.ehServidor(),
        });
    };

    /**
     * Executa (ou simula, em `shadow`) o ajuste de UM título, serializado por título. Retoma o ledger
     * não terminal se houver; `concluido` ⇒ no-op.
     */
    public ajustar = async (p: PedidoAjuste): Promise<ResultadoAjuste> => {
        const { modo, avisos } = await this.resolverModo(p.filCod);
        if (modo === MODO_AJUSTE.OFF) return { resultado: RESULTADO_AJUSTE.DESLIGADO, modo };
        if (avisos.length > 0) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'ajuste de centavos rebaixado a shadow',
                data: { filCod: p.filCod, avisos },
            });
        }
        const chave = { filCod: p.filCod, docCod: p.docCod, titCod: p.titCod };
        return this.db.withAdvisoryLock(
            chaveDeLock(chave),
            () => this.ajustarComLock(p, modo),
            async () => ({ resultado: RESULTADO_AJUSTE.EM_ANDAMENTO, modo }),
        );
    };

    /**
     * "Tentar de novo" (`sispag:executar`): mesma ação. Inelegível ⇒ `CentsAdjustmentNotEligibleError`;
     * parou em transitório ⇒ `CentsAdjustmentIncompleteError` (retomável).
     */
    public tentarDeNovo = async (chave: Chave): Promise<ResultadoAjuste> => {
        const pendente = await this.ledger.buscarNaoTerminalPorOrigem(chave);
        const decisaoId =
            pendente?.decisaoId ??
            (
                await this.sugestoes.listarDecisoes({
                    decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
                    ...chave,
                })
            )[0]?.id;
        if (!decisaoId) {
            throw new CentsAdjustmentNotEligibleError({
                ...chave,
                motivo: 'SEM_DECISAO_CONFIRMADA',
            });
        }
        const r = await this.ajustar({
            ...chave,
            decisaoId,
            gatilho: GATILHO_AJUSTE.TENTAR_DE_NOVO,
        });
        if (r.resultado === RESULTADO_AJUSTE.DESLIGADO) {
            throw new CentsAdjustmentNotEligibleError({ ...chave, motivo: 'MODO_NAO_ON' });
        }
        if (
            r.resultado === RESULTADO_AJUSTE.RECUSADO ||
            r.resultado === RESULTADO_AJUSTE.NAO_CANDIDATO
        ) {
            throw new CentsAdjustmentNotEligibleError({
                ...chave,
                motivo: r.motivo ?? 'INELEGIVEL',
            });
        }
        if (r.resultado === RESULTADO_AJUSTE.EM_ANDAMENTO) {
            throw new CentsAdjustmentIncompleteError({
                ...chave,
                etapa: r.etapa ?? 'em_andamento',
            });
        }
        return r;
    };

    /** Varredura de retomada (I18g(3)): ledgers não terminais das filiais em `on`. */
    public retomarPendentes = async (p: {
        filCod?: number;
    }): Promise<{ retomados: number; ignorados: number; falhas: number }> => {
        const placar = { retomados: 0, ignorados: 0, falhas: 0 };
        for (const exec of await this.ledger.listarNaoTerminais(p.filCod)) {
            const { modo } = await this.resolverModo(exec.filCod);
            if (modo !== MODO_AJUSTE.ON) {
                placar.ignorados += 1;
                continue;
            }
            try {
                await this.ajustar({
                    filCod: exec.filCod,
                    docCod: exec.docCod,
                    titCod: exec.titCodOrigem,
                    decisaoId: exec.decisaoId,
                    gatilho: GATILHO_AJUSTE.VARREDURA,
                });
                placar.retomados += 1;
            } catch (err) {
                placar.falhas += 1;
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'ajuste de centavos: retomada falhou',
                    data: { execucaoId: exec.id, erro: this.descrever(err) },
                });
            }
        }
        return placar;
    };

    /** Estado dos ajustes da filial e o modo efetivo (endpoint + log, M7). Nunca código completo. */
    public listarCandidatos = async (p: {
        filCod: number;
    }): Promise<{ modo: ModoAjuste; avisos: string[]; ajustes: AjusteCentavosExecucao[] }> => {
        const { modo, avisos } = await this.resolverModo(p.filCod);
        const ajustes = await this.ledger.listarUltimosDaFilial(p.filCod);
        return { modo, avisos, ajustes };
    };

    /**
     * Disparo pós-commit do `confirmar` (I18g(1)): agenda e devolve na hora — a resposta do
     * `confirmar` nunca espera o ERP, e erro aqui nunca a muda. Depois do ajuste, varre os
     * pendentes da filial (M2).
     */
    public agendarAposConfirmar = (p: Omit<PedidoAjuste, 'gatilho'>): void => {
        void (async () => {
            try {
                const r = await this.ajustar({ ...p, gatilho: GATILHO_AJUSTE.CONFIRMAR });
                if (r.resultado === RESULTADO_AJUSTE.DESLIGADO) return;
                await this.retomarPendentes({ filCod: p.filCod });
            } catch (err) {
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'ajuste de centavos após confirmar falhou',
                    data: {
                        filCod: p.filCod,
                        titulo: `${p.docCod}/${p.titCod}`,
                        erro: this.descrever(err),
                    },
                });
            }
        })();
    };

    /**
     * Varredura de retomada pedida pela TELA do SISPAG ao abrir (I18g(3), M2): agenda e devolve na
     * hora; a tela nunca espera o ERP. Só no processo do servidor (o modo efetivo cuida disso).
     */
    public agendarVarredura = (p: { filCod?: number }): void => {
        void (async () => {
            try {
                const placar = await this.retomarPendentes(p);
                if (placar.retomados + placar.falhas > 0) {
                    await this.logService.info({
                        type: LOG_TYPE.BUSINESS_INFO,
                        message: 'ajuste de centavos: varredura de retomada',
                        data: { ...p, ...placar },
                    });
                }
            } catch (err) {
                await this.logService.error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'ajuste de centavos: varredura de retomada falhou',
                    data: { ...p, erro: this.descrever(err) },
                });
            }
        })();
    };

    // ── Execução ────────────────────────────────────────────────────────────

    private ajustarComLock = async (
        p: PedidoAjuste,
        modo: ModoAjuste,
    ): Promise<ResultadoAjuste> => {
        const sessao = this.registry.robot();
        const chave = { filCod: p.filCod, docCod: p.docCod, titCod: p.titCod };
        const naoTerminal = await this.ledger.buscarNaoTerminalPorOrigem(chave);
        if (naoTerminal && modo === MODO_AJUSTE.ON) {
            return this.conduzir(sessao, naoTerminal, undefined);
        }
        // I18i: reexecutar sobre ajuste já encerrado desta decisão é no-op (nada é relido nem escrito).
        const ultimo = await this.ledger.ultimoPorTitulo(chave);
        if (
            ultimo &&
            ultimo.titCodOrigem === p.titCod &&
            ultimo.decisaoId === p.decisaoId &&
            EtapaAjusteCentavos.ehTerminal(ultimo.etapa) &&
            ultimo.etapa !== ETAPA_AJUSTE.RECUSADO
        ) {
            return this.resultadoDe(ultimo, modo);
        }
        const ctx = await this.avaliarAoVivo(sessao, { ...chave, decisaoId: p.decisaoId }, modo);
        const e = ctx.elegibilidade;
        if (modo === MODO_AJUSTE.SHADOW) return this.simular(p, e, modo);
        if (!e.elegivel) {
            await this.evento(
                chave,
                p.decisaoId,
                EVENTO_SUGESTAO_BOLETO.AJUSTE_RECUSADO,
                e.motivo,
                {
                    gatilho: p.gatilho,
                },
            );
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'ajuste de centavos recusado: título inelegível',
                data: { ...chave, motivo: e.motivo, gatilho: p.gatilho },
            });
            return {
                resultado: RESULTADO_AJUSTE.RECUSADO,
                modo,
                ...(e.motivo ? { motivo: e.motivo } : {}),
            };
        }
        const env = await this.environmentProvider.getEnvironmentVars();
        const { execucao } = await this.ledger.abrir({
            filCod: p.filCod,
            docCod: p.docCod,
            titCodOrigem: p.titCod,
            decisaoId: p.decisaoId,
            ...(e.deltaCentavos !== undefined ? { deltaCentavos: e.deltaCentavos } : {}),
            ...(e.ajuste ? { frnVldTpop: e.ajuste.frnVldTpop } : {}),
            ...(e.valorBoletoCentavos !== undefined
                ? { valorBoletoCentavos: e.valorBoletoCentavos }
                : {}),
            ...(e.codigoMascarado ? { codigoMascarado: e.codigoMascarado } : {}),
            ...(env.conexosLogin ? { conexosUsername: env.conexosLogin } : {}),
        });
        if (EtapaAjusteCentavos.ehTerminal(execucao.etapa)) return this.resultadoDe(execucao, modo);
        return this.conduzir(sessao, execucao, ctx);
    };

    private simular = async (
        p: PedidoAjuste,
        e: ResultadoElegibilidadeAjuste,
        modo: ModoAjuste,
    ): Promise<ResultadoAjuste> => {
        const chave = { filCod: p.filCod, docCod: p.docCod, titCod: p.titCod };
        if (e.candidato) {
            await this.evento(
                chave,
                p.decisaoId,
                EVENTO_SUGESTAO_BOLETO.AJUSTE_SIMULADO,
                'CANDIDATO',
                {
                    deltaCentavos: e.deltaCentavos,
                    frnVldTpop: e.ajuste?.frnVldTpop,
                    codigoMascarado: e.codigoMascarado,
                },
            );
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: e.candidato
                ? 'ajuste de centavos (shadow): candidato, nenhuma escrita'
                : 'ajuste de centavos (shadow): não candidato',
            data: { ...chave, motivo: e.motivo, deltaCentavos: e.deltaCentavos },
        });
        return {
            resultado: e.candidato ? RESULTADO_AJUSTE.SIMULADO : RESULTADO_AJUSTE.NAO_CANDIDATO,
            modo,
            ...(e.motivo && !e.candidato ? { motivo: e.motivo } : {}),
        };
    };

    /** Laço da máquina (I18h): uma etapa por volta, até terminal ou parada retomável. */
    private conduzir = async (
        sessao: SessaoConexos,
        inicial: AjusteCentavosExecucao,
        ctxInicial: Contexto | undefined,
    ): Promise<ResultadoAjuste> => {
        let exec = inicial;
        let ctx = ctxInicial;
        await this.ledger.registrarTentativa(exec.id, this.identidade(sessao));
        for (let i = 0; i < MAX_PASSOS; i += 1) {
            if (EtapaAjusteCentavos.ehTerminal(exec.etapa)) break;
            if (EtapaAjusteCentavos.antesDoFinalizar(exec.etapa) && !ctx) {
                ctx = await this.avaliarAoVivo(
                    sessao,
                    {
                        filCod: exec.filCod,
                        docCod: exec.docCod,
                        titCod: exec.titCodOrigem,
                        decisaoId: exec.decisaoId,
                    },
                    MODO_AJUSTE.ON,
                );
            }
            const proximo = await this.avancar(sessao, exec, ctx);
            if (proximo === 'parar') break;
            exec = proximo;
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: `ajuste de centavos: etapa ${exec.etapa}`,
            data: this.dadosDoLog(exec),
        });
        return this.resultadoDe(exec, MODO_AJUSTE.ON);
    };

    private avancar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        ctx: Contexto | undefined,
    ): Promise<Passo> => {
        switch (exec.etapa) {
            case ETAPA_AJUSTE.PENDENTE:
                return this.criar(sessao, exec, ctx);
            case ETAPA_AJUSTE.RENEGOCIACAO_CRIADA:
                return this.incluir(sessao, exec, ctx);
            case ETAPA_AJUSTE.TITULO_INCLUIDO:
                return this.compor(sessao, exec, ctx);
            case ETAPA_AJUSTE.COMPOSICAO_GRAVADA:
                return this.aplicar(sessao, exec, ctx);
            case ETAPA_AJUSTE.AJUSTE_APLICADO:
                return this.finalizar(sessao, exec);
            case ETAPA_AJUSTE.FINALIZADA:
                return this.liberar(sessao, exec);
            case ETAPA_AJUSTE.LIBERADA:
            case ETAPA_AJUSTE.SEM_BLOQUEIO:
                return this.rechavear(sessao, exec, undefined);
            case ETAPA_AJUSTE.RECHAVEADA:
                return this.encerrar(exec);
            default:
                return 'parar';
        }
    };

    // ── Etapas antes do `finalizar` (falha ⇒ compensação) ─────────────────────

    private criar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        ctx: Contexto | undefined,
    ): Promise<Passo> => {
        if (!ctx?.elegibilidade.elegivel || !ctx.original) {
            return this.transicionar(exec, ETAPA_AJUSTE.RECUSADO, {
                motivo: ctx?.elegibilidade.motivo ?? 'INELEGIVEL',
            });
        }
        // I18i: tentativa anterior pode ter criado a renegociação sem ver a resposta.
        if (exec.intencao === 'criar_renegociacao') {
            const achou = await this.reconhecerPeloMarcador(sessao, exec);
            if (achou !== 'nenhuma') return achou;
        }
        const pesCod = ctx.original.pesCodFor ?? ctx.original.pesCod;
        if (pesCod === undefined) {
            return this.transicionar(exec, ETAPA_AJUSTE.RECUSADO, {
                motivo: 'FAVORECIDO_INDISPONIVEL',
            });
        }
        const mascara = (exec.codigoMascarado ?? '').replace('…', '*');
        const r = await this.passo(exec, 'criar_renegociacao', () =>
            this.renegociacao.criarRenegociacao(sessao, {
                filCod: exec.filCod,
                pesCod,
                dataRenegEpoch: this.calendar.toErpEpoch(this.calendar.todayBrt()),
                obs: `AJUSTE CENTAVOS KAVEX ${exec.marcador} BOLETO ${mascara}`,
            }),
        );
        if (r.ok) {
            return this.transicionar(exec, ETAPA_AJUSTE.RENEGOCIACAO_CRIADA, {
                frnCod: r.valor.frnCod,
            });
        }
        if (ConexosRenegociacaoClient.ehDeterministica(r.erro)) {
            return this.compensar(sessao, exec, `ERP_RECUSOU_CRIAR ${this.chaveErp(r.erro)}`);
        }
        const achou = await this.reconhecerPeloMarcador(sessao, exec);
        if (achou !== 'nenhuma') return achou;
        return this.compensar(sessao, exec, 'CRIAR_SEM_RESPOSTA');
    };

    private incluir = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        ctx: Contexto | undefined,
    ): Promise<Passo> => {
        const frnCod = exec.frnCod;
        const original = ctx?.original;
        if (frnCod === undefined || !original || original.docTip === undefined) {
            return this.compensar(sessao, exec, 'CONTEXTO_INDISPONIVEL');
        }
        if (exec.intencao === 'incluir_titulo') {
            const lida = await this.ler(() =>
                this.renegociacao.lerRenegociacao(sessao, { filCod: exec.filCod, frnCod }),
            );
            if (lida === undefined) return 'parar';
            const ja = lida.titulos.some(
                (t) => t.docCod === exec.docCod && t.titCod === exec.titCodOrigem,
            );
            if (ja) return this.transicionar(exec, ETAPA_AJUSTE.TITULO_INCLUIDO);
        }
        const docTip = original.docTip;
        const r = await this.passo(exec, 'incluir_titulo', () =>
            this.renegociacao.incluirTitulo(sessao, {
                filCod: exec.filCod,
                frnCod,
                docTip,
                docCod: exec.docCod,
                titCod: exec.titCodOrigem,
            }),
        );
        if (!r.ok) return this.compensar(sessao, exec, `INCLUIR_TITULO ${this.chaveErp(r.erro)}`);
        return this.transicionar(exec, ETAPA_AJUSTE.TITULO_INCLUIDO);
    };

    private compor = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        ctx: Contexto | undefined,
    ): Promise<Passo> => {
        const frnCod = exec.frnCod;
        const original = ctx?.original;
        const liquido = ctx?.elegibilidade.abertoLiquidoCentavos;
        if (
            frnCod === undefined ||
            !original ||
            original.docTip === undefined ||
            original.titDtaVencimento === undefined ||
            liquido === undefined
        ) {
            return this.compensar(sessao, exec, 'CONTEXTO_INDISPONIVEL');
        }
        // A composição não é observável barato: intenção pendente de outra tentativa ⇒ compensa.
        if (exec.intencao === 'gravar_composicao') {
            return this.compensar(sessao, exec, 'COMPOSICAO_AMBIGUA');
        }
        const docTip = original.docTip;
        const vencimentoEpoch = original.titDtaVencimento;
        const r = await this.passo(exec, 'gravar_composicao', () =>
            this.renegociacao.gravarComposicao(sessao, {
                filCod: exec.filCod,
                frnCod,
                docTip,
                docCod: exec.docCod,
                titCod: exec.titCodOrigem,
                valor: liquido / 100,
                vencimentoEpoch,
                ...(original.titEspNumero ? { frgEspNumero: original.titEspNumero } : {}),
                ...(original.pgtCod !== undefined ? { pgtCod: original.pgtCod } : {}),
                ...(original.dupEspOrdem ? { dupEspOrdem: original.dupEspOrdem } : {}),
            }),
        );
        if (!r.ok) return this.compensar(sessao, exec, `COMPOSICAO ${this.chaveErp(r.erro)}`);
        return this.transicionar(exec, ETAPA_AJUSTE.COMPOSICAO_GRAVADA);
    };

    private aplicar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        ctx: Contexto | undefined,
    ): Promise<Passo> => {
        const frnCod = exec.frnCod;
        const ajuste = ctx?.elegibilidade.ajuste;
        if (frnCod === undefined || !ajuste) {
            return this.compensar(sessao, exec, 'CONTEXTO_INDISPONIVEL');
        }
        const r = await this.passo(exec, 'aplicar_ajuste', () =>
            this.renegociacao.aplicarAjuste(sessao, {
                filCod: exec.filCod,
                frnCod,
                frnMnyValor: ajuste.frnMnyValor,
                frnVldTpop: ajuste.frnVldTpop,
            }),
        );
        if (!r.ok) return this.compensar(sessao, exec, `AJUSTE ${this.chaveErp(r.erro)}`);
        return this.transicionar(exec, ETAPA_AJUSTE.AJUSTE_APLICADO);
    };

    /**
     * Antes do `finalizar`: elegibilidade de novo, ao vivo; `mnyValorTotal == valorBoleto`. Depois
     * do `finalizar`: o título novo (I18d). Falha ambígua do `finalizar` ⇒ a releitura decide.
     */
    private finalizar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
    ): Promise<Passo> => {
        const frnCod = exec.frnCod;
        if (frnCod === undefined) return this.compensar(sessao, exec, 'SEM_FRNCOD');
        const ler = () =>
            this.renegociacao.lerRenegociacao(sessao, { filCod: exec.filCod, frnCod });
        if (exec.intencao === 'finalizar') {
            const lida = await this.ler(ler);
            if (lida === undefined) return 'parar';
            if (lida.finalizada) return this.identificarTituloNovo(sessao, exec, undefined);
        }
        const conferido = await this.conferirAntesDeFinalizar(sessao, exec, frnCod);
        if ('passo' in conferido) return conferido.passo;
        const r = await this.passo(exec, 'finalizar', () =>
            this.renegociacao.finalizarRenegociacao(sessao, { filCod: exec.filCod, frnCod }),
        );
        if (!r.ok) {
            if (ConexosRenegociacaoClient.ehDeterministica(r.erro)) {
                return this.compensar(sessao, exec, `FINALIZAR ${this.chaveErp(r.erro)}`);
            }
            const relida = await this.ler(ler);
            if (relida === undefined) return 'parar';
            if (!relida.finalizada) return this.compensar(sessao, exec, 'FINALIZAR_NAO_OBSERVADO');
        }
        return this.identificarTituloNovo(sessao, exec, conferido.titCodsAntes);
    };

    /**
     * Portão do `finalizar` (I18a/I18c): elegibilidade recalculada AO VIVO e `mnyValorTotal` da
     * renegociação == valor do boleto. Qualquer não ⇒ compensação (ainda é antes do `finalizar`).
     */
    private conferirAntesDeFinalizar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        frnCod: number,
    ): Promise<{ titCodsAntes: string[] } | { passo: Passo }> => {
        const chave = { filCod: exec.filCod, docCod: exec.docCod, titCod: exec.titCodOrigem };
        const ctx = await this.avaliarAoVivo(
            sessao,
            { ...chave, decisaoId: exec.decisaoId },
            MODO_AJUSTE.ON,
        );
        if (!ctx.elegibilidade.elegivel) {
            const motivo = `INELEGIVEL_ANTES_DE_FINALIZAR ${ctx.elegibilidade.motivo ?? ''}`;
            return { passo: await this.compensar(sessao, exec, motivo.trim()) };
        }
        const lida = await this.ler(() =>
            this.renegociacao.lerRenegociacao(sessao, { filCod: exec.filCod, frnCod }),
        );
        if (lida === undefined) return { passo: 'parar' };
        const total = lida.mnyValorTotal;
        if (total === undefined || centavos(total) !== exec.valorBoletoCentavos) {
            const motivo = 'TOTAL_DA_RENEGOCIACAO_DIVERGE_DO_BOLETO';
            return { passo: await this.compensar(sessao, exec, motivo) };
        }
        return { titCodsAntes: ctx.titCodsAntes };
    };

    /** I18d: exatamente UM candidato a título novo; zero ou vários ⇒ `indeterminado`. */
    private identificarTituloNovo = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        titCodsAntes: string[] | undefined,
    ): Promise<Passo> => {
        const doc = await this.ler(() =>
            this.renegociacao.listarTitulosDoDocumento(sessao, {
                filCod: exec.filCod,
                docCod: exec.docCod,
            }),
        );
        if (doc === undefined) return 'parar';
        const esperado = exec.valorBoletoCentavos;
        const ajuste = Math.abs(exec.deltaCentavos ?? 0);
        const candidatos = doc.filter((t) => {
            if (t.titCod === exec.titCodOrigem || titCodsAntes?.includes(t.titCod)) return false;
            const liquido = ValorAbertoLiquido.calcularCentavos(
                ValorAbertoLiquido.daLinhaFin064(t.raw),
            );
            const v = ValorAbertoLiquido.daLinhaFin064(t.raw);
            const acrescimo = centavos(
                exec.frnVldTpop === 2 ? (v.titMnyDesconto ?? 0) : (v.titMnyJuros ?? 0),
            );
            return liquido !== undefined && liquido === esperado && acrescimo === ajuste;
        });
        const originalAinda = doc.some((t) => t.titCod === exec.titCodOrigem);
        if (candidatos.length !== 1 || originalAinda) {
            return this.indeterminar(
                exec,
                `TITULO_NOVO_${candidatos.length === 0 ? 'AUSENTE' : 'AMBIGUO'}${originalAinda ? '_ORIGINAL_PRESENTE' : ''}`,
            );
        }
        return this.transicionar(exec, ETAPA_AJUSTE.FINALIZADA, {
            titCodNovo: (candidatos[0] as TituloDoDocumento).titCod,
        });
    };

    // ── Depois do `finalizar` (só para a frente) ────────────────────────────

    /** I18e: libera SÓ o bloqueio que a renegociação criou; o resto fica para outra pessoa. */
    private liberar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
    ): Promise<Passo> => {
        const titCodNovo = exec.titCodNovo;
        if (!titCodNovo) return this.indeterminar(exec, 'TITULO_NOVO_DESCONHECIDO');
        const estado = await this.lerLiberacao(sessao, exec, titCodNovo);
        if (estado === undefined) return 'parar';
        const { pendentes, novo } = estado;
        if (pendentes.length === 0) {
            if (novo?.vldLib === 1) return this.transicionar(exec, ETAPA_AJUSTE.SEM_BLOQUEIO);
            return this.rechavear(sessao, exec, 'TITULO_NOVO_SEM_LIBERACAO_VISIVEL');
        }
        const escolha = await this.comandoParaLiberar(sessao, exec, pendentes);
        if (escolha === 'parar') return 'parar';
        if ('manual' in escolha) return this.rechavear(sessao, exec, escolha.manual);
        const { bloqueio, fbaCod } = escolha;
        const alvo = { filCod: exec.filCod, linha: bloqueio.row, fbaCod };
        const r = await this.passo(exec, 'liberar', async () => {
            await this.renegociacao.validarSelecionado(sessao, alvo);
            await this.renegociacao.aplicarComando(sessao, alvo);
        });
        if (!r.ok && ConexosRenegociacaoClient.ehDeterministica(r.erro)) {
            return this.rechavear(sessao, exec, `ERP_RECUSOU_LIBERACAO ${this.chaveErp(r.erro)}`);
        }
        const depois = await this.lerLiberacao(sessao, exec, titCodNovo);
        if (depois === undefined) return 'parar';
        if (depois.pendentes.length === 0 && depois.novo?.vldLib === 1) {
            return this.transicionar(exec, ETAPA_AJUSTE.LIBERADA, { fblCod: bloqueio.fblCod });
        }
        if (!r.ok) return 'parar';
        return this.rechavear(sessao, exec, 'BLOQUEIO_PERMANECE');
    };

    /**
     * I18e: o único bloqueio pendente do título novo, com valor == boleto e exatamente UM comando
     * ativo "APROVAR" (lido ao vivo). Qualquer outra coisa ⇒ aprovação manual (`manual`).
     */
    private comandoParaLiberar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        pendentes: Awaited<ReturnType<ConexosRenegociacaoClient['listarBloqueios']>>,
    ): Promise<
        'parar' | { manual: string } | { bloqueio: (typeof pendentes)[number]; fbaCod: number }
    > => {
        if (pendentes.length > 1) return { manual: 'MAIS_DE_UM_BLOQUEIO' };
        const bloqueio = pendentes[0] as (typeof pendentes)[number];
        const total = bloqueio.titMnyTotal;
        if (total === undefined || centavos(total) !== exec.valorBoletoCentavos) {
            return { manual: 'VALOR_DO_BLOQUEIO_DIFERENTE' };
        }
        const comandos = await this.ler(() =>
            this.renegociacao.listarComandosDoBloqueio(sessao, {
                filCod: exec.filCod,
                fblCod: bloqueio.fblCod,
            }),
        );
        if (comandos === undefined) return 'parar';
        const aprovar = comandos.filter((c) => c.ativo && c.nome.toUpperCase() === COMANDO_APROVAR);
        if (aprovar.length !== 1) return { manual: 'COMANDO_APROVAR_AUSENTE_OU_AMBIGUO' };
        return { bloqueio, fbaCod: (aprovar[0] as (typeof aprovar)[number]).fbaCod };
    };

    private lerLiberacao = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        titCodNovo: string,
    ): Promise<
        | {
              pendentes: Awaited<ReturnType<ConexosRenegociacaoClient['listarBloqueios']>>;
              novo?: TituloDoDocumento;
          }
        | undefined
    > => {
        const ref = { filCod: exec.filCod, docCod: exec.docCod };
        const [bloqueios, doc] = await Promise.all([
            this.ler(() => this.renegociacao.listarBloqueios(sessao, ref)),
            this.ler(() => this.renegociacao.listarTitulosDoDocumento(sessao, ref)),
        ]);
        if (bloqueios === undefined || doc === undefined) return undefined;
        const novo = doc.find((t) => t.titCod === titCodNovo);
        return {
            pendentes: bloqueios.filter(
                (b) => b.titCod === titCodNovo && b.ftbVldStatus !== FTB_VLD_STATUS.LIBERADO,
            ),
            ...(novo ? { novo } : {}),
        };
    };

    /** I18j: rechaveamento local; `motivoManual` = a liberação ficou para outra pessoa. */
    private rechavear = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        motivoManual: string | undefined,
    ): Promise<Passo> => {
        const titCodNovo = exec.titCodNovo;
        const frnCod = exec.frnCod;
        if (!titCodNovo || frnCod === undefined)
            return this.indeterminar(exec, 'TITULO_NOVO_DESCONHECIDO');
        const doc = await this.ler(() =>
            this.renegociacao.listarTitulosDoDocumento(sessao, {
                filCod: exec.filCod,
                docCod: exec.docCod,
            }),
        );
        if (doc === undefined) return 'parar';
        const novo = doc.find((t) => t.titCod === titCodNovo);
        if (!novo || novo.titDtaVencimento === undefined) {
            return this.indeterminar(exec, 'TITULO_NOVO_AUSENTE_NO_RECHAVEAMENTO');
        }
        const liquido = ValorAbertoLiquido.calcularCentavos(
            ValorAbertoLiquido.daLinhaFin064(novo.raw),
        );
        const valorBase = novo.titMnyValor ?? Number(novo.raw.titMnyValor);
        if (liquido === undefined || !Number.isFinite(valorBase)) {
            return this.indeterminar(exec, 'VALOR_DO_TITULO_NOVO_ILEGIVEL');
        }
        const r = await this.ledger.rechavear({
            execucaoId: exec.id,
            etapaAtual: exec.etapa,
            filCod: exec.filCod,
            docCod: exec.docCod,
            titCodAntigo: exec.titCodOrigem,
            titCodNovo,
            frnCod,
            decisaoId: exec.decisaoId,
            ...(motivoManual ? { motivo: `${MOTIVO_APROVACAO_MANUAL}: ${motivoManual}` } : {}),
            tituloNovo: {
                valorBase,
                valorLiquido: liquido / 100,
                vencimentoEpoch: novo.titDtaVencimento,
                aprovado: novo.vldLib === 1,
            },
        });
        const relido = await this.ledger.buscarPorId(exec.id);
        if (!relido) return 'parar';
        return this.encerrar(relido, r.decisaoTransferida);
    };

    /** `rechaveada` ⇒ terminal: concluido | concluido_sem_decisao | aguardando_aprovacao_manual. */
    private encerrar = async (
        exec: AjusteCentavosExecucao,
        decisaoTransferida?: boolean,
    ): Promise<Passo> => {
        const transferida =
            decisaoTransferida ??
            (
                await this.sugestoes.listarDecisoes({
                    decisao: DECISAO_SUGESTAO_BOLETO.CONFIRMADA,
                    filCod: exec.filCod,
                    docCod: exec.docCod,
                    ...(exec.titCodNovo ? { titCod: exec.titCodNovo } : {}),
                })
            ).some((d) => d.origemDecisaoId === exec.decisaoId);
        if (exec.motivo?.startsWith(MOTIVO_APROVACAO_MANUAL)) {
            await this.alertar(exec, 'aguardando aprovação manual no Conexos (fin103)');
            return this.transicionar(exec, ETAPA_AJUSTE.AGUARDANDO_APROVACAO_MANUAL);
        }
        if (!transferida) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'ajuste de centavos concluído sem decisão: a analista anulou a confirmação',
                data: this.dadosDoLog(exec),
            });
            return this.transicionar(exec, ETAPA_AJUSTE.CONCLUIDO_SEM_DECISAO);
        }
        return this.transicionar(exec, ETAPA_AJUSTE.CONCLUIDO);
    };

    // ── Compensação e falhas ────────────────────────────────────────────────

    /**
     * Antes do `finalizar` (I18h): cancela a renegociação e relê. Sem renegociação criada ⇒
     * `cancelado` direto. Cancelamento que falha (inclusive a rota ainda não provada, G3) ⇒
     * `indeterminado` + alerta — nunca uma segunda renegociação por cima.
     */
    private compensar = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
        motivo: string,
    ): Promise<Passo> => {
        const frnCod = exec.frnCod;
        if (frnCod === undefined) {
            const passo = await this.transicionar(exec, ETAPA_AJUSTE.CANCELADO, { motivo });
            await this.eventoDoLedger(exec, EVENTO_SUGESTAO_BOLETO.AJUSTE_CANCELADO, motivo);
            return passo;
        }
        const r = await this.passo(exec, 'cancelar', () =>
            this.renegociacao.cancelarRenegociacao(sessao, { filCod: exec.filCod, frnCod }),
        );
        if (r.ok) {
            const lida = await this.ler(() =>
                this.renegociacao.lerRenegociacao(sessao, { filCod: exec.filCod, frnCod }),
            );
            if (lida?.cancelada === true) {
                const passo = await this.transicionar(exec, ETAPA_AJUSTE.CANCELADO, { motivo });
                await this.eventoDoLedger(exec, EVENTO_SUGESTAO_BOLETO.AJUSTE_CANCELADO, motivo);
                return passo;
            }
        }
        return this.indeterminar(
            exec,
            `${motivo}; CANCELAMENTO_FALHOU${r.ok ? '' : ` ${this.descrever(r.erro)}`}`,
        );
    };

    private indeterminar = async (exec: AjusteCentavosExecucao, motivo: string): Promise<Passo> => {
        const passo = await this.transicionar(exec, ETAPA_AJUSTE.INDETERMINADO, { motivo });
        await this.eventoDoLedger(exec, EVENTO_SUGESTAO_BOLETO.AJUSTE_FALHOU, motivo);
        await this.alertar({ ...exec, motivo }, 'indeterminado — ação humana no Conexos');
        return passo;
    };

    private alertar = async (exec: AjusteCentavosExecucao, situacao: string): Promise<void> => {
        await this.logService.error({
            type: LOG_TYPE.BUSINESS_WARN,
            message: `ajuste de centavos ${situacao}`,
            data: this.dadosDoLog(exec),
        });
    };

    /** I18i: renegociação achada pelo marcador da obs (resposta do `POST` perdida). */
    private reconhecerPeloMarcador = async (
        sessao: SessaoConexos,
        exec: AjusteCentavosExecucao,
    ): Promise<Passo | 'nenhuma'> => {
        const achadas = await this.ler(() =>
            this.renegociacao.buscarRenegociacaoPorMarcador(sessao, {
                filCod: exec.filCod,
                marcador: exec.marcador,
            }),
        );
        if (achadas === undefined) return 'parar';
        if (achadas.length === 0) return 'nenhuma';
        if (achadas.length > 1)
            return this.indeterminar(exec, 'MARCADOR_EM_MAIS_DE_UMA_RENEGOCIACAO');
        return this.transicionar(exec, ETAPA_AJUSTE.RENEGOCIACAO_CRIADA, {
            frnCod: achadas[0] as number,
        });
    };

    // ── Leitura ao vivo (I18a) ──────────────────────────────────────────────

    private avaliarAoVivo = async (
        sessao: SessaoConexos,
        k: Chave & { decisaoId: string },
        modo: ModoAjuste,
    ): Promise<Contexto> => {
        const chave = { filCod: k.filCod, docCod: k.docCod, titCod: k.titCod };
        const lida = await this.sugestoes.buscarDecisaoPorId(k.decisaoId);
        const decisao =
            lida && lida.filCod === k.filCod && lida.docCod === k.docCod && lida.titCod === k.titCod
                ? lida
                : undefined;
        const [boleto, carteira, par, emLoteFechado, linhagem, doc] = await Promise.all([
            decisao
                ? this.boletos.buscarPorChave({ ddcCod: decisao.ddcCod, ditCod: decisao.ditCod })
                : null,
            this.titulos.buscarPorChave(chave),
            decisao?.confirmacaoEmissorId
                ? this.sugestoes.buscarParPorId(decisao.confirmacaoEmissorId)
                : null,
            this.lotes.tituloEmLoteFechado(chave),
            this.ledger.buscarConcluidoPorTitCodNovo(chave),
            this.renegociacao.listarTitulosDoDocumento(sessao, {
                filCod: k.filCod,
                docCod: k.docCod,
            }),
        ]);
        const original = doc.find((t) => t.titCod === k.titCod);
        const vencimentoEpoch = original?.titDtaVencimento ?? carteira?.vencimento;
        const titCodsAntes = doc.map((t) => t.titCod);
        if (vencimentoEpoch === undefined) {
            return {
                elegibilidade: {
                    elegivel: false,
                    candidato: false,
                    motivo: MOTIVO_INELEGIVEL_AJUSTE.VALOR_ABERTO_INDISPONIVEL,
                },
                titCodsAntes,
            };
        }
        const numeroTitulo = carteira?.numeroDocumento ?? original?.raw.docEspNumero;
        const elegibilidade = this.elegibilidade.avaliar({
            modo,
            ...this.entradaDaDecisao(decisao, boleto, carteira?.temBoleto === true, par?.estado),
            ...(numeroTitulo ? { numeroTitulo: String(numeroTitulo) } : {}),
            ...(boleto?.numero ? { numeroBoleto: boleto.numero } : {}),
            ...(boleto?.codbar ? { codigo: boleto.codbar } : {}),
            vencimentoTitulo: new Date(vencimentoEpoch).toISOString().slice(0, 10),
            ...(original ? { aberto: ValorAbertoLiquido.daLinhaFin064(original.raw) } : {}),
            aprovadoNoErp: original?.vldLib === 1,
            aprovadoNaCarteira: carteira?.liberado === true,
            pago: original?.vldPago === 1 || carteira?.pago === true,
            jaAjustadoNaLinhagem: linhagem != null,
            emLoteFinalizado: emLoteFechado,
            emRascunhoNativo: original
                ? ConexosRenegociacaoClient.emItemSispag(original.raw)
                : false,
        });
        return { elegibilidade, ...(original ? { original } : {}), titCodsAntes };
    };

    // ── Peças ───────────────────────────────────────────────────────────────

    /**
     * A decisão humana como a regra a vê (I18a(1)): órfã quando o boleto sumiu do pool, foi ligado
     * pelo próprio ERP a um título, ou a carteira já tem DDA; par VIGENTE pelo estado do par.
     */
    private entradaDaDecisao = (
        decisao: Awaited<ReturnType<SugestaoBoletoRepository['buscarDecisaoPorId']>> | undefined,
        boleto: Awaited<ReturnType<BoletoDdaRepository['buscarPorChave']>>,
        carteiraTemBoleto: boolean,
        estadoPar: string | undefined,
    ): Pick<EntradaElegibilidadeAjuste, 'decisao'> => {
        if (!decisao) return {};
        const ligadoPeloErp =
            boleto != null &&
            boleto.filCod != null &&
            boleto.docCod != null &&
            boleto.titCod != null;
        return {
            decisao: {
                id: decisao.id,
                decisao: decisao.decisao,
                orfa: boleto == null || ligadoPeloErp || carteiraTemBoleto,
                parVigente: estadoPar === 'VIGENTE',
            },
        };
    };

    /** Write-ahead: intenção gravada ANTES da chamada; a falha volta como valor, não exceção. */
    private passo = async <T>(
        exec: AjusteCentavosExecucao,
        intencao: string,
        fn: () => Promise<T>,
    ): Promise<{ ok: true; valor: T } | { ok: false; erro: unknown }> => {
        await this.ledger.registrarIntencao(exec.id, intencao);
        exec.intencao = intencao;
        try {
            return { ok: true, valor: await fn() };
        } catch (erro) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message: `ajuste de centavos: ${intencao} falhou`,
                data: { ...this.dadosDoLog(exec), erro: this.descrever(erro) },
            });
            return { ok: false, erro };
        }
    };

    /** Leitura (com o retry do client): `undefined` = indisponível ⇒ a etapa para, retomável. */
    private ler = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
        try {
            return await fn();
        } catch (err) {
            await this.logService.warn({
                type: LOG_TYPE.BUSINESS_WARN,
                message:
                    'ajuste de centavos: leitura no Conexos falhou — etapa fica para a retomada',
                data: { erro: this.descrever(err) },
            });
            return undefined;
        }
    };

    private transicionar = async (
        exec: AjusteCentavosExecucao,
        para: EtapaAjuste,
        campos: { frnCod?: number; titCodNovo?: string; fblCod?: number; motivo?: string } = {},
    ): Promise<Passo> => {
        const avancou = await this.ledger.registrarResultado(exec.id, exec.etapa, para, campos);
        if (!avancou) return 'parar';
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: `ajuste de centavos: ${exec.etapa} → ${para}`,
            data: {
                ...this.dadosDoLog({ ...exec, ...campos, etapa: para }),
                de: exec.etapa,
                marcador: exec.marcador,
                tentativas: exec.tentativas,
            },
        });
        return (await this.ledger.buscarPorId(exec.id)) ?? 'parar';
    };

    private evento = async (
        chave: Chave,
        decisaoId: string,
        tipo: EventoSugestaoBoleto,
        motivo: string | undefined,
        detalhe: Record<string, unknown>,
    ): Promise<void> => {
        await this.sugestoes.inserirEventoAjuste({
            tipo,
            ator: SISPAG_SYSTEM_ACTOR,
            filCod: chave.filCod,
            docCod: chave.docCod,
            titCod: chave.titCod,
            decisaoId,
            ...(motivo ? { motivo } : {}),
            detalhe: Object.fromEntries(Object.entries(detalhe).filter(([, v]) => v !== undefined)),
        });
    };

    private eventoDoLedger = async (
        exec: AjusteCentavosExecucao,
        tipo: EventoSugestaoBoleto,
        motivo: string,
    ): Promise<void> =>
        this.evento(
            { filCod: exec.filCod, docCod: exec.docCod, titCod: exec.titCodOrigem },
            exec.decisaoId,
            tipo,
            motivo,
            {
                execucaoId: exec.id,
                etapa: exec.etapa,
                frnCod: exec.frnCod,
                codigoMascarado: exec.codigoMascarado,
            },
        );

    private resultadoDe = (exec: AjusteCentavosExecucao, modo: ModoAjuste): ResultadoAjuste => {
        const terminal = EtapaAjusteCentavos.ehTerminal(exec.etapa);
        const resultado =
            exec.etapa === ETAPA_AJUSTE.RECUSADO
                ? RESULTADO_AJUSTE.RECUSADO
                : terminal
                  ? RESULTADO_AJUSTE.EXECUTADO
                  : RESULTADO_AJUSTE.EM_ANDAMENTO;
        return {
            resultado,
            modo,
            etapa: exec.etapa,
            execucaoId: exec.id,
            ...(exec.motivo ? { motivo: exec.motivo } : {}),
        };
    };

    private identidade = (sessao: SessaoConexos): { conexosUsnCod?: string } => {
        const usn = sessao.getCapturedUsnCod?.();
        return usn ? { conexosUsnCod: usn } : {};
    };

    private dadosDoLog = (exec: AjusteCentavosExecucao): Record<string, unknown> => ({
        execucaoId: exec.id,
        filCod: exec.filCod,
        titulo: `${exec.docCod}/${exec.titCodOrigem}`,
        etapa: exec.etapa,
        ...(exec.frnCod !== undefined ? { frnCod: exec.frnCod } : {}),
        ...(exec.titCodNovo ? { titCodNovo: exec.titCodNovo } : {}),
        ...(exec.motivo ? { motivo: exec.motivo } : {}),
        ...(exec.codigoMascarado ? { codigoMascarado: exec.codigoMascarado } : {}),
    });

    private chaveErp = (err: unknown): string => ConexosRenegociacaoClient.codigoErp(err) ?? '';

    private descrever = (err: unknown): string =>
        (err instanceof Error ? err.message : String(err)).replace(/\d{20,}/g, '…');
}
