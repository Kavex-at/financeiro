import { injectable } from 'tsyringe';
import { processoCandidatosSeed } from '../../../interface/recebimentos/__fixtures__/processo.fixture.js';
import type { Processo } from '../../../interface/recebimentos/GerDocProcesso.js';
import type {
    ListCandidatosInput,
    ProcessoProviderInterface,
} from '../../../interface/recebimentos/ports.js';

/**
 * STUB — `ProcessoProviderInterface`. In-memory (fixtures), determinístico, sem DB/rede/matching.
 * Lista os processos candidatos para uma transação: filtra por `filCod` (multi-filial, invariante)
 * e, quando informada, aplica um casamento FROUXO por contraparte (substring case-insensitive). O
 * Módulo 2/2b troca este token pela fonte real (Conexos / matching) sem tocar rota/serviço.
 */
@injectable()
export default class ProcessoProviderStub implements ProcessoProviderInterface {
    private readonly candidatos: Processo[] = processoCandidatosSeed;

    public listCandidatosParaTransacao = async (
        input: ListCandidatosInput,
    ): Promise<Processo[]> => {
        const contraparte = input.contraparte?.trim().toLowerCase();
        return this.candidatos.filter((p) => {
            if (p.filCod !== input.filCod) return false;
            if (!contraparte) return true;
            // Frouxo: bate se a contraparte da transação aparece na do processo (ou vice-versa).
            const alvo = (p.contraparte ?? p.dpeNomPessoa).toLowerCase();
            return alvo.includes(contraparte) || contraparte.includes(alvo);
        });
    };
}
