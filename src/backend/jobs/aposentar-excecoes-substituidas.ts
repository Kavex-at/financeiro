import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import ExcecaoDestinoService from '../domain/service/sispag/ExcecaoDestinoService.js';

/**
 * Varredura de aposentadoria das exceções de destino SISPAG (ADR-0061, I12c; gap Q3).
 *
 * Para cada exceção `APROVADA`, lê o cadastro do favorecido no Conexos (`cmn025`, SOMENTE LEITURA)
 * com a MESMA função do resolver — a da oferta e do envio — e, se o cadastro passou a ter destino
 * válido (conta ativa p/ TED, chave ativa p/ PIX), a exceção vai a `SUBSTITUIDA` e nunca é usada.
 * Valor do cadastro diferente do da exceção: evento `DIVERGENCIA_CADASTRO` na trilha (mascarado) e
 * `Alerta` `sispag-excecao-divergencia`. Idempotente: rodar de novo não duplica nada.
 *
 * É a metade em lote do que o resolver já faz ao finalizar e ao enviar. Existe para o caso da
 * exceção que ninguém mais resolve (o favorecido sumiu dos lotes) e o cadastro foi corrigido.
 *
 * SEM scheduler próprio: roda à mão ou por um workflow do GitHub Actions (hoje não há workflow
 * para ele). Fala com o Conexos, por isso usa o `bootstrapAppContainer` como os demais jobs do
 * SISPAG — e NADA dele entra no bootstrap, que é compartilhado por ~58 jobs.
 *
 * Exit 0 mesmo com leituras falhas isoladas (o resto da varredura segue); exit 1 só quando TODAS
 * as leituras falharam ou o job quebrou antes de varrer. Log em português, só contagens e ids: nunca
 * conta, chave ou documento (I10h).
 */
const main = async (): Promise<number> => {
    await bootstrapAppContainer();
    const r = await container.resolve(ExcecaoDestinoService).aposentarSubstituidas();
    console.log(
        `[aposentar-excecoes-substituidas] inspecionadas=${r.inspecionadas} aposentadas=${r.aposentadas} falhas=${r.falhas}`,
    );
    return r.inspecionadas > 0 && r.falhas === r.inspecionadas ? 1 : 0;
};

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(
            '[aposentar-excecoes-substituidas] falhou:',
            redactErrorMessage(e instanceof Error ? e.message : String(e)),
        );
        process.exit(1);
    });
