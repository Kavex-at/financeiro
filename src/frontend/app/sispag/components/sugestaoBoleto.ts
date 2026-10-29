import type {
  AjusteCentavos,
  AvisoVenceAntes,
  CandidatoTituloBoleto,
  DesfechoTituloBoleto,
  GrupoSugeridoRef,
  SinalSugestaoBoleto,
  SituacaoSugestaoTitulo,
  ModoAjusteCentavos,
  ReconhecimentoDivergencia,
  SugestaoBoleto,
} from '@/lib/sispag'
import { MOTIVO_RECONHECIMENTO_MAX, MOTIVO_RECONHECIMENTO_MIN } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { formatCentavos, rotuloMotivoGrupo } from './grupoBoleto'

const numero = (n: number, casas: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n)

const sinal = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '')

/** `R$ +0,01`, `R$ -12,50`, `R$ 0,00` — boleto menos título, sempre com sinal. */
export const formatDeltaValor = (d: number): string => `R$ ${sinal(d)}${numero(Math.abs(d), 2)}`

/** `+1,6 %`, `-0,3 %`. */
export const formatDeltaPercentual = (d: number): string => `${sinal(d)}${numero(Math.abs(d), 1)} %`

/** `+2 dias`, `-1 dia`, `0 dias` — vencimento do boleto menos o do título. */
export const formatDeltaDias = (d: number): string =>
  `${sinal(d)}${Math.abs(d)} ${Math.abs(d) === 1 ? 'dia' : 'dias'}`

/** Sinais que ancoram o candidato (ADR-0072 + I15p) — espelha o motor do backend. */
const SINAIS_ANCORA: ReadonlySet<SinalSugestaoBoleto> = new Set<SinalSugestaoBoleto>([
  'EMISSOR_CONFIRMADO',
  'NUMERO_IGUAL',
  'DPS_IGUAL',
  'ORDEM_DPS',
  'NUMERO_CONFIAVEL',
])

export const TEXTO_SINAL: Record<SinalSugestaoBoleto, { texto: string; atencao: boolean }> = {
  VALOR_IGUAL: { texto: 'valor igual ao do título', atencao: false },
  VALOR_ATE_5_CENTAVOS: { texto: 'valor difere em até R$ 0,05 do título', atencao: true },
  MESMO_DIA: { texto: 'vence no mesmo dia do título', atencao: false },
  DIAS_DEPOIS: { texto: 'vence depois do título', atencao: true },
  NUMERO_IGUAL: { texto: 'número do boleto igual ao do documento', atencao: false },
  COLISAO_NUMERO: { texto: 'número do boleto coincide com o de outro título', atencao: true },
  EMISSOR_CONFIRMADO: { texto: 'emissor já confirmado para este credor', atencao: false },
  VENCE_ANTES_DO_TITULO: { texto: 'vence antes do título', atencao: true },
  RECONHECEU_VENCE_ANTES: {
    texto: 'aviso de vencimento antes do título reconhecido por quem confirmou',
    atencao: false,
  },
  DATA_DIVERGENTE_RECONHECIDA: {
    texto: 'data divergente reconhecida por quem confirmou',
    atencao: false,
  },
  DPS_IGUAL: { texto: 'número do boleto igual ao DPS da NFS-e', atencao: false },
  ORDEM_DPS: { texto: 'casado pela ordem do DPS da NFS-e deste emissor', atencao: false },
  NUMERO_CONFIAVEL: {
    texto: 'número do boleto igual ao do documento (confiável)',
    atencao: false,
  },
}

/**
 * Sinais exibidos como evidência: `NUMERO_CONFIAVEL` suprime `NUMERO_IGUAL` (textos quase idênticos)
 * e `COLISAO_NUMERO` (na faixa ampliada da âncora, todo par de número igual fora dos limites globais
 * emite a colisão, e o texto "coincide com o de outro título" contradiz a âncora confiável).
 * Sem `NUMERO_CONFIAVEL`, ambos continuam visíveis. Só exibição — o backend e os dados mantêm os
 * sinais (ADR-0079).
 */
export const sinaisVisiveis = (sinais: SinalSugestaoBoleto[]): SinalSugestaoBoleto[] =>
  sinais.includes('NUMERO_CONFIAVEL')
    ? sinais.filter((s) => s !== 'NUMERO_IGUAL' && s !== 'COLISAO_NUMERO')
    : sinais

