import { injectable } from 'tsyringe';
import { processoCandidatosSeed } from '../../../interface/recebimentos/__fixtures__/processo.fixture.js';
import type { Processo } from '../../../interface/recebimentos/GerDocProcesso.js';
import type {
    ClienteProcesso,
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
            if (input.pesCod !== undefined) return p.pesCod === input.pesCod;
            if (!contraparte) return true;
            // Frouxo: bate se a contraparte da transação aparece na do processo (ou vice-versa).
            const alvo = (p.contraparte ?? p.dpeNomPessoa).toLowerCase();
            return alvo.includes(contraparte) || contraparte.includes(alvo);
        });
    };

    /** Processos abertos da filial — insumo da previsão de modalidade do painel (ADR-0033). */
    public listProcessosDaFilial = async (filCod: number): Promise<Processo[]> =>
        this.candidatos.filter((p) => p.filCod === filCod);

    public listClientes = async (input: { filCod: number }): Promise<ClienteProcesso[]> => {
        const porCliente = new Map<number, ClienteProcesso>();
        for (const p of this.candidatos) {
            if (p.filCod !== input.filCod) continue;
            const atual = porCliente.get(p.pesCod);
            if (atual) atual.processosAbertos += 1;
            else
                porCliente.set(p.pesCod, {
                    pesCod: p.pesCod,
                    dpeNomPessoa: p.dpeNomPessoa,
                    processosAbertos: 1,
                });
        }
        return [...porCliente.values()].sort((a, b) =>
            a.dpeNomPessoa.localeCompare(b.dpeNomPessoa, 'pt-BR'),
        );
    };
}
