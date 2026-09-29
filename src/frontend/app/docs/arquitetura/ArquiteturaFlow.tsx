'use client'

import {
    Background,
    BackgroundVariant,
    Controls,
    MarkerType,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    type Edge,
    type Node,
    type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo, useState } from 'react'
import {
    selecionarEdges,
    selecionarNodes,
    type ArqNodeData,
    type Estado,
    type TipoAresta,
    type Vista,
} from '@/lib/arquitetura'
import { cn } from '@/lib/utils'
import { ArquiteturaNode } from './ArquiteturaNode'
import { DetalhePanel } from './DetalhePanel'
import { Legenda } from './Legenda'

const nodeTypes = { arq: ArquiteturaNode }

/** Traço por natureza da aresta: escrita e lacuna são os dois que importam. */
const ESTILO_ARESTA: Record<TipoAresta, { stroke: string; dash?: string; width: number }> = {
    fluxo: { stroke: 'var(--muted-foreground)', width: 1.5 },
    leitura: { stroke: 'var(--info)', width: 1.5 },
    escrita: { stroke: 'var(--danger)', width: 2.5 },
    agendamento: { stroke: 'var(--origem-solnum)', dash: '6 3', width: 1.5 },
    gap: { stroke: 'var(--danger)', dash: '5 5', width: 2 },
    humano: { stroke: 'var(--permuta)', dash: '2 3', width: 1.5 },
}

interface ToggleProps<T extends string> {
    value: T
    options: { value: T; label: string; hint?: string }[]
    onChange: (value: T) => void
    label: string
}

function Toggle<T extends string>({ value, options, onChange, label }: ToggleProps<T>) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label={label}>
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        aria-pressed={value === option.value}
                        title={option.hint}
                        className={cn(
                            'rounded px-3 py-1 text-xs font-medium transition',
                            value === option.value
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted',
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    )
}

function Diagrama() {
    const [vista, setVista] = useState<Vista>('macro')
    const [recorte, setRecorte] = useState<Estado>('hoje')
    const [selecionado, setSelecionado] = useState<ArqNodeData | null>(null)

    const nodes: Node[] = useMemo(
        () =>
            selecionarNodes(vista, recorte).map((n) => ({
                id: n.id,
                position: n.position,
                data: n.data,
                type: 'arq',
            })),
        [vista, recorte],
    )

    const edges: Edge[] = useMemo(
        () =>
            selecionarEdges(vista, recorte).map((e) => {
                const estilo = ESTILO_ARESTA[e.tipo]

                return {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    label: e.label,
                    animated: e.tipo === 'escrita' || e.destaque === true,
                    style: {
                        stroke: estilo.stroke,
                        strokeWidth: estilo.width,
                        strokeDasharray: estilo.dash,
                    },
                    labelStyle: {
                        fill: 'var(--foreground)',
                        fontSize: 11,
                        fontWeight: e.destaque ? 700 : 500,
                    },
                    labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.9 },
                    labelBgPadding: [4, 2] as [number, number],
                    labelBgBorderRadius: 3,
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: estilo.stroke,
                        width: 16,
                        height: 16,
                    },
                }
            }),
        [vista, recorte],
    )

    const handleNodeClick: NodeMouseHandler = (_event, node) => {
        setSelecionado(node.data as ArqNodeData)
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Toggle
                    label="Vista"
                    value={vista}
                    onChange={(v) => {
                        setVista(v)
                        setSelecionado(null)
                    }}
                    options={[
                        { value: 'macro', label: 'Negócio', hint: 'As frentes do contrato, ponta a ponta' },
                        { value: 'tecnica', label: 'Técnica', hint: 'Camadas, clientes e infraestrutura' },
                    ]}
                />
                <Toggle
                    label="Estado"
                    value={recorte}
                    onChange={(v) => {
                        setRecorte(v)
                        setSelecionado(null)
                    }}
                    options={[
                        { value: 'hoje', label: 'Hoje', hint: 'O que roda em produção agora' },
                        { value: 'alvo', label: 'Alvo', hint: 'A arquitetura de destino do CLAUDE.md' },
                    ]}
                />
                <p className="text-xs text-muted-foreground">
                    Clique em qualquer caixa para abrir o detalhe.
                </p>
            </div>

            <div className="relative h-[70vh] min-h-[560px] w-full overflow-hidden rounded-lg border bg-background">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodeClick={handleNodeClick}
                    onPaneClick={() => setSelecionado(null)}
                    fitView
                    fitViewOptions={{ padding: 0.15 }}
                    minZoom={0.2}
                    maxZoom={1.6}
                    proOptions={{ hideAttribution: false }}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    edgesFocusable={false}
                >
                    <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable className="!hidden sm:!block" />
                </ReactFlow>

                <DetalhePanel node={selecionado} onClose={() => setSelecionado(null)} />
            </div>

            <Legenda />
        </div>
    )
}

export function ArquiteturaFlow() {
    return (
        <ReactFlowProvider>
            <Diagrama />
        </ReactFlowProvider>
    )
}