export const TIER_ROTULO: Record<SugestaoBoleto['avaliacao']['resultado'], string> = {
  CONHECIDO: 'sugestão forte · emissor conhecido',
  FORTE: 'sugestão forte',
  ATENCAO: 'atenção',
  VENCIDO_INFORMATIVO: 'vencido · só informativo',
  SEM_RELACAO: 'sem relação com o título',
}

export type ResumoSugestaoTitulo = 'ORFA' | 'CONFIRMADA' | 'DISPONIVEL' | 'INFORMATIVA'

export const chaveTitulo = (t: { filCod?: number; docCod: string; titCod: string }): string =>
  `${t.filCod ?? ''}:${t.docCod}:${t.titCod}`

/** Agrupa a listagem por título (`fil:doc:tit`). */
export const agruparPorTitulo = (lista: SugestaoBoleto[]): Map<string, SugestaoBoleto[]> => {
  const mapa = new Map<string, SugestaoBoleto[]>()
  for (const s of lista) {
    const k = chaveTitulo(s)
    const atual = mapa.get(k)
    if (atual) atual.push(s)
    else mapa.set(k, [s])
  }
  return mapa
}

/**
 * O que a linha do título anuncia: confirmação órfã (precisa de atenção) > confirmado > sugestão
 * confirmável > só informativa.
 */
export const resumoDoTitulo = (
  lista: SugestaoBoleto[] | undefined,
): ResumoSugestaoTitulo | undefined => {
  if (!lista || lista.length === 0) return undefined
  if (lista.some((s) => s.estado === 'CONFIRMADA' && s.orfa === true)) return 'ORFA'
  if (lista.some((s) => s.estado === 'CONFIRMADA')) return 'CONFIRMADA'
  if (lista.some((s) => s.confirmavel && s.avaliacao.confirmavel)) return 'DISPONIVEL'
  return 'INFORMATIVA'
}

// ─────────────────────────────────────── ADR-0072 — desfecho por título (I15m–I15o)

/** Rótulo do link da coluna "Forma de pagamento". Fraco NUNCA diz "sugestão disponível". */
export const ROTULO_SITUACAO: Record<SituacaoSugestaoTitulo, string> = {
  EM_GRUPO: 'em boleto agrupado',
  GRUPO_SUGERIDO: 'em grupo sugerido',
  UNICA_SEGURA: 'sugestão disponível',
  SO_ATENCAO: 'ver boleto sugerido',
  AMBIGUA: 'mais de um boleto possível',
  SO_FRACA: 'ver candidato (sem confirmação)',
  DISPUTADA: 'boleto reservado a outro título',
  SO_VENCIDA: 'ver boleto vencido',
  SEM_CANDIDATO: 'sem boleto no pool',
  CONFIRMADA: 'boleto confirmado',
  ORFA: 'confirmação a revisar',
}

/** Tom do link: só o que é confirmável e seguro usa o tom de ação; o resto é aviso ou texto mudo. */
export type TomSituacao = 'acao' | 'aviso' | 'mudo'

export const TOM_SITUACAO: Record<SituacaoSugestaoTitulo, TomSituacao> = {
  EM_GRUPO: 'mudo',
  GRUPO_SUGERIDO: 'aviso',
  UNICA_SEGURA: 'acao',
  SO_ATENCAO: 'aviso',
  AMBIGUA: 'aviso',
  SO_FRACA: 'mudo',
  DISPUTADA: 'mudo',
  SO_VENCIDA: 'aviso',
  SEM_CANDIDATO: 'mudo',
  CONFIRMADA: 'acao',
  ORFA: 'aviso',
}

/**
 * Só `SEM_CANDIDATO` não tem o que mostrar além do texto: não vira botão. `EM_GRUPO` e
 * `GRUPO_SUGERIDO` abrem a gaveta (I21v): é lá que o grupo aparece, com Confirmar ou Anular.
 */
export const SITUACAO_SEM_PAINEL: ReadonlySet<SituacaoSugestaoTitulo> = new Set(['SEM_CANDIDATO'])

