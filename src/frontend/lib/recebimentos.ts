import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

/**
 * Recebimentos (Frente IV) — cliente da API do painel READ-ONLY (Fase 1).
 *
 * Bate em `GET /recebimentos/painel`; os tipos espelham
 * `backend/domain/interface/recebimentos/{TransacaoBancaria,Recebimento,NotaDebitoEletronica,constants}.ts`.
 * Como o backend hoje devolve um stub vazio, `fetchPainelRecebimentos()` cai num
 * FIXTURE (rede de segurança do demo — espelha `fetchGestaoPermutas` em `lib/api.ts`),
 * então o painel nunca quebra na review mesmo sem reads reais / Postgres semeado.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// ─────────────────────────────────────────────────────────── Status/enum tipos (frozen)
// Mesmos valores literais das constantes do backend (`constants.ts`); FE não importa do
// backend (boundary), então os union types são replicados aqui, um-a-um.

export type RecebimentoStatus = 'rascunho' | 'aprovado' | 'executado' | 'estornado'

export type TransacaoBancariaStatus = 'importada' | 'conciliada' | 'parcial' | 'manual' | 'erro'

export type TransacaoTipo = 'CREDITO' | 'DEBITO' | 'ESTORNO' | 'TARIFA' | 'JUROS'

export type MatchClassificacao = 'unica' | 'multiplas' | 'parcial' | 'nenhuma'

export type NdeStatusEmissao = 'pendente' | 'emitida' | 'erro'

// ─────────────────────────────────────────────────────────── Entidades (espelho dos DTOs)
// `Date` do backend chega como ISO string no JSON — por isso os campos temporais são `string`.

/** Movimento bancário importado — espelho de `TransacaoBancaria` (Módulo 1). */
export interface TransacaoBancaria {
  id: string
  correlationId: string
  filCod: number
  dataMovimento: string
  tipo: TransacaoTipo
  valor: number
  moeda: string
  contraparte?: string
  referenciaBancaria?: string
  naturalKey: string
  status: TransacaoBancariaStatus
  /** Classificação do match (quando já houve `atribuirBaixa`). Fase 2 popula de verdade. */
  classificacaoMatch?: MatchClassificacao
  importRunId?: string
  importadoEm: string
}

/** Agregado de conciliação (a spine) — espelho de `Recebimento`. */
export interface Recebimento {
  id: string
  correlationId: string
  transacaoBancariaId: string
  filCod: number
  classificacaoMatch: MatchClassificacao
  status: RecebimentoStatus
  valorRecebido: number
  valorAlocado: number
  diferencaNaoAlocada: number
  ndeId?: string
  versao: number
  criadoPor: string
  aprovadoPor?: string
  executadoPor?: string
  estornadoPor?: string
  criadoEm: string
}

/** Nota de Débito Eletrônica — espelho de `NotaDebitoEletronica` (artefato terminal). */
export interface NotaDebitoEletronica {
  id: string
  recebimentoId: string
  filCod: number
  correlationId: string
  numeroNde?: string
  valor: number
  moeda: string
  statusEmissao: NdeStatusEmissao
  idempotencyKey: string
  emitidaEm?: string
  emitidaPor?: string
}

/** KPIs agregados do painel (Fase 1 — derivados client-side do fixture se ausentes). */
export interface RecebimentosKpis {
  importadas: number
  conciliadas: number
  parciais: number
  filaManual: number
  erro: number
  valorNaoAlocado: number
  ndePendentes: number
}

export interface RecebimentosPainel {
  /** Origem dos dados — `banco` (backend) ou `fixture` (rede de segurança do demo). */
  fonte: 'banco' | 'fixture'
  geradoEm: string
  kpis: RecebimentosKpis
  transacoes: TransacaoBancaria[]
  recebimentos: Recebimento[]
  ndes: NotaDebitoEletronica[]
}

// ─────────────────────────────────────────────────────────── Fixture (rede de segurança)
// Semeado a partir das shapes de `backend/.../__fixtures__` (mesmos IDs/valores) + variações
// que exercitam TODO status/classificação, para a review ver cada chip.

