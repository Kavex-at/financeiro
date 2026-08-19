import { injectable } from 'tsyringe';
import {
    ACAO_CONCLUSIVA,
    ACAO_REJEICAO,
    ETAPA_STATUS,
    ETAPA_STATUS_ERP,
    LACUNA,
} from '../../interface/aprovacoes/constants.js';
import type { EtapaStatus, Lacuna } from '../../interface/aprovacoes/constants.js';
import type { FinTituloBloqRow } from '../../interface/aprovacoes/EtapaAprovacao.js';

/** Normaliza o rótulo de ação do ERP para comparação (vem em caixa alta, mas com folga). */
const normalizarAcao = (raw?: string | null): string | undefined => {
    const texto = (raw ?? '').trim().toUpperCase();
    return texto.length > 0 ? texto : undefined;
};

/**
 * EtapaStatusResolver — traduz uma linha crua de `FinTituloBloq` para o status de domínio da etapa.
 *
 * **Este é o único lugar que decide se uma etapa terminou.** A doutrina, herdada da máquina de
 * estados (`ontology/state-machines/etapa-aprovacao.md`), é errar sempre para o lado de "não sei":
 * qualquer coisa que não saibamos ler com certeza vira `INDETERMINADO` **com lacuna**, nunca
 * `CONCLUIDA`. Classificar como aprovada uma etapa ilegível contaminaria o tempo médio de um painel
 * financeiro auditável — e, pior, de forma invisível.
 */
@injectable()
export default class EtapaStatusResolver {
    /**
     * Ordem de precedência:
     *
     * 1. `ftbVldStatus` fora do mapa conhecido → `INDETERMINADO` (**PV-01**: os 13 casos de `7`).
     * 2. Mapa diz `PENDENTE` → pendente, ponto.
     * 3. Mapa diz `CONCLUIDA` → olha a **ação**: `LIBERAR`/`APROVAR` concluem; uma ação de recusa
     *    rejeita; ação desconhecida ou ausente num status "respondido" → `INDETERMINADO`.
     * 4. Timestamps incoerentes (`agidoEm < recebidoEm`) → mantém o status, mas registra a lacuna;
     *    a duração não é calculada (`DuracaoCalculator`).
     */
    public resolver = (row: FinTituloBloqRow): { status: EtapaStatus; lacunas: Lacuna[] } => {
        const lacunas: Lacuna[] = [];

        const statusErp = row.ftbVldStatus ?? undefined;
        const mapeado = statusErp === undefined ? undefined : ETAPA_STATUS_ERP[statusErp];

        if (mapeado === undefined) {
            lacunas.push(LACUNA.STATUS_ETAPA_DESCONHECIDO);
            return { status: ETAPA_STATUS.INDETERMINADO, lacunas };
        }

        if (mapeado === ETAPA_STATUS.PENDENTE) {
            if (!row.usnDesNomeCmd) lacunas.push(LACUNA.ETAPA_SEM_RESPONSAVEL);
            return { status: ETAPA_STATUS.PENDENTE, lacunas };
        }

        // A partir daqui o ERP diz "respondido". O que foi respondido, decide a ação.
        const acao = normalizarAcao(row.fbaDesNome);

        if (acao === undefined) {
            // "Respondido" sem ação registrada: o ERP afirma que a etapa saiu da fila, mas não diz
            // como. Não dá para contar como aprovação.
            lacunas.push(LACUNA.ACAO_ETAPA_DESCONHECIDA);
            return { status: ETAPA_STATUS.INDETERMINADO, lacunas };
        }

        if ((ACAO_REJEICAO as readonly string[]).includes(acao)) {
            this.registrarInconsistenciaDeTempo(row, lacunas);
            return { status: ETAPA_STATUS.REJEITADA, lacunas };
        }

        if (!(ACAO_CONCLUSIVA as readonly string[]).includes(acao)) {
            lacunas.push(LACUNA.ACAO_ETAPA_DESCONHECIDA);
            return { status: ETAPA_STATUS.INDETERMINADO, lacunas };
        }

        if (!row.usnDesNomeCmd) lacunas.push(LACUNA.ETAPA_SEM_RESPONSAVEL);
        this.registrarInconsistenciaDeTempo(row, lacunas);
        return { status: ETAPA_STATUS.CONCLUIDA, lacunas };
    };

    /**
     * Ação carimbada ANTES do bloqueio existir é dado inconsistente do ERP. O status da etapa não
     * muda (o ERP afirma o desfecho); o que se recusa é afirmar a duração.
     */
    private registrarInconsistenciaDeTempo = (row: FinTituloBloqRow, lacunas: Lacuna[]): void => {
        const bloq = row.ftbTimBloq;
        const cmd = row.ftbTimCmd;
        if (typeof bloq === 'number' && typeof cmd === 'number' && cmd < bloq) {
            lacunas.push(LACUNA.TIMESTAMPS_INCONSISTENTES);
        }
    };
}
