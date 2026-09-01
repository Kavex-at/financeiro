import { inject, injectable } from 'tsyringe';
import {
    ALERTA_SEVERIDADE,
    ALERTA_TIPO,
    type AlertaNovo,
} from '../../interface/operacao/Alerta.js';
import {
    CONFIG_MANIFESTO,
    CRITICIDADE,
    type Criticidade,
    type Frente,
    type VarManifesto,
} from '../../interface/operacao/configManifest.js';
import NotificacaoService from './NotificacaoService.js';

/** Estado de UMA var. Note que não há campo de valor — ver I3 na docstring da classe. */
export const ESTADO_CONFIG = {
    CONFIGURADO: 'configurado',
    AUSENTE: 'ausente',
    USANDO_DEFAULT: 'usando-default',
} as const;

export type EstadoConfig = (typeof ESTADO_CONFIG)[keyof typeof ESTADO_CONFIG];

export interface DiagnosticoVar {
    nome: string;
    frente: Frente;
    criticidade: Criticidade;
    estado: EstadoConfig;
    consequenciaSeAusente: string;
    segredo: boolean;
    default?: string;
}

export interface DiagnosticoConfig {
    geradoEm: string;
    vars: DiagnosticoVar[];
    totalAusentesObrigatorias: number;
    totalAusentesSilenciosas: number;
}

/**
 * ConfigDoctor — confronta o manifesto com o ambiente do processo (ADR-0042).
 *
 * **I3 — nunca imprime valor de segredo.** A saída é a CLASSIFICAÇÃO, jamais o conteúdo:
 * `configurado | ausente | usando-default`. Vale para o log de boot e para a resposta HTTP. Um
 * diagnóstico de configuração que vaza credencial troca um problema de operação por um de
 * segurança. Por isso `DiagnosticoVar` **não tem campo de valor** — a garantia é estrutural, não
 * uma disciplina de quem escreve o próximo `console.log`.
 *
 * **Exceção deliberada à Inviolable Rule #8** (nunca `process.env` cru em service): a função deste
 * serviço é justamente inspecionar o ambiente BRUTO. Ler via `EnvironmentProvider` mostraria o
 * valor já resolvido — com defaults aplicados — e tornaria impossível distinguir "o operador
 * configurou" de "o provider preencheu". Essa distinção é o produto inteiro deste serviço.
 */
@injectable()
export default class ConfigDoctor {
    constructor(
        @inject(NotificacaoService) private readonly notificacaoService: NotificacaoService,
    ) {}

    public diagnosticar = (ambiente: NodeJS.ProcessEnv = process.env): DiagnosticoConfig => {
        const vars = CONFIG_MANIFESTO.map((m) => this.diagnosticarVar(m, ambiente));
        const ausente = (c: Criticidade) =>
            vars.filter((v) => v.estado === ESTADO_CONFIG.AUSENTE && v.criticidade === c).length;

        return {
            geradoEm: new Date().toISOString(),
            vars,
            totalAusentesObrigatorias: ausente(CRITICIDADE.OBRIGATORIA),
            totalAusentesSilenciosas: ausente(CRITICIDADE.DEGRADA_SILENCIOSAMENTE),
        };
    };

    private diagnosticarVar = (m: VarManifesto, ambiente: NodeJS.ProcessEnv): DiagnosticoVar => ({
        nome: m.nome,
        frente: m.frente,
        criticidade: m.criticidade,
        estado: this.estado(m, ambiente),
        consequenciaSeAusente: m.consequenciaSeAusente,
        segredo: m.segredo,
        ...(m.default !== undefined ? { default: m.default } : {}),
    });

    /**
     * Vazio conta como AUSENTE, não como configurado.
     *
     * `RECEBIMENTO_TITULARES_INTERNOS=""` desliga a detecção exatamente como a ausência total —
     * tratar string vazia como "configurado" reproduziria o defeito original com uma tela verde
     * por cima, que é pior do que não ter tela.
     */
    private estado = (m: VarManifesto, ambiente: NodeJS.ProcessEnv): EstadoConfig => {
        const bruto = ambiente[m.nome];
        if (bruto !== undefined && bruto.trim() !== '') return ESTADO_CONFIG.CONFIGURADO;
        return m.default !== undefined ? ESTADO_CONFIG.USANDO_DEFAULT : ESTADO_CONFIG.AUSENTE;
    };

    /**
     * Roda no boot: diagnostica e alerta o que falta. **Nunca derruba o processo** — diagnostica,
     * não impede de subir (I5 aplicado ao boot). Um processo que se recusa a subir por causa do
     * seu próprio diagnóstico derruba o sistema inteiro em vez do recurso configurado errado.
     */
    public verificarNoBoot = async (
        ambiente: NodeJS.ProcessEnv = process.env,
        agora: Date = new Date(),
    ): Promise<DiagnosticoConfig> => {
        const diagnostico = this.diagnosticar(ambiente);
        const problematicas = diagnostico.vars.filter(
            (v) => v.estado === ESTADO_CONFIG.AUSENTE && v.criticidade !== CRITICIDADE.OPCIONAL,
        );

        for (const v of problematicas) {
            await this.emitirSeguro(this.alertaDe(v, agora));
        }
        return diagnostico;
    };

    private alertaDe = (v: DiagnosticoVar, agora: Date): AlertaNovo => ({
        tipo: ALERTA_TIPO.CONFIG_AUSENTE,
        alvo: v.nome,
        severidade:
            v.criticidade === CRITICIDADE.OBRIGATORIA
                ? ALERTA_SEVERIDADE.ERRO
                : ALERTA_SEVERIDADE.AVISO,
        // Janela = o boot. Reiniciar o processo com a var ainda faltando merece dizer de novo.
        janelaInicio: agora,
        // Só metadado do manifesto — nada lido do ambiente entra aqui (I3).
        detalhe: {
            frente: v.frente,
            criticidade: v.criticidade,
            consequencia: v.consequenciaSeAusente,
        },
    });

    /** O diagnóstico não pode ser a causa de o processo não subir. */
    private emitirSeguro = async (alerta: AlertaNovo): Promise<void> => {
        try {
            await this.notificacaoService.emitir(alerta);
        } catch {
            // silêncio deliberado: ver `verificarNoBoot`.
        }
    };
}
