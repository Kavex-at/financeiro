import { inject, injectable } from 'tsyringe';
import PermutaAlocacaoRepository, {
    type AlocacaoRow,
} from '../../repository/permutas/PermutaAlocacaoRepository.js';
import PermutaExecucaoRepository, {
    type ConsumoExecucaoRow,
} from '../../repository/permutas/PermutaExecucaoRepository.js';

/** O que a regra precisa de uma alocação: o par e a versão (`atualizadoEm`). */
export type AlocacaoVersao = Pick<
    AlocacaoRow,
    'adiantamentoDocCod' | 'invoiceDocCod' | 'valorAlocado' | 'atualizadoEm'
>;

/**
 * SaldoAlocacaoAdiantamentoService — ÚNICA fonte da regra "quanto das alocações de um adiantamento
 * ainda NÃO foi abatido pelo ERP" (ADR-0046 D3). Consumida pela tela (`GestaoPermutasService`,
 * `saldoRestante` de `permuta-manual` e `casamento-manual`) e pelo teto de I-Permuta-1
 * (`AlocacaoPermutasService.alocar`), para que os dois nunca divirjam.
 *
 * Por quê: o `valorPermutar` (`mnyTitPermutar`) já vem ABATIDO pelo ERP para o que foi baixado em
 * borderô finalizado. Subtrair TODAS as alocações contava o consumido duas vezes (adto 12860 ia a
 * −19.257,73; o 9328 travava em 4.304,94 com 39.652,47 de saldo real).
 *
 *   saldoRestanteNeg = valorPermutar(BRL) / taxa − Σ naoConsumido(alocação)
 *
 * **Regra por versão (A2 do scoping):** `permuta_alocacao` tem uma linha por par, e re-alocar
 * sobrescreve `valor_alocado` e renova `atualizado_em`. Uma execução pertence à versão ATUAL quando
 * `execucao.criadoEm >= alocacao.atualizadoEm` (mesmo relógio, o `now()` do Postgres; a execução
 * sempre nasce depois do UPSERT). Execuções de versões anteriores não abatem a atual — o que elas
 * consumiram já saiu do `valorPermutar` e não está em linha de alocação nenhuma.
 *   - consumo `settled` da versão atual → 0;
 *   - consumo `parcial` da versão atual → `min(valorResidualUsd, valorAlocado)` (só a parte baixada
 *     saiu; sem resíduo gravado, o alocado inteiro — conservador);
 *   - sem consumo → `valorAlocado` inteiro.
 * Havendo mais de um consumo da mesma versão, vale o mais recente.
 *
 * **O que é "consumo"** (execução real e terminal, borderô finalizado e vivo, visto pelo cache antes
 * da ingestão — guarda de frescor) é filtrado na query: `PermutaExecucaoRepository
 * .listConsumosFinalizados`. Na dúvida, não conta: subestimar o saldo nunca permite super-alocação.
 */
@injectable()
export default class SaldoAlocacaoAdiantamentoService {
    constructor(
        @inject(PermutaAlocacaoRepository)
        private alocacaoRepository: PermutaAlocacaoRepository,
        @inject(PermutaExecucaoRepository)
        private execucaoRepository: PermutaExecucaoRepository,
    ) {}

    /** Parte da alocação ainda NÃO abatida pelo ERP (moeda negociada). Puro. */
    public naoConsumido = (
        alocacao: AlocacaoVersao,
        consumos: ReadonlyArray<ConsumoExecucaoRow>,
    ): number => {
        const daVersaoAtual = consumos.filter(
            (c) =>
                c.adiantamentoDocCod === alocacao.adiantamentoDocCod &&
                c.invoiceDocCod === alocacao.invoiceDocCod &&
                c.criadoEm.getTime() >= alocacao.atualizadoEm.getTime(),
        );
        const maisRecente = daVersaoAtual.reduce<ConsumoExecucaoRow | undefined>(
            (atual, c) =>
                atual === undefined || c.criadoEm.getTime() > atual.criadoEm.getTime() ? c : atual,
            undefined,
        );
        if (maisRecente === undefined) return alocacao.valorAlocado;
        if (maisRecente.status === 'settled') return 0;
        if (maisRecente.valorResidualUsd === undefined) return alocacao.valorAlocado;
        return Math.min(Math.max(0, maisRecente.valorResidualUsd), alocacao.valorAlocado);
    };

    /** Σ não consumido das alocações, opcionalmente EXCLUINDO um par (re-alocação). Puro. */
    public somaNaoConsumida = (
        alocacoes: ReadonlyArray<AlocacaoVersao>,
        consumos: ReadonlyArray<ConsumoExecucaoRow>,
        excludeInvoiceDocCod?: string,
    ): number =>
        alocacoes
            .filter((al) => al.invoiceDocCod !== excludeInvoiceDocCod)
            .reduce((soma, al) => soma + this.naoConsumido(al, consumos), 0);

    /** Consumos de TODOS os adtos, agrupados por adto — uma query para o painel inteiro. */
    public carregarConsumosPorAdiantamento = async (): Promise<
        Map<string, ConsumoExecucaoRow[]>
    > => {
        const consumos = await this.execucaoRepository.listConsumosFinalizados();
        const porAdto = new Map<string, ConsumoExecucaoRow[]>();
        for (const c of consumos) {
            const lista = porAdto.get(c.adiantamentoDocCod) ?? [];
            lista.push(c);
            porAdto.set(c.adiantamentoDocCod, lista);
        }
        return porAdto;
    };

    /** Σ não consumido das alocações de UM adto (teto do `alocar`), excluindo o par re-alocado. */
    public somaNaoConsumidaDoAdiantamento = async (
        adiantamentoDocCod: string,
        excludeInvoiceDocCod?: string,
    ): Promise<number> => {
        const [alocacoes, consumos] = await Promise.all([
            this.alocacaoRepository.listByAdiantamento(adiantamentoDocCod),
            this.execucaoRepository.listConsumosFinalizados(adiantamentoDocCod),
        ]);
        return this.somaNaoConsumida(alocacoes, consumos, excludeInvoiceDocCod);
    };
}
