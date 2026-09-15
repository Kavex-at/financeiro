import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
    MOTIVO_BLOQUEIO,
    type MotivoBloqueio,
} from '../interface/permutas/EstadoElegibilidade.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Rótulo pt-BR de cada motivo, para citar a situação atual do adto na mensagem de recusa.
 * `Record<MotivoBloqueio, …>`: um motivo novo quebra o build aqui, onde o rótulo é decidido.
 * Espelha `MOTIVO_LABEL` do frontend (`app/permutas/components/format.ts`).
 */
const ROTULO_MOTIVO: Readonly<Record<MotivoBloqueio, string>> = {
    [MOTIVO_BLOQUEIO.COMPOSTO_NM]: 'Múltiplas invoices (N:M)',
    [MOTIVO_BLOQUEIO.SEM_INVOICE]: 'Sem invoice',
    [MOTIVO_BLOQUEIO.MULTIPLAS_INVOICES]: 'Múltiplas invoices',
    [MOTIVO_BLOQUEIO.NAO_PAGO]: 'Não totalmente pago',
    [MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR]: 'Sem saldo a permutar',
    [MOTIVO_BLOQUEIO.JA_PERMUTADO]: 'Já permutado',
    [MOTIVO_BLOQUEIO.DI_DUIMP_AMBOS]: 'D.I e DUIMP (anomalia)',
    [MOTIVO_BLOQUEIO.FALHA_GATE]: 'Falha em gate',
    [MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL]: 'Sem D.I / DUIMP',
    [MOTIVO_BLOQUEIO.CLIENTE_FILTRO]: 'Cliente filtro (permuta manual)',
    [MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL]: 'Detalhe indisponível',
    [MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL]: 'Permutado fora do painel (exceção manual)',
};

/** Rótulo pt-BR do estado, usado quando a linha não carrega motivo (ex.: `elegivel`). */
const ROTULO_ESTADO: Readonly<Record<EstadoElegibilidade, string>> = {
    [ESTADO_ELEGIBILIDADE.DESCOBERTA]: 'Descoberta',
    [ESTADO_ELEGIBILIDADE.ELEGIVEL]: 'Elegível',
    [ESTADO_ELEGIBILIDADE.BLOQUEADA]: 'Bloqueada',
    [ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL]: 'Casamento manual (N:M)',
    [ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL]: 'Permuta manual',
    [ESTADO_ELEGIBILIDADE.JA_PERMUTADO]: 'Já permutado',
};

export type ExcecaoPermutaRecusa =
    /** A guarda I-Exc-1 reprovou o estado gravado do adto (422). */
    | { tipo: 'guarda'; docCod: string; estado: string; motivo?: string }
    /** A linha mudou de estado entre a leitura e a gravação (422, a transação é desfeita). */
    | { tipo: 'concorrencia'; docCod: string }
    /** Adto inexistente ou fora do backlog (`stale`) — 404. */
    | { tipo: 'adiantamento-nao-encontrado'; docCod: string }
    /** Desfazer sem exceção ativa — 404. */
    | { tipo: 'excecao-nao-encontrada'; docCod: string }
    /** Já existe exceção ativa para o adto (I-Exc-3) — 409. */
    | { tipo: 'ja-ativa'; docCod: string };

const STATUS_POR_TIPO: Readonly<Record<ExcecaoPermutaRecusa['tipo'], number>> = {
    guarda: 422,
    concorrencia: 422,
    'adiantamento-nao-encontrado': 404,
    'excecao-nao-encontrada': 404,
    'ja-ativa': 409,
};

const CODE_POR_TIPO: Readonly<Record<ExcecaoPermutaRecusa['tipo'], string>> = {
    guarda: 'EXCECAO_GUARDA_RECUSADA',
    concorrencia: 'EXCECAO_GUARDA_RECUSADA',
    'adiantamento-nao-encontrado': 'ADIANTAMENTO_NAO_ENCONTRADO',
    'excecao-nao-encontrada': 'EXCECAO_NAO_ENCONTRADA',
    'ja-ativa': 'EXCECAO_JA_ATIVA',
};

const REGRA =
    'Só é possível marcar como permutado fora do painel um adiantamento bloqueado por "Sem saldo a permutar".';

/**
 * Recusa de regra de negócio ao marcar/desfazer uma exceção manual "permutado fora do
 * painel" (ADR-0047). Não é falha de sistema: a rota devolve o `statusCode` com
 * `{ error: code, message: userMessage }` e a UI mostra a mensagem sem gravar nada.
 */
export default class ExcecaoPermutaRecusadaError extends Error implements HandlerError {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode: number;
    public readonly details: { tipo: ExcecaoPermutaRecusa['tipo']; docCod: string };

    constructor(recusa: ExcecaoPermutaRecusa) {
        super(`manual permuta exception refused: ${recusa.tipo} (docCod=${recusa.docCod})`);
        this.name = 'ExcecaoPermutaRecusadaError';
        this.code = CODE_POR_TIPO[recusa.tipo];
        this.statusCode = STATUS_POR_TIPO[recusa.tipo];
        this.details = { tipo: recusa.tipo, docCod: recusa.docCod };
        this.userMessage = ExcecaoPermutaRecusadaError.mensagem(recusa);
    }

    private static mensagem = (recusa: ExcecaoPermutaRecusa): string => {
        switch (recusa.tipo) {
            case 'guarda':
                return `${REGRA} O adiantamento ${recusa.docCod} está em: ${ExcecaoPermutaRecusadaError.rotulo(recusa.estado, recusa.motivo)}.`;
            case 'concorrencia':
                return `O adiantamento ${recusa.docCod} mudou de situação durante a marcação. Atualize a tela e tente de novo.`;
            case 'adiantamento-nao-encontrado':
                return `Adiantamento ${recusa.docCod} não encontrado no backlog de permutas.`;
            case 'excecao-nao-encontrada':
                return `O adiantamento ${recusa.docCod} não tem exceção manual ativa.`;
            case 'ja-ativa':
                return `O adiantamento ${recusa.docCod} já tem uma exceção manual ativa. Desfaça a atual para registrar outra.`;
        }
    };

    private static rotulo = (estado: string, motivo?: string): string => {
        const rotulosMotivo: Readonly<Record<string, string>> = ROTULO_MOTIVO;
        const rotulosEstado: Readonly<Record<string, string>> = ROTULO_ESTADO;
        if (motivo !== undefined) return rotulosMotivo[motivo] ?? motivo;
        return rotulosEstado[estado] ?? estado;
    };
}
