import {
    GRUPO_BOLETO_ESTADO,
    type GrupoBoletoEstado,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import { LOTE_STATUS, type LotePagamentoStatus } from '../../interface/sispag/SispagInterface.js';
import { ETAPA_BORDERO_GRUPO, type EtapaBordero } from './EtapaBorderoGrupo.js';

/**
 * Situação DERIVADA de um grupo (não persistida, só exibição e decisão do cron) —
 * `ontology/entities/grupo-boleto.md`, ADR-0077. `ANULADO`/`PAGO` vêm do estado persistido.
 */
export const SITUACAO_GRUPO_BOLETO = {
    DISPONIVEL: 'DISPONIVEL',
    EM_LOTE: 'EM_LOTE',
    EM_REMESSA: 'EM_REMESSA',
    REJEITADO: 'REJEITADO',
    RETIDO: 'RETIDO',
    DIVERGENTE: 'DIVERGENTE',
    ORFAO: 'ORFAO',
    ANULADO: 'ANULADO',
    PAGO: 'PAGO',
} as const;
export type SituacaoGrupo = (typeof SITUACAO_GRUPO_BOLETO)[keyof typeof SITUACAO_GRUPO_BOLETO];

const S = SITUACAO_GRUPO_BOLETO;

/** Uma execução do borderô do grupo (linha do ledger), o bastante para a I21r. */
export interface ExecucaoParaSituacao {
    /** Instante de abertura do write-ahead (ISO ou epoch-ms). */
    iniciadaEm: string | number;
    etapa: EtapaBordero;
    /** Presente = o J desta execução foi rejeitado no retorno (I21r). */
    jRejeitadoEm?: string | number;
}

export interface EntradaSituacaoGrupo {
    estado: GrupoBoletoEstado;
    /** Recalculado na leitura pela I21u (`RegraGrupoBoleto.orfao`). */
    orfao: boolean;
    /** Algum título do grupo com `BloqueioDuplicidade ATIVO` (retirada na remessa, I21p(3)). */
    marcaRetencaoAtiva: boolean;
    /** Parte dos títulos paga (I21r): `divergencia` nos itens. */
    divergente: boolean;
    /** Status do lote em que estão os N itens do grupo, se houver. */
    loteStatus?: LotePagamentoStatus;
    execucoes: ExecucaoParaSituacao[];
}

const instante = (v: string | number): number => (typeof v === 'number' ? v : Date.parse(v));

/** Lote "vivo" com os N itens: rascunho/finalizado ⇒ EM_LOTE; remessa gerada ⇒ EM_REMESSA. */
const EM_LOTE: ReadonlySet<LotePagamentoStatus> = new Set<LotePagamentoStatus>([
    LOTE_STATUS.RASCUNHO,
    LOTE_STATUS.FINALIZADO,
]);

/**
 * Situação derivada do grupo, com precedência EXPLÍCITA (`PRECEDENCIA`, de cima para baixo):
 *
 *  1. `ANULADO` / `PAGO` — o estado persistido vence tudo.
 *  2. `DIVERGENTE` — parte paga: dinheiro em jogo, `Alerta` `sispag-baixa-divergente` (I21r).
 *  3. `EM_REMESSA` — o lote está com o banco; título pago depois do pagamento é o caminho
 *     esperado e não deve aparecer como órfão até a sincronização fechar o grupo.
 *  4. `ORFAO` — I21u; vence a retenção (órfão pede anulação, retenção pede resolver a marca).
 *  5. `RETIDO` — marca `GRUPO_BOLETO` (ou outra) ativa depois de uma retirada.
 *  6. `EM_LOTE` — num lote rascunho/finalizado; inclusive o rejeitado que a analista já pôs à mão
 *     num lote novo (ela já agiu sobre a rejeição, I21r).
 *  7. `REJEITADO` — a última execução com J rejeitado não tem execução POSTERIOR concluída.
 *  8. `DISPONIVEL`.
 *
 * Decisão do implementador (a ontologia lista as situações sem ordem); fixada nos testes.
 */
export default class SituacaoGrupoBoleto {
    public static readonly PRECEDENCIA: readonly SituacaoGrupo[] = [
        S.ANULADO,
        S.PAGO,
        S.DIVERGENTE,
        S.EM_REMESSA,
        S.ORFAO,
        S.RETIDO,
        S.EM_LOTE,
        S.REJEITADO,
        S.DISPONIVEL,
    ];

    public static derivar = (e: EntradaSituacaoGrupo): SituacaoGrupo => {
        const vale: Readonly<Record<SituacaoGrupo, boolean>> = {
            [S.ANULADO]: e.estado === GRUPO_BOLETO_ESTADO.ANULADO,
            [S.PAGO]: e.estado === GRUPO_BOLETO_ESTADO.PAGO,
            [S.DIVERGENTE]: e.divergente,
            [S.EM_REMESSA]: e.loteStatus === LOTE_STATUS.REMESSA_GERADA,
            [S.ORFAO]: e.orfao,
            [S.RETIDO]: e.marcaRetencaoAtiva,
            [S.EM_LOTE]: e.loteStatus !== undefined && EM_LOTE.has(e.loteStatus),
            [S.REJEITADO]: SituacaoGrupoBoleto.rejeitado(e.execucoes),
            [S.DISPONIVEL]: true,
        };
        return SituacaoGrupoBoleto.PRECEDENCIA.find((s) => vale[s]) ?? S.DISPONIVEL;
    };

    /** I21r: a última execução com J rejeitado e nenhuma execução posterior concluída. */
    public static rejeitado = (execucoes: readonly ExecucaoParaSituacao[]): boolean => {
        const rejeitadas = execucoes.filter((x) => x.jRejeitadoEm !== undefined);
        if (rejeitadas.length === 0) return false;
        const ultima = Math.max(...rejeitadas.map((x) => instante(x.iniciadaEm)));
        return !execucoes.some(
            (x) =>
                x.jRejeitadoEm === undefined &&
                x.etapa === ETAPA_BORDERO_GRUPO.CONCLUIDO &&
                instante(x.iniciadaEm) > ultima,
        );
    };

    /** I21j/I21r: o cron só lota grupo `DISPONIVEL` (nunca órfão, retido, rejeitado nem já lotado). */
    public static podeSerLotadoPeloCron = (situacao: SituacaoGrupo): boolean =>
        situacao === S.DISPONIVEL;
}
