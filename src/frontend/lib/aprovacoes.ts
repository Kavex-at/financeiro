import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

/**
 * Aprovações (Frente V) — cliente da API do painel READ-ONLY da trilha de
 * aprovação de títulos a pagar.
 *
 * Bate em `GET /aprovacoes` (lista) e `GET /aprovacoes/:id/trilha` (detalhe, Fatia F3).
 * Os tipos abaixo espelham **literalmente** o contrato travado em
 * `ontology/_inbox/frente-v-aprovacoes-tasks.md` — a fronteira com o backend. Todo
 * campo derivado (status agregado, duração, "parada há", lacunas) é calculado no
 * BACKEND; o frontend só formata.
 *
 * Duas propriedades do domínio que este arquivo NÃO deixa esquecer:
 *
 * 1. **O dado não é ao vivo.** Vem do nosso Postgres (snapshot do ERP). `snapshotEm`
 *    é a idade desse dado e é obrigatório na tela (invariante I7).
 * 2. **A lista é grande.** Só a filial 2 tem ~23.6k títulos em 12 meses. A paginação
 *    e os filtros são do SERVIDOR — nunca traga mais de uma página para o cliente.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// ─────────────────────────────────────────────────────────── Enums (espelho do contrato)

/**
 * Status agregado do workflow de um título.
 *
 * - `SEM_WORKFLOW` **não é erro**: ~metade dos títulos a pagar simplesmente não passa por
 *   bloqueio/liberação. É informação de diagnóstico, não uma falha de ingestão.
 * - `INDETERMINADO` é estado de PRIMEIRA CLASSE, não um fallback envergonhado: hoje existem
 *   13 etapas em produção com `ftbVldStatus = 7`, um valor sem legenda no spec do Conexos
 *   (pendência **PV-01**). Chutar "aprovado" produziria um tempo médio errado num painel
 *   auditável; aparecer como indeterminado é honesto e visível.
 */
export type StatusWorkflow =
  | 'SEM_WORKFLOW'
  | 'AGUARDANDO'
  | 'APROVADO'
  | 'REJEITADO'
  | 'INDETERMINADO'

/** Status de UMA etapa da trilha (usado pela timeline da fatia F3). */
export type EtapaStatus = 'PENDENTE' | 'CONCLUIDA' | 'REJEITADA' | 'INDETERMINADO'

/**
 * Códigos de lacuna — espelho um-a-um de `LACUNA` em
 * `backend/domain/interface/aprovacoes/constants.ts`. O frontend não importa do backend
 * (boundary), então a união é replicada aqui, como já se faz em `lib/recebimentos.ts`.
 */
export type Lacuna =
  | 'STATUS_ETAPA_DESCONHECIDO'
  | 'SEM_DATA_FINALIZACAO'
  | 'ETAPA_SEM_RESPONSAVEL'
  | 'TIMESTAMPS_INCONSISTENTES'
  | 'ACAO_ETAPA_DESCONHECIDA'

/** Texto legível de cada lacuna — espelho de `LACUNA_DESCRICAO` do backend. */
const LACUNA_DESCRICAO: Readonly<Record<Lacuna, string>> = {
  STATUS_ETAPA_DESCONHECIDO:
    'O ERP devolveu um status de etapa que ainda não sabemos interpretar (PV-01).',
  SEM_DATA_FINALIZACAO:
    'A data de finalização do documento não é exposta pela API acessível hoje; o relógio começa na primeira etapa (PV-04).',
  ETAPA_SEM_RESPONSAVEL: 'Etapa sem responsável registrado no ERP.',
  TIMESTAMPS_INCONSISTENTES:
    'A data da ação é anterior à data de recebimento da etapa; duração não calculada.',
  ACAO_ETAPA_DESCONHECIDA:
    'O ERP registrou uma ação de etapa que ainda não sabemos classificar como aprovação ou recusa (PV-02).',
}

/**
 * Traduz um código de lacuna para o texto do analista.
 *
 * Um código desconhecido cai de volta para o **próprio código**, nunca para silêncio: se o backend
 * ganhar uma lacuna nova antes desta tabela, o analista ainda vê que existe algo a esclarecer —
 * que é exatamente o propósito das lacunas.
 */
export function descreverLacuna(codigo: string): string {
  return LACUNA_DESCRICAO[codigo as Lacuna] ?? codigo
}

/** Ordem de exibição dos status na UI — do "nada a ver" ao "precisa de olhos". */
export const STATUS_WORKFLOW_VALORES: readonly StatusWorkflow[] = [
  'AGUARDANDO',
  'APROVADO',
  'REJEITADO',
  'INDETERMINADO',
  'SEM_WORKFLOW',
]

// ─────────────────────────────────────────────────────────── Entidades (espelho dos DTOs)
// Campos temporais chegam como ISO 8601 string no JSON — por isso `string`, não `Date`.