export interface ResumoDesfecho {
  situacao: SituacaoSugestaoTitulo
  avisoVenceAntes: AvisoVenceAntes
  /** Candidatos dentro do envelope (antes do corte de exibição). */
  total: number
  /** I21v: a sugestão de grupo a que o título pertence (qualquer situação). */
  grupoSugerido?: GrupoSugeridoRef | undefined
}

export const resumoDoDesfecho = (d: DesfechoTituloBoleto | undefined): ResumoDesfecho | undefined =>
  d
    ? {
        situacao: d.situacao,
        avisoVenceAntes: d.avisoVenceAntes,
        total: d.totalCandidatos,
        ...(d.grupoSugerido ? { grupoSugerido: d.grupoSugerido } : {}),
      }
    : undefined

// ── I21v/I21w — título de uma SUGESTÃO de grupo na carteira (ADR-0077, emenda 2026-10-29) ───────

/** Ação do selo: abre a gaveta do título, onde o grupo aparece. Não confirma nada por si (I21w). */
export const ACAO_VER_GRUPO = 'Ver grupo'

/** `Faz parte de um grupo sugerido: boleto 129818, 2 títulos, R$ 26.369,85.` */
export const descricaoGrupoSugerido = (g: GrupoSugeridoRef): string => {
  const boleto = g.numeroBoleto ? `boleto ${g.numeroBoleto}, ` : ''
  const base = `Faz parte de um grupo sugerido: ${boleto}${g.nTitulos} títulos, ${formatCentavos(g.valorBoletoCentavos)}.`
  return g.confirmavel || !g.motivo ? base : `${base} Ainda não confirmável: ${rotuloMotivoGrupo(g.motivo)}.`
}

/** Aviso ao selecionar o título avulso (Q8): confirme o grupo em vez de pagar avulso. */
export const avisoSelecaoGrupoSugerido = (r: ResumoDesfecho | undefined): string | undefined =>
  r?.grupoSugerido
    ? 'Este título faz parte de um grupo sugerido: confirme o grupo na gaveta do título em vez de pagá-lo avulso.'
    : undefined

/** Texto do chip de aviso da grade (caso A = já vencido no débito; caso B = vence antes do título). */
export const ROTULO_AVISO: Record<Exclude<AvisoVenceAntes, 'NENHUM'>, string> = {
  CRITICO: 'boleto já vencido no débito',
  ATENCAO: 'boleto vence antes do título',
}

/** `Map` de desfecho por `fil:doc:tit`. */
export const desfechoPorTitulo = (
  lista: DesfechoTituloBoleto[] | undefined,
): Map<string, DesfechoTituloBoleto> => new Map((lista ?? []).map((d) => [chaveTitulo(d), d]))

/** `AAAA-MM-DD` → `DD/MM` (data civil; nunca passa por `Date`, para não deslocar o dia). */
const diaMes = (civil: string): string => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(civil)
  return m ? `${m[2]}/${m[1]}` : civil
}

const diasEntreCivis = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000)

const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

/**
 * Mensagem completa do aviso `VENCE_ANTES_DO_TITULO` (§3.4 da proposta). `undefined` quando o
 * boleto vence no dia do título ou depois: nenhuma mensagem inventada para Δ ≥ 0. A decisão
 * legada sem o sinal gravado cai aqui pelo `deltaDias < 0`.
 */
export const mensagemVenceAntes = (
  c: Pick<CandidatoTituloBoleto, 'avaliacao' | 'vencimentoBoleto'>,
  ctx: { vencimentoTitulo: string; dataDebito: string },
): string | undefined => {
  const a = c.avaliacao
  if (a.resultado === 'SEM_RELACAO') return undefined
  if (a.deltaDias >= 0) return undefined
  const antes = Math.abs(a.deltaDias)
  const inicio = `Este boleto vence em ${diaMes(c.vencimentoBoleto)}, ${dias(antes)} antes do título (${diaMes(ctx.vencimentoTitulo)}).`
  const vencidoNoDebito =
    a.diasVencidoNoDebito ?? Math.max(0, diasEntreCivis(c.vencimentoBoleto, ctx.dataDebito))
  if (a.resultado === 'VENCIDO_INFORMATIVO' || vencidoNoDebito > 0) {
    return `${inicio} Na data de débito (${diaMes(ctx.dataDebito)}) ele já estará vencido há ${dias(vencidoNoDebito)}: pagar pode gerar juros e multa. Confirme o vencimento no portal do banco antes de decidir. Serve só como informação.`
  }
  return `${inicio} O débito está previsto para ${diaMes(ctx.dataDebito)}, dentro do prazo do boleto, mas se o pagamento atrasar ele vencerá antes do título: pode haver juros e multa. Confirmar não faz o boleto sair na remessa.`
}

