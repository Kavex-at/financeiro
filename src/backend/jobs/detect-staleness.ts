import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import StalenessDetector from '../domain/service/operacao/StalenessDetector.js';

/**
 * Job detector de staleness (ADR-0042).
 *
 * Compara a idade da última run `success` de cada pipeline com o limite daquele pipeline
 * (`ontology/business-rules/staleness-por-pipeline.md`) e emite `job-parado` / `job-falhou` /
 * `job-parcial`, com deduplicação por janela.
 *
 * **NÃO toca o Conexos.** Só lê Postgres — não precisa de credencial do ERP e, o que importa mais,
 * não disputa os ~3 slots de `LOGIN_ERROR_MAX_SESSIONS` com os crons que ele vigia. Um detector
 * que causasse o incidente que existe para detectar seria absurdo.
 *
 * CRON: de hora em hora no minuto :45 (`.github/workflows/detect-staleness.yml`). Hora em hora
 * cobre o limite mais apertado (extratos, 3h) com folga de sobra; a janela de dedup do detector
 * garante 1 alerta por limite decorrido em vez de 1 por rodada.
 *
 * **Ponto cego conhecido:** hospedado no próprio GitHub Actions, este job não enxerga o GH Actions
 * parar de disparar. Mitigação parcial é o I6 — o painel computa staleness na leitura, então quem
 * abrir a tela vê a verdade mesmo sem este job ter rodado. Cobertura completa pede um dead-man's
 * switch externo (follow-up da ADR-0042).
 *
 * Exit 0 mesmo tendo emitido alertas: alerta emitido é o job FUNCIONANDO. Exit non-zero só quando
 * a própria detecção falha.
 */
const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const resultado = await container.resolve(StalenessDetector).detectar();

    for (const i of resultado.inspecionados) {
        console.log(`[detect-staleness] ${i.pipeline}: ${i.situacao}`);
    }

    if (resultado.emitidos.length === 0) {
        console.log('[detect-staleness] nenhum alerta novo.');
    } else {
        for (const a of resultado.emitidos) {
            console.log(`[detect-staleness] ALERTA ${a.tipo} · ${a.alvo} · ${a.severidade}`);
        }
        console.log(`[detect-staleness] ${resultado.emitidos.length} alerta(s) emitido(s).`);
    }
};

main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error('[detect-staleness] falhou:', error);
        process.exit(1);
    });