/** Etapa atual (a que está esperando alguém) resumida na linha do grid. */
export interface EtapaAtualResumo {
  nome?: string
  alcada?: string
  responsavelNome?: string
  recebidoEm?: string
  /**
   * Há quanto tempo a etapa está PARADA esperando ação — espera EM CURSO, relógio andando.
   * NÃO é `duracaoSegundos` (duração fechada de etapa já concluída). Confundir os dois faria
   * o painel somar espera em aberto com tempo consumado.
   */
  paradaHaSegundos?: number
}

/** Uma linha do grid `GET /aprovacoes`. */
export interface AprovacaoListItem {
  /** Chave natural composta: `${filCod}:${docCod}:${titCod}`. */
  id: string
  filCod: number
  documentoNumero?: string
  tituloNumero?: string
  fornecedorCod?: number
  fornecedorNome?: string
  valor?: number
  moeda?: string
  dataEmissao?: string
  dataVencimento?: string
  /**
   * Hoje **sempre ausente** — `docDtaFinalizacao` não vem na projeção atual (PV-04).
   *
   * Por isso o grid NÃO tem coluna "Finalização": mostrar `dataEmissao` sob esse rótulo
   * seria mentir sobre justamente o marco que o cliente usou para definir o aceite
   * ("o documento foi finalizado às 10:00"). O grid rotula a coluna "Emissão" e mostra
   * `dataEmissao`, que é outro dado — e diz que é.
   */
  dataFinalizacao?: string
  statusWorkflow: StatusWorkflow
  etapasConcluidas: number
  etapasTotais: number
  /**
   * Quantas etapas estão `PENDENTE` neste título AGORA.
   *
   * `etapaAtual` é só a mais antiga delas. Um título pode ter várias etapas abertas em
   * paralelo; mostrar uma só, calada, faria o analista achar que a fila é menor do que é —
   * por isso o grid exibe `+N` quando este número passa de 1.
   */
  etapasAbertas: number
  /** A etapa pendente MAIS ANTIGA. Veja `etapasAbertas` antes de tratá-la como "a única". */
  etapaAtual?: EtapaAtualResumo
  tempoTotalSegundos?: number
  /**
   * O que este título NÃO nos diz — **códigos** (`SEM_DATA_FINALIZACAO`, …), não prosa.
   * Use `descreverLacuna()` para exibir. Um painel financeiro auditável não pode omitir o que
   * não sabe, então isto é renderizado na linha (ícone + tooltip).
   */
  lacunas: string[]
}

/** Resposta paginada do grid. */
export interface AprovacoesListResponse {
  items: AprovacaoListItem[]
  page: number
  pageSize: number
  total: number
  /** I7 — momento do snapshot do ERP. Obrigatório na UI: o analista precisa saber a idade do dado. */
  snapshotEm?: string
}

/** Uma etapa da trilha completa (`GET /aprovacoes/:id/trilha`) — consumida pela fatia F3. */
export interface EtapaTrilha {
  fblCod: number
  ftbCod: number
  nome?: string
  alcada?: string
  /** `LIBERAR` | `APROVAR` — ambas contam como conclusão positiva por ora (PV-02). */
  acao?: string
  responsavelNome?: string
  /** Hoje sempre ausente — a projeção não traz `usnCodCmd` (PV-10). */
  responsavelCod?: number
  status: EtapaStatus
  /** Valor bruto de `ftbVldStatus`, preservado para reclassificar quando PV-01 fechar. */
  statusErp?: number
  recebidoEm?: string
  agidoEm?: string
  /** Duração FECHADA da etapa; ausente enquanto pendente (invariante I3). */
  duracaoSegundos?: number
  /** Espera EM CURSO; só existe enquanto pendente. */
  paradaHaSegundos?: number
  observacao?: string
}

/** Resposta da trilha completa de um título — consumida pela fatia F3. */
export interface TrilhaResponse {
  cabecalho: AprovacaoListItem
  /** Ordem cronológica por `recebidoEm`. */
  etapas: EtapaTrilha[]
  lacunas: string[]
  snapshotEm?: string
}

// ─────────────────────────────────────────────────────────── Filtros

/**
 * Filtros do grid — vão como query string para `GET /aprovacoes`.
 *
 * Todos são aplicados no SERVIDOR. Filtrar no cliente rodaria sobre a página já capada,
 * então um título antigo com problema ficaria fora justamente da busca feita para achá-lo.
 */
export interface AprovacoesFiltros {
  page?: number
  pageSize?: number
  filCod?: number
  status?: StatusWorkflow
  fornecedorCod?: number
  responsavel?: string
  /** ISO `YYYY-MM-DD` — início do período de EMISSÃO. */
  emissaoDe?: string
  /** ISO `YYYY-MM-DD` — fim do período de EMISSÃO. */
  emissaoAte?: string
  busca?: string
}

