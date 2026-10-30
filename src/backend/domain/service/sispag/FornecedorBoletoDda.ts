import { inject, injectable } from 'tsyringe';
import type { BoletoDdaConsolidado } from '../../interface/sispag/BoletoDda.js';
import ContaBeneficiariaBoleto from '../../libs/boleto/ContaBeneficiariaBoleto.js';
import FornecedorContaBoletoRepository from '../../repository/sispag/FornecedorContaBoletoRepository.js';

/**
 * FornecedorBoletoDda — passo de ENRIQUECIMENTO da aba "Boletos DDA" (ADR-0081): põe `fornecedor`
 * em cada boleto cuja conta do beneficiário já foi aprendida. Roda DEPOIS da consolidação e não
 * altera situação nem candidatos. Só lê; chave ambígua ou desconhecida deixa o boleto sem nome.
 */
@injectable()
export default class FornecedorBoletoDda {
    public constructor(
        @inject(FornecedorContaBoletoRepository)
        private readonly repo: FornecedorContaBoletoRepository,
        @inject(ContaBeneficiariaBoleto) private readonly conta: ContaBeneficiariaBoleto,
    ) {}

    public enriquecer = async (linhas: BoletoDdaConsolidado[]): Promise<BoletoDdaConsolidado[]> => {
        const mapeamentos = await this.repo.listMapeamentos();
        if (mapeamentos.size === 0) return linhas;
        return linhas.map((b) => {
            const chave = this.conta.chave(b.codbar);
            const m = chave === undefined ? undefined : mapeamentos.get(chave);
            if (!m || m.ambiguo || m.pesCod === undefined || m.credor === undefined) return b;
            return {
                ...b,
                fornecedor: { pesCod: m.pesCod, nome: m.credor, origem: m.origem },
            };
        });
    };
}
