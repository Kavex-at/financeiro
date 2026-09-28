import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import type { Alerta } from '../domain/interface/operacao/Alerta.js';
import type { PipelineSaude } from '../domain/interface/operacao/JobRun.js';
import { LOG_TYPE } from '../domain/interface/log/LogInterface.js';
import AlertaRepository from '../domain/repository/operacao/AlertaRepository.js';
import ConfigDoctor, { type DiagnosticoConfig } from '../domain/service/operacao/ConfigDoctor.js';
import JobRunReadModel from '../domain/service/operacao/JobRunReadModel.js';
import LogService from '../domain/service/LogService.js';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import { exigirPermissao } from '../http/acesso.js';
import { asyncHandler } from '../http/asyncHandler.js';

/** Quantos alertas abertos a tela lista. */
const ALERTAS_LIMIT = 50;

/** Zod no boundary — `:id` do reconhecimento. */
const reconhecerParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Painel de Operação (ADR-0042) — saúde dos pipelines, alertas abertos e diagnóstico de
 * configuração.
 *
 * **Invariante I4 — esta rota NÃO toca o Conexos.** É a tela que se abre justamente quando o ERP
 * está fora; se ela dependesse dele, falharia exatamente no momento em que é necessária. Tudo vem
 * do Postgres (`JobRunReadModel`, `AlertaRepository`) e do ambiente do processo (`ConfigDoctor`).
 * Isto a distingue do painel de Recebimentos, que legitimamente enriquece contra o ERP (ADR-0038):
 * lá o ERP acrescenta informação a uma tela já útil sem ele; aqui o ERP não tem nada a dizer.
 *
 * **Acesso:** as duas rotas exigem `operacao:ver` (ADR-0053, que aposentou o allow-list por env da
 * ADR-0042). Sem ela, 404 sem corpo explicativo (ADR-0042): para quem não opera, o
 * painel não existe. Reconhecer alerta também é `operacao:ver` (JC-5 — não há `operacao:executar`).
 */
const router = Router();

/** Fontes do painel — cada uma pode falhar sozinha sem derrubar as outras. */
const FONTE_PAINEL = {
    PIPELINES: 'pipelines',
    ALERTAS: 'alertas',
    CONFIGURACAO: 'configuracao',
} as const;
type FontePainel = (typeof FONTE_PAINEL)[keyof typeof FONTE_PAINEL];

/** Uma fonte que não pôde ser lida nesta resposta. */
interface ErroFontePainel {
    fonte: FontePainel;
    mensagem: string;
}

/** Texto ao operador por fonte. O `err.message` técnico vai só para o log, nunca para o corpo. */
const MENSAGEM_FALHA: Readonly<Record<FontePainel, string>> = {
    [FONTE_PAINEL.PIPELINES]: 'Não foi possível ler a saúde dos pipelines.',
    [FONTE_PAINEL.ALERTAS]: 'Não foi possível ler os alertas abertos.',
    [FONTE_PAINEL.CONFIGURACAO]: 'Não foi possível montar o diagnóstico de configuração.',
};

/** Registra a falha de uma fonte. Best-effort: logar nunca pode derrubar a tela de incidente. */
const logarFalhaFonte = async (fonte: FontePainel, err: unknown): Promise<void> => {
    try {
        await container.resolve(LogService).error({
            type: LOG_TYPE.FLOW_ERROR,
            message: `painel de operação: falha ao ler ${fonte}`,
            data: { fonte, erro: err instanceof Error ? err.message : String(err) },
        });
    } catch {
        // logging é best-effort.
    }
};

// GET /operacao — a leitura completa do painel.
//
// É a tela que se abre DURANTE o incidente, então uma fonte lenta ou quebrada não pode levar as
// outras junto: cada leitura é independente (`allSettled`) e a que falhar volta vazia, nomeada em
// `erros[]`. O formato de `pipelines`/`alertas`/`configuracao` não muda — `erros` é aditivo.
router.get(
    '/',
    exigirPermissao(PERMISSION.OPERACAO_VER),
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();

        const [saude, abertos, diagnostico] = await Promise.allSettled([
            container.resolve(JobRunReadModel).exporSaude(),
            container.resolve(AlertaRepository).listarAbertos(ALERTAS_LIMIT),
            // Síncrono e barato: lê o manifesto contra o ambiente do processo. Dentro do
            // `allSettled` para que um throw aqui também vire `erros[]`, não 500.
            Promise.resolve().then(() => container.resolve(ConfigDoctor).diagnosticar()),
        ]);

        const geradoEm = new Date().toISOString();
        const erros: ErroFontePainel[] = [];
        const lerFonte = async <T>(
            fonte: FontePainel,
            resultado: PromiseSettledResult<T>,
            vazio: T,
        ): Promise<T> => {
            if (resultado.status === 'fulfilled') return resultado.value;
            erros.push({ fonte, mensagem: MENSAGEM_FALHA[fonte] });
            await logarFalhaFonte(fonte, resultado.reason);
            return vazio;
        };

        const pipelines = await lerFonte<PipelineSaude[]>(FONTE_PAINEL.PIPELINES, saude, []);
        const alertas = await lerFonte<Alerta[]>(FONTE_PAINEL.ALERTAS, abertos, []);
        const configuracao = await lerFonte<DiagnosticoConfig>(
            FONTE_PAINEL.CONFIGURACAO,
            diagnostico,
            { geradoEm, vars: [], totalAusentesObrigatorias: 0, totalAusentesSilenciosas: 0 },
        );

        res.json({ geradoEm, pipelines, alertas, configuracao, erros });
    }),
);

// POST /operacao/alertas/:id/reconhecer — tira o alerta da lista de abertos.
router.post(
    '/alertas/:id/reconhecer',
    exigirPermissao(PERMISSION.OPERACAO_VER),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = reconhecerParamsSchema.safeParse(req.params);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid id', details: parsed.error.flatten() });
            return;
        }
        const por = req.user?.sub ?? req.user?.email ?? 'unknown';
        await container.resolve(AlertaRepository).reconhecer(parsed.data.id, por);
        res.json({ ok: true });
    }),
);

export default router;