/** Deriva os KPIs a partir das listas — fonte única, evita drift entre cards e tabelas. */
export function computeKpis(
  transacoes: TransacaoBancaria[],
  recebimentos: Recebimento[],
  ndes: NotaDebitoEletronica[],
): RecebimentosKpis {
  return {
    importadas: transacoes.filter((t) => t.status === 'importada').length,
    conciliadas: transacoes.filter((t) => t.status === 'conciliada').length,
    parciais: transacoes.filter((t) => t.status === 'parcial').length,
    filaManual: transacoes.filter((t) => t.status === 'manual').length,
    erro: transacoes.filter((t) => t.status === 'erro').length,
    valorNaoAlocado: recebimentos.reduce((acc, r) => acc + (r.diferencaNaoAlocada || 0), 0),
    ndePendentes: ndes.filter((n) => n.statusEmissao === 'pendente').length,
  }
}

const fixtureTransacoes: TransacaoBancaria[] = [
  {
    id: 'txn-0001',
    correlationId: 'corr-0001',
    filCod: 4,
    dataMovimento: '2026-07-20T15:00:00.000Z',
    tipo: 'CREDITO',
    valor: 15000,
    moeda: 'BRL',
    contraparte: 'CLIENTE EXEMPLO LTDA',
    referenciaBancaria: 'PIX-ABC123',
    naturalKey: '4:12345:2026-07-20:15000:PIX-ABC123',
    status: 'importada',
    importRunId: 'run-0001',
    importadoEm: '2026-07-20T15:05:00.000Z',
  },
  {
    id: 'txn-0002',
    correlationId: 'corr-0002',
    filCod: 4,
    dataMovimento: '2026-07-19T13:30:00.000Z',
    tipo: 'CREDITO',
    valor: 32500.5,
    moeda: 'BRL',
    contraparte: 'IMPORTADORA ATLAS S.A.',
    referenciaBancaria: 'TED-778812',
    naturalKey: '4:98120:2026-07-19:32500:TED-778812',
    status: 'conciliada',
    classificacaoMatch: 'unica',
    importRunId: 'run-0001',
    importadoEm: '2026-07-19T13:40:00.000Z',
  },
  {
    id: 'txn-0003',
    correlationId: 'corr-0003',
    filCod: 7,
    dataMovimento: '2026-07-18T18:10:00.000Z',
    tipo: 'CREDITO',
    valor: 9000,
    moeda: 'BRL',
    contraparte: 'COMERCIAL VERTEX LTDA',
    referenciaBancaria: 'PIX-CD9931',
    naturalKey: '7:44201:2026-07-18:9000:PIX-CD9931',
    status: 'parcial',
    classificacaoMatch: 'parcial',
    importRunId: 'run-0002',
    importadoEm: '2026-07-18T18:22:00.000Z',
  },
  {
    id: 'txn-0004',
    correlationId: 'corr-0004',
    filCod: 7,
    dataMovimento: '2026-07-17T11:05:00.000Z',
    tipo: 'CREDITO',
    valor: 5400,
    moeda: 'BRL',
    contraparte: 'DESCONHECIDO / SEM REF.',
    referenciaBancaria: 'TED-000451',
    naturalKey: '7:11002:2026-07-17:5400:TED-000451',
    status: 'manual',
    classificacaoMatch: 'nenhuma',
    importRunId: 'run-0002',
    importadoEm: '2026-07-17T11:15:00.000Z',
  },
  {
    id: 'txn-0005',
    correlationId: 'corr-0005',
    filCod: 4,
    dataMovimento: '2026-07-16T09:45:00.000Z',
    tipo: 'CREDITO',
    valor: 21750,
    moeda: 'BRL',
    contraparte: 'GRUPO MERIDIAN',
    referenciaBancaria: 'PIX-EF5567',
    naturalKey: '4:77310:2026-07-16:21750:PIX-EF5567',
    status: 'erro',
    importRunId: 'run-0002',
    importadoEm: '2026-07-16T09:52:00.000Z',
  },
]