/**
 * O candidato exige reconhecimento ao confirmar (o servidor confere de novo): o aviso simples de
 * vence-antes (I15o) ou o ack TIPADO de data divergente (I15r).
 */
export const exigeReconhecimento = (c: Pick<CandidatoTituloBoleto, 'avaliacao'>): boolean =>
  c.avaliacao.sinais.includes('VENCE_ANTES_DO_TITULO') || exigeReconhecimentoTipado(c)

/**
 * O par exige o reconhecimento TIPADO da divergência de data (I15r, ADR-0078): valor igual e
 * Δdias fora da janela padrão (Δ<0 ou Δ>5). Substitui o aviso simples nesse caso; o Δ<0 com valor
 * diferente segue no aviso simples. Backend antigo (sem o campo) nunca pede o tipado.
 */
export function exigeReconhecimentoTipado(c: Pick<CandidatoTituloBoleto, 'avaliacao'>): boolean {
  return c.avaliacao.exigeReconhecimento === 'DATA_DIVERGENTE'
}

/**
 * O ack tipado que a tela envia: o que ela EXIBE (Δ dias e valor do boleto em centavos), nunca um
 * recálculo — o servidor confere com a avaliação ao vivo e recusa se algo mudou (anti-TOCTOU).
 */
export const montarReconhecimentoDivergencia = (
  c: Pick<CandidatoTituloBoleto, 'avaliacao' | 'valorBoleto'>,
  motivo: string,
): ReconhecimentoDivergencia => ({
  tipo: 'DATA_DIVERGENTE',
  aceito: true,
  motivo: motivo.trim(),
  deltaDiasVisto: c.avaliacao.deltaDias,
  valorBoletoVisto: Math.round(c.valorBoleto * 100),
})

/** Motivo válido do ack tipado (mesma regra do servidor: 10 a 500 caracteres sem as pontas). */
export const motivoReconhecimentoValido = (motivo: string): boolean => {
  const n = motivo.trim().length
  return n >= MOTIVO_RECONHECIMENTO_MIN && n <= MOTIVO_RECONHECIMENTO_MAX
}

/** Texto do diálogo do ack tipado: a data do boleto frente à do título, com o sentido do Δ. */
export const mensagemDivergenciaData = (
  c: Pick<CandidatoTituloBoleto, 'avaliacao' | 'vencimentoBoleto'>,
  ctx: { vencimentoTitulo: string },
): string => {
  const n = Math.abs(c.avaliacao.deltaDias)
  const sentido = c.avaliacao.deltaDias < 0 ? 'antes do' : 'depois do'
  return `O valor do boleto é igual ao do título, mas ele vence em ${diaMes(c.vencimentoBoleto)}, ${dias(n)} ${sentido} título (${diaMes(ctx.vencimentoTitulo)}). Confirme o vencimento no portal do banco antes de reconhecer.`
}

/**
 * Um candidato do desfecho no formato que o painel já renderiza. Confirmada e órfã vêm com
 * `estado: CONFIRMADA`; o motivo do que não é confirmável acompanha o item.
 */
export const candidatoComoSugestao = (
  d: DesfechoTituloBoleto,
  c: CandidatoTituloBoleto,
): SugestaoBoleto => ({
  filCod: d.filCod,
  docCod: d.docCod,
  titCod: d.titCod,
  ...(d.pesCod ? { pesCod: d.pesCod } : {}),
  ...(d.credor ? { credor: d.credor } : {}),
  valorTitulo: d.valorTitulo,
  vencimentoTitulo: d.vencimentoTitulo,
  dataDebito: d.dataDebito,
  ddcCod: c.ddcCod,
  ditCod: c.ditCod,
  ...(c.numeroBoleto ? { numeroBoleto: c.numeroBoleto } : {}),
  valorBoleto: c.valorBoleto,
  vencimentoBoleto: c.vencimentoBoleto,
  ...(c.emissor ? { emissor: c.emissor } : {}),
  avaliacao: c.avaliacao,
  estado: d.situacao === 'CONFIRMADA' || d.situacao === 'ORFA' ? 'CONFIRMADA' : 'SUGERIDA',
  confirmavel: c.confirmavel,
  ...(c.motivo ? { motivo: c.motivo } : {}),
  ...(d.situacao === 'ORFA'
    ? { orfa: true, ...(d.motivoOrfa ? { motivoOrfa: d.motivoOrfa } : {}) }
    : {}),
  ...(c.confirmacaoEmissorId ? { confirmacaoEmissorId: c.confirmacaoEmissorId } : {}),
  ...(c.decididoPor ? { decididoPor: c.decididoPor } : {}),
  ...(c.transferidaPor ? { transferidaPor: c.transferidaPor } : {}),
})

