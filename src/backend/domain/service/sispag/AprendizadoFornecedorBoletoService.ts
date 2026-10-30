import { inject, injectable } from 'tsyringe';
import {
    FORNECEDOR_ORIGEM,
    type EvidenciaConta,
    type ResultadoAprendizadoFornecedor,
} from '../../interface/sispag/FornecedorContaBoleto.js';
import ContaBeneficiariaBoleto from '../../libs/boleto/ContaBeneficiariaBoleto.js';
import FornecedorContaBoletoRepository from '../../repository/sispag/FornecedorContaBoletoRepository.js';
import ConsolidacaoFornecedorConta from './ConsolidacaoFornecedorConta.js';

/**
 * AprendizadoFornecedorBoletoService — reconstrói o mapeamento conta do beneficiário → fornecedor
 * (ADR-0081). Chamado ao fim da sincronização do pool DDA; NUNCA na leitura da aba nem no
 * `bootstrapAppContainer`. Determinístico: a mesma evidência dá o mesmo mapeamento, então rodar
 * duas vezes não muda nada. Não escreve no Conexos.
 */
@injectable()
export default class AprendizadoFornecedorBoletoService {
    public constructor(
        @inject(FornecedorContaBoletoRepository)
        private readonly repo: FornecedorContaBoletoRepository,
        @inject(ContaBeneficiariaBoleto) private readonly conta: ContaBeneficiariaBoleto,
        @inject(ConsolidacaoFornecedorConta)
        private readonly consolidacao: ConsolidacaoFornecedorConta,
    ) {}

    public aprender = async (): Promise<ResultadoAprendizadoFornecedor> => {
        const evidencias: EvidenciaConta[] = [];
        for (const e of await this.repo.listEvidencias()) {
            // Banco sem layout validado não tem chave: a evidência dele não serve de nada.
            const chave = this.conta.chave(e.codbar);
            if (chave === undefined) continue;
            evidencias.push({
                chave,
                pesCod: e.pesCod,
                ...(e.credor ? { credor: e.credor } : {}),
                origem: e.origem,
                boleto: e.codbar,
                vistoEm: e.vistoEm,
            });
        }
        const mapeamentos = this.consolidacao.consolidar(evidencias);
        await this.repo.substituir(mapeamentos);
        return {
            chaves: mapeamentos.length,
            ambiguas: mapeamentos.filter((m) => m.ambiguo).length,
            porOrigem: {
                [FORNECEDOR_ORIGEM.VINCULADO]: this.contar(mapeamentos, 'VINCULADO'),
                [FORNECEDOR_ORIGEM.CONFIRMADO]: this.contar(mapeamentos, 'CONFIRMADO'),
                [FORNECEDOR_ORIGEM.INFERIDO]: this.contar(mapeamentos, 'INFERIDO'),
            },
        };
    };

    private contar = (
        mapeamentos: Array<{ origem: string; ambiguo: boolean }>,
        origem: string,
    ): number => mapeamentos.filter((m) => m.origem === origem && !m.ambiguo).length;
}