const fixtureRecebimentos: Recebimento[] = [
  {
    id: 'rec-0001',
    correlationId: 'corr-0001',
    transacaoBancariaId: 'txn-0001',
    filCod: 4,
    classificacaoMatch: 'unica',
    status: 'rascunho',
    valorRecebido: 15000,
    valorAlocado: 15000,
    diferencaNaoAlocada: 0,
    versao: 0,
    criadoPor: 'analista',
    criadoEm: '2026-07-20T15:10:00.000Z',
  },
  {
    id: 'rec-0002',
    correlationId: 'corr-0002',
    transacaoBancariaId: 'txn-0002',
    filCod: 4,
    classificacaoMatch: 'unica',
    status: 'executado',
    valorRecebido: 32500.5,
    valorAlocado: 32500.5,
    diferencaNaoAlocada: 0,
    ndeId: 'nde-0002',
    versao: 2,
    criadoPor: 'analista',
    aprovadoPor: 'analista',
    executadoPor: 'analista',
    criadoEm: '2026-07-19T13:45:00.000Z',
  },
  {
    id: 'rec-0003',
    correlationId: 'corr-0003',
    transacaoBancariaId: 'txn-0003',
    filCod: 7,
    classificacaoMatch: 'parcial',
    status: 'aprovado',
    valorRecebido: 9000,
    valorAlocado: 6000,
    diferencaNaoAlocada: 3000,
    versao: 1,
    criadoPor: 'analista',
    aprovadoPor: 'analista',
    criadoEm: '2026-07-18T18:30:00.000Z',
  },
]

const fixtureNdes: NotaDebitoEletronica[] = [
  {
    id: 'nde-0002',
    recebimentoId: 'rec-0002',
    filCod: 4,
    correlationId: 'corr-0002',
    numeroNde: 'NDE-000123',
    valor: 32500.5,
    moeda: 'BRL',
    statusEmissao: 'emitida',
    idempotencyKey: 'receb:rec-0002:corr-0002',
    emitidaEm: '2026-07-19T14:02:00.000Z',
    emitidaPor: 'analista',
  },
  {
    id: 'nde-0003',
    recebimentoId: 'rec-0003',
    filCod: 7,
    correlationId: 'corr-0003',
    valor: 9000,
    moeda: 'BRL',
    statusEmissao: 'pendente',
    idempotencyKey: 'receb:rec-0003:corr-0003',
  },
]

/** Painel completo de demonstração — a rede de segurança do fixture. */
export const recebimentosPainelFixture: RecebimentosPainel = {
  fonte: 'fixture',
  geradoEm: '2026-07-20T15:30:00.000Z',
  kpis: computeKpis(fixtureTransacoes, fixtureRecebimentos, fixtureNdes),
  transacoes: fixtureTransacoes,
  recebimentos: fixtureRecebimentos,
  ndes: fixtureNdes,
}

// ─────────────────────────────────────────────────────────── Fetch (backend → fixture)

/** Shape parcial que o backend pode devolver hoje (stub) ou no futuro (reads reais). */
interface PainelResponseRaw {
  geradoEm?: string
  transacoes?: TransacaoBancaria[]
  recebimentos?: Recebimento[]
  ndes?: NotaDebitoEletronica[]
  kpis?: Partial<RecebimentosKpis>
}

/**
 * Busca o painel de Recebimentos — tenta o backend (`GET /recebimentos/painel`) e
 * cai no fixture quando o backend não responde, erra ou devolve o stub vazio. Esse
 * fallback é a REDE DE SEGURANÇA do demo: a tela nunca quebra na review, mesmo com o
 * backend devolvendo `{ recebimentos: [], kpis: {} }`. Quando os reads reais existirem
 * (Fases 2+), o backend assume e o fixture só entra como contingência.
 */
export async function fetchPainelRecebimentos(): Promise<RecebimentosPainel> {
  try {
    const res = await apiFetch(`${API}/recebimentos/painel`, {
      headers: await withAuthHeaders(),
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = (await res.json()) as PainelResponseRaw
    const transacoes = json.transacoes ?? []
    const recebimentos = json.recebimentos ?? []
    const ndes = json.ndes ?? []
    // Stub vazio (sem transações) → usa o fixture para a tela renderizar na review.
    if (transacoes.length === 0) return recebimentosPainelFixture
    return {
      fonte: 'banco',
      geradoEm: json.geradoEm ?? new Date().toISOString(),
      kpis: { ...computeKpis(transacoes, recebimentos, ndes), ...(json.kpis ?? {}) },
      transacoes,
      recebimentos,
      ndes,
    }
  } catch {
    return recebimentosPainelFixture
  }
}
