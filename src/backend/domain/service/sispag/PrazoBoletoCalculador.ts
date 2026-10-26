import { ORIGEM_PRAZO, type PrazoBoleto } from '../../interface/sispag/PrazoBoleto.js';
import {
    type CandidatoTitulo,
    type DesfechoTitulo,
    RESULTADO_SUGESTAO,
    SITUACAO_SUGESTAO_TITULO,
} from '../../interface/sispag/SugestaoBoleto.js';
import PrazoFinalBoleto from '../../libs/boleto/PrazoFinalBoleto.js';
import type { CivilDate } from '../../libs/calendar/BankingCalendar.js';

/**
 * Prazo efetivo do título pelo boleto sugerido (I19t, ADR-0078). PURO: sem I/O e sem relógio — o
 * "hoje" entra por argumento. Derivado a cada leitura, nunca persistido (I19n).
 *
 *   prazoEfetivo = min(vencimento do título, prazo final do candidato acionável mais cedo)
 *
 * Acionável = `CONHECIDO`/`FORTE` (inclui ambíguos seguros), `ATENCAO` com âncora, ou a decisão
 * `CONFIRMADA` não órfã. `SO_FRACA`, `VENCIDO_INFORMATIVO`, perdedor de disputa e órfã nunca puxam o
 * prazo; única exceção de leitura: o par de valor igual + âncora `VENCIDO_INFORMATIVO` com barra `< hoje`
 * marca `perdido` (I19t(5), G1) sem alterar o `prazoEfetivo`.
 * O prazo final da barra é o vencimento rolado ao próximo dia útil bancário (I15h).
 */
export default class PrazoBoletoCalculador {
    public static paraTitulo = (p: {
        /** Vencimento do título, dia civil (sem rolagem, ADR-0070). */
        vencimentoTitulo: CivilDate;
        /** Desfecho do título no motor; ausente = título sem sugestão. */
        desfecho: DesfechoTitulo | undefined;
        hoje: CivilDate;
    }): PrazoBoleto => {
        const { vencimentoTitulo, desfecho, hoje } = p;
        const doTitulo: PrazoBoleto = {
            prazoEfetivo: vencimentoTitulo,
            origem: ORIGEM_PRAZO.TITULO,
            vencimentoTitulo,
            perdido: false,
        };
        if (!desfecho || desfecho.situacao === SITUACAO_SUGESTAO_TITULO.ORFA) return doTitulo;

        const confirmada = desfecho.situacao === SITUACAO_SUGESTAO_TITULO.CONFIRMADA;
        const acionaveis = desfecho.candidatos
            .filter((c) => PrazoBoletoCalculador.acionavel(c, confirmada))
            .map((c) => ({ c, prazoFinal: PrazoBoletoCalculador.prazoFinal(c) }));
        const maisCedo = acionaveis.reduce<(typeof acionaveis)[number] | undefined>(
            (melhor, atual) => (!melhor || atual.prazoFinal < melhor.prazoFinal ? atual : melhor),
            undefined,
        );
        // G1 (decisão 2026-10-26): o par de valor igual + âncora que a I15h já marcou
        // `VENCIDO_INFORMATIVO` com barra `< hoje` também é "perdido" — mas NÃO puxa o prazo.
        const perdidoInformativo = desfecho.candidatos.some((c) =>
            PrazoBoletoCalculador.perdidoInformativo(c, desfecho.valorTitulo, hoje),
        );
        if (!maisCedo) return perdidoInformativo ? { ...doTitulo, perdido: true } : doTitulo;

        const puxa = maisCedo.prazoFinal < vencimentoTitulo;
        return {
            prazoEfetivo: puxa ? maisCedo.prazoFinal : vencimentoTitulo,
            origem: puxa ? ORIGEM_PRAZO.BOLETO_SUGERIDO : ORIGEM_PRAZO.TITULO,
            vencimentoTitulo,
            ...(puxa ? { vencimentoBoleto: maisCedo.c.vencimentoBoleto } : {}),
            ...(acionaveis.length > 1 ? { totalCandidatos: acionaveis.length } : {}),
            perdido: maisCedo.prazoFinal < hoje || perdidoInformativo,
        };
    };

    private static acionavel = (c: CandidatoTitulo, confirmada: boolean): boolean => {
        if (c.reservadoParaTitulo) return false;
        if (confirmada) return true;
        const { resultado } = c.avaliacao;
        if (resultado === RESULTADO_SUGESTAO.CONHECIDO || resultado === RESULTADO_SUGESTAO.FORTE) {
            return true;
        }
        return resultado === RESULTADO_SUGESTAO.ATENCAO && c.ancorado;
    };

    private static perdidoInformativo = (
        c: CandidatoTitulo,
        valorTitulo: number,
        hoje: CivilDate,
    ): boolean =>
        c.avaliacao.resultado === RESULTADO_SUGESTAO.VENCIDO_INFORMATIVO &&
        !c.reservadoParaTitulo &&
        c.ancorado &&
        c.valorBoleto === valorTitulo &&
        PrazoBoletoCalculador.prazoFinal(c) < hoje;

    private static prazoFinal = (c: CandidatoTitulo): CivilDate =>
        c.avaliacao.prazoFinalBoleto ??
        PrazoFinalBoleto.calcular(c.vencimentoBoleto) ??
        c.vencimentoBoleto;
}
