import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'
import type {
  BorderoResumo,
  ClienteFiltro,
  ExecucaoPermuta,
  FiliaisResponse,
  GestaoPermutasResponse,
  Importador,
  IngestaoResult,
  InvoiceBuscada,
  PermutaRun,
  PermutaStatusResponse,
  ReconciliarLoteResult,
  RelatorioTipo,
  ReconciliarResult,
} from './types'
import { gestaoPermutasFixture } from './permutas-fixture'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * Lançado por `runIngestaoManual()` quando o backend responde 409 — já existe
 * uma ingestão em andamento (cron ou outro analista). A UI mostra um aviso e
 * NÃO trata como erro genérico (ADR-0006).
 */
export class IngestaoEmAndamentoError extends Error {
  constructor(message = 'Já existe uma ingestão em andamento. Aguarde terminar e tente novamente.') {
    super(message)
    this.name = 'IngestaoEmAndamentoError'
  }
}

/**
 * HTTP client for the backend. Every request attaches the Supabase bearer
 * token via `withAuthHeaders()`. The skeleton ships one example call
 * (`fetchFiliais`); financeiro features add their own here.
 */
export async function fetchFiliais(): Promise<FiliaisResponse> {
  const res = await apiFetch(`${API}/conexos/filiais`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  const json = await res.json()
  return {
    filiais: json?.filiais ?? [],
    filCodDefault: json?.filCodDefault ?? null,
  }
}

/**
 * Gestão de Permutas — tenta o backend (`GET /permutas/gestao`) e cai no
 * fixture de dados reais quando o backend não responde, erra ou devolve vazio.
 * Esse fallback é a REDE DE SEGURANÇA do demo: a tela nunca quebra na review,
 * mesmo sem Postgres semeado / backend de pé. Quando o banco local estiver
 * populado (Fase B), o backend assume e o fixture só entra como contingência.
 */
export async function fetchGestaoPermutas(): Promise<GestaoPermutasResponse> {
  try {
    const res = await apiFetch(`${API}/permutas/gestao`, {
      headers: await withAuthHeaders(),
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const json = (await res.json()) as Partial<GestaoPermutasResponse>
    if (!json?.pendentes?.length && !json?.invoicesEmAberto?.length) {
      return gestaoPermutasFixture
    }
    return {
      fonte: 'banco',
      geradoEm: json.geradoEm,
      pendentes: json.pendentes ?? [],
      invoicesEmAberto: json.invoicesEmAberto ?? [],
      casamentos: json.casamentos ?? [],
      totais: json.totais ?? {
        pendentes: json.pendentes?.length ?? 0,
        invoicesEmAberto: json.invoicesEmAberto?.length ?? 0,
        elegiveis: (json.pendentes ?? []).filter((p) => p.status === 'elegivel').length,
        bloqueadas: (json.pendentes ?? []).filter((p) => p.status === 'bloqueada').length,
        casamentoManual: (json.pendentes ?? []).filter((p) => p.status === 'casamento-manual')
          .length,
        permutaManual: (json.pendentes ?? []).filter((p) => p.status === 'permuta-manual').length,
        jaPermutado: (json.pendentes ?? []).filter((p) => p.status === 'ja-permutado').length,
      },
    }
  } catch {
    return gestaoPermutasFixture
  }
}

/**
 * Lista as últimas rodadas de ingestão (cron + manuais) para a trilha de
 * auditoria do modal (ADR-0006). Bate em `GET /permutas/runs`. Lança em erro de
 * rede / HTTP para o caller exibir o estado de falha do histórico.
 */
export async function fetchPermutaRuns(limit?: number): Promise<PermutaRun[]> {
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : ''
  const res = await apiFetch(`${API}/permutas/runs${qs}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}`)
  }
  const json = (await res.json()) as { runs?: PermutaRun[] }
  return json.runs ?? []
}

/**
 * Dispara a ingestão MANUAL e ESPERA terminar (`POST /permutas/ingestao`). O
 * `triggered_by` é derivado server-side do token autenticado. Em 409 lança
 * `IngestaoEmAndamentoError` (já há uma rodada em andamento); demais erros de
 * rede/HTTP viram `Error` genérico para o caller exibir um toast.
 */
export async function runIngestaoManual(): Promise<IngestaoResult> {
  const res = await apiFetch(`${API}/permutas/ingestao`, {
    method: 'POST',
    headers: await withAuthHeaders(),
  })
  if (res.status === 409) {
    let message: string | undefined
    try {
      const j = await res.json()
      message = j?.message
    } catch {}
    throw new IngestaoEmAndamentoError(message)
  }
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  return (await res.json()) as IngestaoResult
}

/**
 * Cliente-filtro (Fase 1): importadores cujos adtos vão para permuta manual
 * cross-process. CRUD em `/permutas/cliente-filtro`. Token de auth em toda chamada.
 */
export async function fetchClientesFiltro(): Promise<ClienteFiltro[]> {
  const res = await apiFetch(`${API}/permutas/cliente-filtro`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { clientes?: ClienteFiltro[] }
  return json.clientes ?? []
}

export async function addClienteFiltro(pesCod: string, importador?: string): Promise<void> {
  const res = await apiFetch(`${API}/permutas/cliente-filtro`, {
    method: 'POST',
    headers: await withAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ pesCod, ...(importador ? { importador } : {}) }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
}

export async function removeClienteFiltro(pesCod: string): Promise<void> {
  const res = await apiFetch(`${API}/permutas/cliente-filtro/${encodeURIComponent(pesCod)}`, {
    method: 'DELETE',
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
}

/**
 * Lançado por `criarAlocacao()` no HTTP 422 — a alocação excederia o saldo de um
 * dos lados (adto ou invoice). A UI mostra a mensagem e NÃO grava (Fase 2).
 */
export class AlocacaoExcedeSaldoError extends Error {
  constructor(message = 'Valor excede o saldo disponível.') {
    super(message)
    this.name = 'AlocacaoExcedeSaldoError'
  }
}

/**
 * Busca LIVE as invoices de um processo NA FILIAL dada, para a alocação manual.
 * `filCod` é obrigatório — o `priCod` não é único entre filiais.
 */
export async function buscarInvoicesPorProcesso(
  priCod: string,
  filCod: number,
  adtoDocCod?: string,
): Promise<InvoiceBuscada[]> {
  const adtoParam = adtoDocCod ? `&adtoDocCod=${encodeURIComponent(adtoDocCod)}` : ''
  const res = await apiFetch(
    `${API}/permutas/invoices/buscar?priCod=${encodeURIComponent(priCod)}&filCod=${encodeURIComponent(filCod)}${adtoParam}`,
    { headers: await withAuthHeaders() },
  )
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { invoices?: InvoiceBuscada[] }
  return json.invoices ?? []
}

/** Cria/atualiza uma alocação manual (rascunho). 422 → `AlocacaoExcedeSaldoError`. */
export async function criarAlocacao(
  adiantamentoDocCod: string,
  payload: { invoiceDocCod: string; invoicePriCod: string; valorAlocado: number; observacao?: string },
): Promise<void> {
  const res = await apiFetch(
    `${API}/permutas/adiantamentos/${encodeURIComponent(adiantamentoDocCod)}/alocacoes`,
    {
      method: 'POST',
      headers: await withAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
    },
  )
  if (res.status === 422) {
    let message: string | undefined
    try {
      const j = await res.json()
      message = j?.message
    } catch {}
    throw new AlocacaoExcedeSaldoError(message)
  }
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
}

/**
 * Reconcilia (baixa no ERP `fin010`) as alocações de um adiantamento — Fase 3 (ADR-0013).
 * `dryRun=true` força o preview (monta/loga o payload, sem POST). O backend é dry-run por
 * padrão (gated por CONEXOS_WRITE_ENABLED/DRY_RUN); a escrita real exige as flags ligadas.
 */
export async function reconciliarAdiantamento(
  docCod: string,
  opts?: { dryRun?: boolean; dataMovto?: number },
): Promise<ReconciliarResult> {
  const res = await apiFetch(
    `${API}/permutas/adiantamentos/${encodeURIComponent(docCod)}/reconciliar`,
    {
      method: 'POST',
      headers: await withAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        ...(opts?.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
        ...(opts?.dataMovto !== undefined ? { dataMovto: opts.dataMovto } : {}),
      }),
    },
  )
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  return (await res.json()) as ReconciliarResult
}

/** Resultado da geração de UMA Solicitação de Numerário (B1 — fluxo de 3 telas). */
export interface GerarNumerarioResult {
  adiantamentoDocCod: string
  dryRun: boolean
  writeEnabled: boolean
  status: 'dry-run' | 'settled' | 'skipped' | 'error'
  valor: number
  /** docCod da SN (Tela 1, com299). */
  docCod?: number
  /** docCod da nota de débito (Tela 3, com297). */
  notaDebitoDocCod?: number
  /** Etapa alcançada: sn | sn-finalizar | fin014 | nota-debito | concluido. */
  etapa?: string
  erro?: string
}

/**
 * Gera a SOLICITAÇÃO DE NUMERÁRIO de um adiantamento (`POST /permutas/adiantamentos/:docCod/gerar-numerario`).
 * Substitui a baixa fin010 no "Processar". `valor` = `valorASerUsado` do modal (moeda negociada,
 * sem conversão). Escrita gated no servidor (dry-run por padrão).
 */
export async function gerarNumerario(
  docCod: string,
  opts: { valor: number; dryRun?: boolean },
): Promise<GerarNumerarioResult> {
  const res = await apiFetch(
    `${API}/permutas/adiantamentos/${encodeURIComponent(docCod)}/gerar-numerario`,
    {
      method: 'POST',
      headers: await withAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        valor: opts.valor,
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      }),
    },
  )
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  return (await res.json()) as GerarNumerarioResult
}

/**
 * Executa em LOTE a baixa de TODAS as automáticas (aba "Automáticas") num único request —
 * `POST /permutas/reconciliar-lote`. O backend itera server-side (continue-on-error) e devolve o
 * agregado. Mesmo gating de escrita do reconciliar individual (dry-run por padrão).
 */
export async function reconciliarLoteAutomaticas(
  opts?: { dryRun?: boolean; dataMovto?: number; adiantamentoDocCods?: string[] },
): Promise<ReconciliarLoteResult> {
  const res = await apiFetch(`${API}/permutas/reconciliar-lote`, {
    method: 'POST',
    headers: await withAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      ...(opts?.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      ...(opts?.dataMovto !== undefined ? { dataMovto: opts.dataMovto } : {}),
      ...(opts?.adiantamentoDocCods !== undefined
        ? { adiantamentoDocCods: opts.adiantamentoDocCods }
        : {}),
    }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  return (await res.json()) as ReconciliarLoteResult
}

/** Memo curto do último resultado de borderôs — torna a reabertura da aba instantânea (a aba
 * desmonta/remonta a cada troca). `live`/expira em 30s ignora o memo e rebusca. */
let borderosMemo: { at: number; data: BorderoResumo[] } | null = null
const BORDEROS_MEMO_TTL = 30_000

/** Lista os borderôs (Fase 3.1) — cache local (rápido); `live=true` faz refresh ao vivo no ERP. */
export async function fetchBorderos(live = false): Promise<BorderoResumo[]> {
  if (!live && borderosMemo && Date.now() - borderosMemo.at < BORDEROS_MEMO_TTL) {
    return borderosMemo.data
  }
  const qs = live ? '?live=true' : ''
  const res = await apiFetch(`${API}/permutas/borderos${qs}`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { borderos?: BorderoResumo[] }
  const data = json.borderos ?? []
  borderosMemo = { at: Date.now(), data }
  return data
}

/** Invalida o memo de borderôs (após ações de escrita: aprovar/cancelar/excluir). */
export function invalidarBorderosMemo(): void {
  borderosMemo = null
}

/** Baixas DO ERP de um borderô (p/ ver detalhe de borderôs lançados direto no Conexos). */
export async function fetchBaixasErp(
  borCod: number,
  filCod: number,
): Promise<Array<{ invoiceDocCod: string; bxaCodSeq: number; valorLiquido?: number }>> {
  const res = await apiFetch(
    `${API}/permutas/borderos/${encodeURIComponent(borCod)}/baixas?filCod=${encodeURIComponent(filCod)}`,
    { headers: await withAuthHeaders() },
  )
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as {
    baixas?: Array<{ invoiceDocCod: string; bxaCodSeq: number; valorLiquido?: number }>
  }
  return json.baixas ?? []
}

/** Status PERMUTA→BORDERÔ por adiantamento (consulta lazy, status vivo do fin010). Fase 3.1. */
export async function fetchPermutaStatus(): Promise<PermutaStatusResponse> {
  const res = await apiFetch(`${API}/permutas/status`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()) as PermutaStatusResponse
}

/** Exclui UMA baixa de um borderô em aberto (no ERP + trilha). Fase 3.1. */
export async function excluirBaixaBordero(borCod: number, invoiceDocCod: string): Promise<void> {
  const res = await apiFetch(
    `${API}/permutas/borderos/${encodeURIComponent(borCod)}/baixas/${encodeURIComponent(invoiceDocCod)}`,
    { method: 'DELETE', headers: await withAuthHeaders() },
  )
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
}

/** Exclui o borderô INTEIRO (em cadastro) + todas as baixas (ERP + trilha). Fase 3.1. */
export async function excluirBorderoInteiro(borCod: number, filCod?: number): Promise<void> {
  const qs = filCod !== undefined ? `?filCod=${encodeURIComponent(filCod)}` : ''
  const res = await apiFetch(`${API}/permutas/borderos/${encodeURIComponent(borCod)}${qs}`, {
    method: 'DELETE',
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
}

/** Ação de borderô (finalizar/aprovar, cancelar ou estornar) via POST. Fase 3.1. */
async function acaoBordero(
  borCod: number,
  acao: 'finalizar' | 'cancelar' | 'estornar',
  filCod?: number,
): Promise<void> {
  const res = await apiFetch(`${API}/permutas/borderos/${encodeURIComponent(borCod)}/${acao}`, {
    method: 'POST',
    headers: await withAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(filCod !== undefined ? { filCod } : {}),
  })
  if (!res.ok) {
    // Prefere a mensagem do ERP (o backend já surface a razão real do `vars.msg`); sem ela, cai no status.
    let erro = `API ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) erro = String(j.error)
    } catch {}
    throw new Error(erro)
  }
}

/** Finaliza/aprova o borderô no ERP. */
export const finalizarBordero = (borCod: number, filCod?: number) =>
  acaoBordero(borCod, 'finalizar', filCod)
/** Cancela o borderô (em cadastro) no ERP. */
export const cancelarBordero = (borCod: number, filCod?: number) =>
  acaoBordero(borCod, 'cancelar', filCod)
/** Estorna o borderô finalizado (volta para em cadastro) no ERP. */
export const estornarBordero = (borCod: number, filCod?: number) =>
  acaoBordero(borCod, 'estornar', filCod)

/** Trilha de execução da baixa de um adiantamento (status por par adto↔invoice). */
export async function fetchExecucoes(docCod: string): Promise<ExecucaoPermuta[]> {
  const res = await apiFetch(
    `${API}/permutas/adiantamentos/${encodeURIComponent(docCod)}/execucoes`,
    { headers: await withAuthHeaders() },
  )
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { execucoes?: ExecucaoPermuta[] }
  return json.execucoes ?? []
}

/** Remove uma alocação manual (par adto↔invoice). */
export async function removerAlocacao(
  adiantamentoDocCod: string,
  invoiceDocCod: string,
): Promise<void> {
  const res = await apiFetch(
    `${API}/permutas/adiantamentos/${encodeURIComponent(adiantamentoDocCod)}/alocacoes/${encodeURIComponent(invoiceDocCod)}`,
    { method: 'DELETE', headers: await withAuthHeaders() },
  )
  if (!res.ok) {
    // 409 = alocação já usada num borderô (trava de integridade): mostra a mensagem do backend.
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `API ${res.status}`)
  }
}

/** Importadores distintos do backlog — alimenta o seletor do cadastro de filtro. */
export async function fetchImportadores(): Promise<Importador[]> {
  const res = await apiFetch(`${API}/permutas/importadores`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const json = (await res.json()) as { importadores?: Importador[] }
  return json.importadores ?? []
}

/** Extrai o `filename="..."` de um header Content-Disposition (ou undefined). */
function parseContentDispositionFilename(header: string | null): string | undefined {
  if (!header) return undefined
  const match = /filename="?([^"]+)"?/.exec(header)
  return match?.[1]
}

/**
 * Exporta um relatório do painel em Excel (.xlsx). Bate em
 * `GET /permutas/relatorios/:tipo` com o token de auth, lê o blob e dispara o
 * download no browser (o nome do arquivo vem do Content-Disposition). Lança em
 * erro de rede/HTTP para o caller exibir um toast. Snapshot completo no backend
 * (sem filtros da tela) — ver ADR de relatórios.
 */
export async function exportarRelatorio(tipo: RelatorioTipo): Promise<void> {
  const res = await apiFetch(`${API}/permutas/relatorios/${encodeURIComponent(tipo)}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
  const blob = await res.blob()
  const filename =
    parseContentDispositionFilename(res.headers.get('content-disposition')) ??
    `permutas-${tipo}.xlsx`
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Registra o processamento de um adiantamento (botão "Processar"). Bate em
 * `POST /permutas/adiantamentos/:docCod/processar` com o token de auth. O status
 * gravado (`processado`) sobrevive à re-ingestão diária. Lança em erro de rede /
 * HTTP para o caller exibir um toast e NÃO atualizar a tela como sucesso.
 */
export async function processarAdiantamento(
  docCod: string,
  invoiceDocCod?: string,
  observacao?: string,
): Promise<void> {
  const res = await apiFetch(
    `${API}/permutas/adiantamentos/${encodeURIComponent(docCod)}/processar`,
    {
      method: 'POST',
      headers: await withAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        ...(invoiceDocCod ? { invoiceDocCod } : {}),
        ...(observacao ? { observacao } : {}),
      }),
    },
  )
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detail}`)
  }
}
