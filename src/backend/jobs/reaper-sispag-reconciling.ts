import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { LOG_TYPE } from '../domain/interface/log/LogInterface.js';
import ConciliacaoExecucaoRepository from '../domain/repository/sispag/ConciliacaoExecucaoRepository.js';
import RemessaExecucaoRepository from '../domain/repository/sispag/RemessaExecucaoRepository.js';
import LogService from '../domain/service/LogService.js';

/**
 * Reaper de execuções SISPAG presas em `reconciling` (remessa e conciliação).
 *
 * O fail-closed protege o dinheiro mas não avisa ninguém: uma execução que morreu no meio
 * fica invisível até um operador esbarrar no 409 da tela — que pode ser dias depois, ou
 * nunca, se ninguém tentar de novo. Enquanto isso pode haver um lote de pagamento órfão no
 * ERP, e a próxima remessa daquele lote está travada.
 *
 * NÃO AGE. Só publica. Cancelar um rascunho no fin015 ou decidir que uma baixa já existe é
 * decisão humana com dinheiro no meio — automatizar isso trocaria um problema visível por
 * um invisível. A mesma consulta está em `GET /sispag/execucoes?paradasHaMin=`.
 *
 * CRON (não configurado — entrada documentada):
 *   *\/15 * * * *  cd /caminho/do/repo/src/backend && npm run job:reaper-sispag
 *
 * Exit 0 mesmo achando órfãos: achar é o trabalho, não é falha do job. Exit não-zero só
 * quando o próprio reaper falha (banco fora), para o agendador registrar.
 */
const MINUTOS = Number(process.env.SISPAG_REAPER_MIN ?? 15);
const LIMITE = Number(process.env.SISPAG_REAPER_LIMIT ?? 100);

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const logService = container.resolve(LogService);
    const remessaRepo = container.resolve(RemessaExecucaoRepository);
    const conciliacaoRepo = container.resolve(ConciliacaoExecucaoRepository);

    // `warn`, não `error`: achar um órfão é o job funcionando. Logado como ERROR isto
    // vira um 500 na trilha e acorda quem estiver de plantão por um resultado esperado.
    const remessas = await remessaRepo.listReconcilingParadas(MINUTOS, LIMITE);
    const conciliacoes = await conciliacaoRepo.listReconcilingParadas(MINUTOS, LIMITE);

    for (const r of remessas) {
        await logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'remessa presa em reconciling — possível lote órfão no Conexos',
            data: {
                idempotencyKey: r.idempotencyKey,
                loteId: r.loteId,
                filCod: r.filCod,
                bncCod: r.bncCod,
                // Com `nativeFlpCod` o operador vai direto no fin015. Sem ele, a interrupção
                // foi antes de registrarmos o número — varrer por filial/banco desde `criadoEm`.
                nativeFlpCod: r.nativeFlpCod,
                etapa: r.etapa,
                paradaDesde: r.atualizadoEm,
            },
        });
        console.warn(
            `[reaper-sispag] remessa ${r.idempotencyKey} lote=${r.loteId} fil=${r.filCod} ` +
                `flp=${r.nativeFlpCod ?? 'DESCONHECIDO'} etapa=${r.etapa ?? '?'} desde=${r.atualizadoEm}`,
        );
    }

    for (const c of conciliacoes) {
        await logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'conciliação presa em reconciling — baixas do fin010 em estado incerto',
            data: {
                idempotencyKey: c.idempotencyKey,
                filCod: c.filCod,
                bncCod: c.bncCod,
                garCodSeq: c.garCodSeq,
                // `processou=true` significa que o PUT chegou a sair: as baixas PODEM existir.
                processou: c.processou,
                paradaDesde: c.atualizadoEm,
            },
        });
        console.warn(
            `[reaper-sispag] conciliacao ${c.idempotencyKey} fil=${c.filCod} arq=${c.garCodSeq} ` +
                `processou=${c.processou} desde=${c.atualizadoEm}`,
        );
    }

    const total = remessas.length + conciliacoes.length;
    console.log(
        `[reaper-sispag] ${total} execução(ões) parada(s) há mais de ${MINUTOS} min ` +
            `(remessa=${remessas.length} conciliacao=${conciliacoes.length})`,
    );
};

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[reaper-sispag] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });
