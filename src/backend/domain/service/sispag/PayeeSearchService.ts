import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import {
    AUTHORIZED_PAYEE_MODALITY,
    type AuthorizedPayeeModality,
    type AuthorizedPayeeState,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import AuthorizedPayeeRepository from '../../repository/sispag/AuthorizedPayeeRepository.js';

/** Menor texto que a busca leva ao Conexos (código e documento, só dígitos, vão com qualquer tamanho). */
const TEXTO_MINIMO = 3;

export interface FavorecidoEncontrado {
    pesCod: string;
    nome: string;
    nomeFantasia?: string;
    /** CPF/CNPJ pela `MaskDestino.documento`. O valor completo não sai do backend. */
    documentoMascarado?: string;
    /** `pesVldStatus` do cadastro (1 ATIVO, 2 INATIVO, 3 EM CADASTRO, 4 BLOQUEADO, 5 NÃO VENDER). */
    situacao?: number;
    autorizacao: Record<
        AuthorizedPayeeModality,
        { estado: AuthorizedPayeeState | 'NENHUMA'; id?: string }
    >;
}

export interface BuscaFavorecidos {
    favorecidos: FavorecidoEncontrado[];
    truncado: boolean;
}

/**
 * PayeeSearchService — ação read-only `buscarFavorecidoConexos`: acha o favorecido no cadastro do
 * Conexos (`cmn025`) por nome, nome fantasia, CPF/CNPJ ou código, para quem pede a autorização
 * não precisar abrir o Conexos. Devolve o documento só mascarado e o estado da autorização
 * vigente de cada modalidade (a tela não oferece pedir o que já está pedido). NENHUMA escrita.
 *
 * Lê o cadastro na filial do tenant (`sispagCadastroFilCod`), a mesma que o pedido usa.
 */
@injectable()
export default class PayeeSearchService {
    public constructor(
        @inject(ConexosSispagClient) private readonly sispag: ConexosSispagClient,
        @inject(AuthorizedPayeeRepository) private readonly autorizacoes: AuthorizedPayeeRepository,
        @inject(MaskDestino) private readonly mask: MaskDestino,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
    ) {}

    public buscar = async (termo: string): Promise<BuscaFavorecidos> => {
        const limpo = termo.trim();
        const soDigitos = /^[\d.\-/\s]+$/.test(limpo);
        if (!soDigitos && limpo.length < TEXTO_MINIMO) return { favorecidos: [], truncado: false };

        const env = await this.environmentProvider.getEnvironmentVars();
        const { pessoas, truncado } = await this.sispag.buscarPessoas(
            limpo,
            env.sispagCadastroFilCod,
        );
        if (pessoas.length === 0) return { favorecidos: [], truncado };

        const vigentes = await this.autorizacoes.listarVigentesPorPesCods(
            pessoas.map((p) => p.pesCod),
        );
        const autorizacao = (pesCod: string, modalidade: AuthorizedPayeeModality) => {
            const v = vigentes.find((a) => a.pesCod === pesCod && a.modalidade === modalidade);
            return v ? { estado: v.estado, id: v.id } : { estado: 'NENHUMA' as const };
        };
        return {
            favorecidos: pessoas.map((p) => ({
                pesCod: p.pesCod,
                nome: p.nome,
                ...(p.nomeFantasia ? { nomeFantasia: p.nomeFantasia } : {}),
                ...(p.documento ? { documentoMascarado: this.mask.documento(p.documento) } : {}),
                ...(p.situacao !== undefined ? { situacao: p.situacao } : {}),
                autorizacao: {
                    TED: autorizacao(p.pesCod, AUTHORIZED_PAYEE_MODALITY.TED),
                    PIX: autorizacao(p.pesCod, AUTHORIZED_PAYEE_MODALITY.PIX),
                },
            })),
            truncado,
        };
    };
}