/**
 * Resposta de um backend anterior ao ADR-0072 (sem `titulos[]`): reconstrói um desfecho por título
 * a partir da lista antiga, para a tela funcionar nos dois sentidos durante o deploy. Só afirma o
 * que a lista antiga prova (confirmável / informativa / confirmada / órfã); nunca inventa
 * `AMBIGUA`, `DISPUTADA` nem `SEM_CANDIDATO`.
 */
export const desfechosDeSugestoesLegadas = (lista: SugestaoBoleto[]): DesfechoTituloBoleto[] => {
  const desfechos: DesfechoTituloBoleto[] = []
  for (const itens of agruparPorTitulo(lista).values()) {
    const primeiro = itens[0]
    const resumo = resumoDoTitulo(itens)
    if (!primeiro || !resumo) continue
    const escolhido = itens.find((s) => s.confirmavel && s.avaliacao.confirmavel)
    const situacao: SituacaoSugestaoTitulo =
      resumo === 'ORFA'
        ? 'ORFA'
        : resumo === 'CONFIRMADA'
          ? 'CONFIRMADA'
          : resumo === 'DISPONIVEL'
            ? escolhido?.avaliacao.resultado === 'ATENCAO'
              ? 'SO_ATENCAO'
              : 'UNICA_SEGURA'
            : 'SO_VENCIDA'
    const melhor = escolhido ?? primeiro
    const aviso: AvisoVenceAntes =
      melhor.avaliacao.deltaDias >= 0
        ? 'NENHUM'
        : melhor.avaliacao.resultado === 'VENCIDO_INFORMATIVO'
          ? 'CRITICO'
          : 'ATENCAO'
    desfechos.push({
      filCod: primeiro.filCod,
      docCod: primeiro.docCod,
      titCod: primeiro.titCod,
      ...(primeiro.pesCod ? { pesCod: primeiro.pesCod } : {}),
      ...(primeiro.credor ? { credor: primeiro.credor } : {}),
      valorTitulo: primeiro.valorTitulo,
      vencimentoTitulo: primeiro.vencimentoTitulo,
      dataDebito: primeiro.dataDebito,
      situacao,
      candidatos: itens.map((s) => ({
        ddcCod: s.ddcCod,
        ditCod: s.ditCod,
        ...(s.numeroBoleto ? { numeroBoleto: s.numeroBoleto } : {}),
        valorBoleto: s.valorBoleto,
        vencimentoBoleto: s.vencimentoBoleto,
        ...(s.emissor ? { emissor: s.emissor } : {}),
        avaliacao: s.avaliacao,
        ancorado: s.avaliacao.sinais.some((x) => SINAIS_ANCORA.has(x)),
        confirmavel: s.confirmavel && s.avaliacao.confirmavel && s.estado !== 'CONFIRMADA',
        ...(s.motivo ? { motivo: s.motivo } : {}),
        ...(s.confirmacaoEmissorId ? { confirmacaoEmissorId: s.confirmacaoEmissorId } : {}),
      })),
      totalCandidatos: itens.length,
      motivo: primeiro.motivo ?? ROTULO_SITUACAO[situacao],
      ...(primeiro.motivoOrfa ? { motivoOrfa: primeiro.motivoOrfa } : {}),
      avisoVenceAntes: aviso,
      diasVencidoNoDebito: melhor.avaliacao.diasVencidoNoDebito ?? 0,
    })
  }
  return desfechos
}


// ── Ajuste de centavos do título (ADR-0074, I18) ─────────────────────────────────────────────