/** Monta a query string, omitindo o que estiver vazio (undefined ou string em branco). */
const montarQuery = (filtros: AprovacoesFiltros): string => {
  const params = new URLSearchParams()
  const set = (chave: string, valor?: string | number) => {
    if (valor === undefined || valor === null) return
    const texto = String(valor).trim()
    if (texto === '') return
    params.set(chave, texto)
  }
  set('page', filtros.page)
  set('pageSize', filtros.pageSize)
  set('filCod', filtros.filCod)
  set('status', filtros.status)
  set('fornecedorCod', filtros.fornecedorCod)
  set('responsavel', filtros.responsavel)
  set('emissaoDe', filtros.emissaoDe)
  set('emissaoAte', filtros.emissaoAte)
  set('busca', filtros.busca)
  const qs = params.toString()
  return qs === '' ? '' : `?${qs}`
}

// ─────────────────────────────────────────────────────────── Chamada

/**
 * Busca uma PÁGINA do grid de aprovações (`GET /aprovacoes`).
 *
 * NÃO cai em fixture e NÃO engole erro: o painel tem estado de erro com "tentar de novo",
 * e um fallback silencioso transformaria banco vazio em dado de demonstração — o pior tipo
 * de mentira num painel financeiro.
 */
export async function fetchAprovacoes(
  filtros: AprovacoesFiltros = {},
): Promise<AprovacoesListResponse> {
  const res = await apiFetch(`${API}/aprovacoes${montarQuery(filtros)}`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let detalhe = ''
    try {
      const j = await res.json()
      detalhe = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detalhe}`)
  }
  const json = (await res.json()) as Partial<AprovacoesListResponse>
  const items = (json.items ?? []).map((item) => ({
    ...item,
    // `lacunas` é o campo que documenta o que não sabemos; se vier ausente por qualquer
    // motivo, vira lista vazia em vez de explodir a renderização da linha.
    lacunas: item.lacunas ?? [],
    // `etapasAbertas` é obrigatório no contrato; o `?? 0` só protege a renderização de uma
    // resposta antiga — nunca inventa etapas.
    etapasAbertas: item.etapasAbertas ?? 0,
  }))
  return {
    items,
    page: json.page ?? filtros.page ?? 1,
    pageSize: json.pageSize ?? filtros.pageSize ?? items.length,
    total: json.total ?? items.length,
    snapshotEm: json.snapshotEm,
  }
}

/**
 * Busca a trilha COMPLETA de um título (`GET /aprovacoes/:id/trilha`).
 *
 * `id` é a chave natural composta `${filCod}:${docCod}:${titCod}` — vai `encodeURIComponent`ada
 * porque os `:` são significativos para o path.
 *
 * Mesma doutrina do `fetchAprovacoes`: erro sobe, nada vira fixture. Uma trilha meio carregada,
 * exibida como se fosse a trilha inteira, faria o analista concluir que faltam etapas quando na
 * verdade faltou a resposta.
 */
export async function fetchTrilha(id: string): Promise<TrilhaResponse> {
  const res = await apiFetch(`${API}/aprovacoes/${encodeURIComponent(id)}/trilha`, {
    headers: await withAuthHeaders(),
  })
  if (!res.ok) {
    let detalhe = ''
    try {
      const j = await res.json()
      detalhe = j?.error ? ` — ${j.error}` : ''
    } catch {}
    throw new Error(`API ${res.status}${detalhe}`)
  }
  const json = (await res.json()) as Partial<TrilhaResponse>
  const cabecalho = json.cabecalho
  if (cabecalho === undefined) {
    // Sem cabeçalho não há como saber de QUE título é a trilha. Renderizar as etapas soltas
    // seria pior que falhar: o analista leria a trilha de um título achando que é a de outro.
    throw new Error('Resposta sem cabeçalho: não é possível identificar o título desta trilha.')
  }
  return {
    cabecalho: {
      ...cabecalho,
      lacunas: cabecalho.lacunas ?? [],
      etapasAbertas: cabecalho.etapasAbertas ?? 0,
    },
    // A ordem cronológica é responsabilidade do BACKEND (contrato: "ordem cronológica por
    // `recebidoEm`"). O cliente não reordena: se a ordem vier errada, o bug tem de aparecer
    // onde ele nasce, não ser mascarado aqui.
    etapas: json.etapas ?? [],
    lacunas: json.lacunas ?? [],
    snapshotEm: json.snapshotEm,
  }
}

// ─────────────────────────────────────────────────────────── Formatação de tempo

/**
 * Formata uma quantidade de segundos como duração legível em pt-BR (`2 d 3 h`, `23 h 29 min`).
 *
 * Deliberadamente SEM rótulo: quem chama decide se aquilo é "parada há" (espera em curso) ou
 * "durou" (duração fechada). A função nunca escolhe por você — essa é exatamente a confusão
 * que o produto não pode cometer.
 */
export function formatDuracaoSegundos(segundos?: number): string {
  if (segundos === undefined || !Number.isFinite(segundos) || segundos < 0) return '—'
  const total = Math.floor(segundos)
  if (total < 60) return `${total} s`
  const minutos = Math.floor(total / 60)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const minutosResto = minutos % 60
  if (horas < 24) return minutosResto > 0 ? `${horas} h ${minutosResto} min` : `${horas} h`
  const dias = Math.floor(horas / 24)
  const horasResto = horas % 24
  return horasResto > 0 ? `${dias} d ${horasResto} h` : `${dias} d`
}
