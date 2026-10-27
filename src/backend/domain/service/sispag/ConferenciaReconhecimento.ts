import DivergenceAcknowledgementRequiredError from '../../errors/DivergenceAcknowledgementRequiredError.js';
import DivergenceAcknowledgementStaleError from '../../errors/DivergenceAcknowledgementStaleError.js';
import {
    RECONHECIMENTO_TIPO,
    type ReconhecimentoDecisao,
} from '../../interface/sispag/ConfirmacaoEmissorBoleto.js';
import {
    EXIGE_RECONHECIMENTO,
    SINAL_SUGESTAO,
    type SinalSugestao,
    type SugestaoBoletoTitulo,
} from '../../interface/sispag/SugestaoBoleto.js';
import type { ReconhecimentoDivergenciaBody } from '../../interface/sispag/SugestaoBoletoSchemas.js';
import ReconhecimentoDivergencia from '../../libs/boleto/ReconhecimentoDivergencia.js';

export interface ChaveParaReconhecimento {
    filCod: number;
    docCod: string;
    titCod: string;
    ddcCod: number;
    ditCod: number;
}

export interface ReconhecimentoConferido {
    /** Sinais a gravar na decisão (com `RECONHECEU_VENCE_ANTES` e `DATA_DIVERGENTE_RECONHECIDA`). */
    sinais: SinalSugestao[];
    /** O que gravar em `DecisaoSugestaoBoleto.reconhecimento` (sem a hora, que é do servidor). */
    reconhecimento: Omit<ReconhecimentoDecisao, 'reconhecidoEm'>;
}

/**
 * Confere o reconhecimento tipado da divergência de data (I15r, ADR-0078) contra a avaliação
 * RECALCULADA ao vivo — nunca contra o cache nem contra o que a tela mostrou (anti-TOCTOU, I15a).
 * Só age quando o candidato `exigeReconhecimento = DATA_DIVERGENTE`; senão devolve `undefined` e
 * quem chama segue pelo aviso simples (I15o).
 */
export default class ConferenciaReconhecimento {
    public static conferir = (p: {
        sugestao: SugestaoBoletoTitulo;
        chave: ChaveParaReconhecimento;
        enviado?: ReconhecimentoDivergenciaBody;
        /** Autor do JWT: nunca do corpo. */
        ator: string;
        codigoMascarado?: string;
    }): ReconhecimentoConferido | undefined => {
        const { sugestao, chave, enviado, ator } = p;
        const avaliacao = sugestao.avaliacao;
        if (avaliacao.exigeReconhecimento !== EXIGE_RECONHECIMENTO.DATA_DIVERGENTE) {
            return undefined;
        }
        const atual = {
            deltaDiasAtual: avaliacao.deltaDias,
            valorBoletoAtual: Math.round(sugestao.valorBoleto * 100),
        };
        const mascarado = p.codigoMascarado ? { codigoMascarado: p.codigoMascarado } : {};
        if (!enviado) {
            throw new DivergenceAcknowledgementRequiredError({
                ...chave,
                deltaDias: atual.deltaDiasAtual,
                valorBoleto: atual.valorBoletoAtual,
                vencimentoTitulo: sugestao.vencimentoTitulo,
                vencimentoBoleto: sugestao.vencimentoBoleto,
                ...mascarado,
            });
        }
        if (!ReconhecimentoDivergencia.valido(enviado, atual)) {
            throw new DivergenceAcknowledgementStaleError({
                ...chave,
                deltaDiasVisto: enviado.deltaDiasVisto,
                deltaDiasAtual: atual.deltaDiasAtual,
                valorBoletoVisto: enviado.valorBoletoVisto,
                valorBoletoAtual: atual.valorBoletoAtual,
                ...mascarado,
            });
        }
        const sinais: SinalSugestao[] = [...avaliacao.sinais];
        // O ack tipado IMPLICA o aviso simples de Δ<0 (I15o emendada): os consumidores não mudam.
        if (avaliacao.sinais.includes(SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO)) {
            sinais.push(SINAL_SUGESTAO.RECONHECEU_VENCE_ANTES);
        }
        sinais.push(SINAL_SUGESTAO.DATA_DIVERGENTE_RECONHECIDA);
        return {
            sinais,
            reconhecimento: {
                tipo: RECONHECIMENTO_TIPO.DATA_DIVERGENTE,
                motivo: enviado.motivo,
                deltaDiasVisto: enviado.deltaDiasVisto,
                valorBoletoVisto: enviado.valorBoletoVisto,
                reconhecidoPor: ator,
            },
        };
    };
}