/** Limite da I15c/I18a (R$ 0,05): só pares confirmados dentro dele têm ajuste. */
export const LIMITE_AJUSTE_CENTAVOS = 0.05

export type TipoSeloAjuste = 'simulacao' |'em_curso' | 'concluido' | 'aviso'

export interface SeloAjusteCentavos {
  tipo: TipoSeloAjuste
  texto: string
  /** "Tentar de novo" faz sentido (o executor pode retomar ou reavaliar). */
  retomavel: boolean
}

const EM_CURSO: ReadonlySet<AjusteCentavos['etapa']> = new Set([
  'pendente',
  'renegociacao_criada',
  'titulo_incluido',
  'composicao_gravada',
  'ajuste_aplicado',
  'finalizada',
  'liberada',
  'sem_bloqueio',
  'rechaveada',
])

const AVISO_POR_ETAPA: Partial<Record<AjusteCentavos['etapa'], { texto: string; retomavel: boolean }>> = {
  aguardando_aprovacao_manual: {
    texto:
      'título ajustado no Conexos, mas o bloqueio novo precisa de aprovação de outra pessoa no Conexos (Liberação de Títulos)',
    retomavel: false,
  },
  recusado: {
    texto: 'o título não foi ajustado; ajuste pelo fluxo normal do Conexos',
    retomavel: false,
  },
  cancelado: {
    texto: 'o ajuste foi cancelado antes de finalizar; o título original segue intacto — ajuste pelo fluxo normal do Conexos',
    retomavel: false,
  },
  indeterminado: {
    texto: 'o ajuste parou num estado incerto; é preciso conferir no Conexos antes de qualquer nova tentativa',
    retomavel: false,
  },
}

const centavosDe = (v: number): number => Math.round(v * 100)

/**
 * Estado do ajuste de centavos de UM título confirmado (I18l/I18m). Sem selo quando não há ajuste
 * possível (não confirmado, Δ = 0 ou acima de R$ 0,05). Concluído mostra o título NOVO e o LÍQUIDO
 * (valor do boleto, do ledger) — não o `titMnyValor` da carteira. Só textos e máscaras.
 */
export function seloDoAjusteCentavos(p: {
  sugestao: SugestaoBoleto
  ajuste?: AjusteCentavos
  modo?: ModoAjusteCentavos
}): SeloAjusteCentavos | null {
  const { sugestao, ajuste } = p
  if (sugestao.estado !== 'CONFIRMADA' && !ajuste) return null
  const delta = centavosDe(sugestao.avaliacao.deltaValor)
  const dentroDoLimite = delta !== 0 && Math.abs(delta) <= centavosDe(LIMITE_AJUSTE_CENTAVOS)
  if (!ajuste) {
    // Sem o modo (tela que não consultou o ajuste), não se afirma nada.
    if (!dentroDoLimite || p.modo === undefined) return null
    if (p.modo === 'shadow') {
      return {
        tipo: 'simulacao',
        texto: 'diferença de centavos — ajuste em simulação (nada é gravado no Conexos)',
        retomavel: false,
      }
    }
    return { tipo: 'aviso', texto: 'diferença de centavos — ajuste ainda não executado', retomavel: true }
  }
  if (EM_CURSO.has(ajuste.etapa)) {
    return { tipo: 'em_curso', texto: 'ajustando o título no Conexos', retomavel: true }
  }
  if (ajuste.etapa === 'concluido' || ajuste.etapa === 'concluido_sem_decisao') {
    const partes = [`título ajustado no Conexos: ${ajuste.docCod}/${ajuste.titCodNovo ?? '?'}`]
    if (ajuste.valorBoletoCentavos !== undefined) {
      partes.push(`líquido ${formatBRL(ajuste.valorBoletoCentavos / 100)}`)
    }
    if (ajuste.etapa === 'concluido_sem_decisao') partes.push('a confirmação foi anulada antes')
    return { tipo: 'concluido', texto: partes.join(' · '), retomavel: false }
  }
  const aviso = AVISO_POR_ETAPA[ajuste.etapa]
  if (!aviso) return null
  const motivo = ajuste.motivo ? ` (motivo: ${ajuste.motivo.replace(/\d{20,}/g, '…')})` : ''
  return { tipo: 'aviso', texto: `${aviso.texto}${motivo}`, retomavel: aviso.retomavel }
}
