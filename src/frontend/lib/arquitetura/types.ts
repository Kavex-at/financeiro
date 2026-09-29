/**
 * Modelo de dados da página de arquitetura (`/docs/arquitetura`).
 *
 * Fonte única versionada: cada nó carrega seus metadados (frente, camada,
 * maturidade, estado) e as *vistas* são filtros sobre esse mesmo grafo, em vez
 * de grafos paralelos que divergem entre si com o tempo.
 */

/** Frente de negócio à qual o nó pertence. */
export type Frente = 'permutas' | 'sispag' | 'recebimentos' | 'plataforma'

/** Camada arquitetural — usada para o layout em colunas da vista técnica. */
export type Camada =
    | 'ui'
    | 'edge'
    | 'rota'
    | 'servico'
    | 'repositorio'
    | 'cliente'
    | 'dados'
    | 'job'
    | 'externo'
    | 'infra'
    | 'humano'

/**
 * Maturidade real do nó — o eixo mais importante do diagrama, porque as
 * frentes estão em estágios diferentes e renderizá-las com o mesmo peso
 * visual seria enganoso.
 */
export type Maturidade =
    /** Em produção, exercitado. */
    | 'implementado'
    /** Existe, mas com lacuna conhecida (ex.: write-back gated, retorno simulado). */
    | 'parcial'
    /** Mapeado/provado, sem código de produção. */
    | 'planejado'
    /** Nem código nem ontologia — só a proposta comercial. */
    | 'inexistente'
    /** Código presente sem nenhum importador — pronto para o alvo, morto hoje. */
    | 'orfao'

/** Em qual recorte do toggle o nó aparece. */
export type Estado = 'hoje' | 'alvo' | 'ambos'

/** Vista à qual o nó pertence. */
export type Vista = 'macro' | 'tecnica'

export type NivelRisco = 'critico' | 'alto' | 'medio'

export interface Risco {
    nivel: NivelRisco
    texto: string
    /** Referência ao achado de origem (Regis-Review, ADR, migration-debt). */
    origem?: string
}

/** Payload de cada nó — consumido pelo nó customizado e pelo painel lateral. */
export interface ArqNodeData extends Record<string, unknown> {
    label: string
    subtitle?: string
    frente: Frente
    camada: Camada
    maturidade: Maturidade
    estado: Estado
    vista: Vista
    /** Parágrafo(s) de explicação exibido(s) no painel lateral. */
    descricao: string
    /** Caminhos relativos à raiz do repo. */
    arquivos?: string[]
    /** Programas do ERP Conexos tocados por este nó. */
    programasErp?: string[]
    riscos?: Risco[]
    /** Documentos de referência (ADRs, ontologia, runbooks). */
    docRefs?: string[]
}

/**
 * Natureza da aresta. `escrita` marca os caminhos que movem dinheiro e `gap`
 * marca o que ainda não existe — os dois recortes que o diagrama precisa
 * comunicar melhor que o texto corrido.
 */
export type TipoAresta = 'fluxo' | 'leitura' | 'escrita' | 'agendamento' | 'gap' | 'humano'

export interface ArqEdge {
    id: string
    source: string
    target: string
    label?: string
    tipo: TipoAresta
    estado: Estado
    vista: Vista
    /** Aresta tracejada com rótulo destacado — usada no hop faltante do SISPAG. */
    destaque?: boolean
}

export interface ArqNode {
    id: string
    position: { x: number; y: number }
    data: ArqNodeData
}

/** Rótulos legíveis, usados na legenda e no painel. */
export const MATURIDADE_LABEL: Record<Maturidade, string> = {
    implementado: 'Implementado',
    parcial: 'Parcial',
    planejado: 'Planejado',
    inexistente: 'Não existe',
    orfao: 'Órfão',
}

export const FRENTE_LABEL: Record<Frente, string> = {
    permutas: 'Frente I — Permutas',
    sispag: 'Frente II — SISPAG',
    recebimentos: 'Frente IV — Conciliação de Recebimentos',
    plataforma: 'Plataforma',
}

export const CAMADA_LABEL: Record<Camada, string> = {
    ui: 'Frontend',
    edge: 'Borda HTTP',
    rota: 'Rota',
    servico: 'Serviço',
    repositorio: 'Repositório',
    cliente: 'Cliente externo',
    dados: 'Dados',
    job: 'Job agendado',
    externo: 'Sistema externo',
    infra: 'Infraestrutura',
    humano: 'Pessoa',
}

export const TIPO_ARESTA_LABEL: Record<TipoAresta, string> = {
    fluxo: 'Fluxo',
    leitura: 'Leitura',
    escrita: 'Escrita (move dinheiro)',
    agendamento: 'Agendamento',
    gap: 'Lacuna — não existe',
    humano: 'Decisão humana',
}
