'use client'

/**
 * Legenda do diagrama. Sem ela, o tracejado e a cor das arestas viram ruído —
 * e são justamente eles que carregam a informação mais importante da página.
 */
export function Legenda() {
    return (
        <div className="grid gap-4 rounded-lg border bg-card px-4 py-3 text-xs sm:grid-cols-3">
            <div className="space-y-1.5">
                <p className="font-semibold text-foreground">Maturidade</p>
                <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-sm border-2 border-border bg-card" />
                        Em produção
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-sm border-2 border-warning bg-card" />
                        Parcial — existe com lacuna conhecida
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-sm border-2 border-dashed border-info bg-info-subtle/40" />
                        Planejado — mapeado, sem código
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-sm border-2 border-dashed border-danger bg-danger-subtle/30" />
                        Não existe
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-sm border-2 border-dashed border-muted-foreground/50 bg-muted/40" />
                        Órfão — código sem uso
                    </li>
                </ul>
            </div>

            <div className="space-y-1.5">
                <p className="font-semibold text-foreground">Ligações</p>
                <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-2">
                        <span className="h-px w-6 shrink-0 bg-muted-foreground" />
                        Fluxo
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="h-[2.5px] w-6 shrink-0 bg-danger" />
                        Escrita no ERP — move dinheiro
                    </li>
                    <li className="flex items-center gap-2">
                        <span
                            className="h-0.5 w-6 shrink-0"
                            style={{
                                backgroundImage:
                                    'repeating-linear-gradient(to right, var(--danger) 0 5px, transparent 5px 10px)',
                            }}
                        />
                        Lacuna — o caminho não existe
                    </li>
                    <li className="flex items-center gap-2">
                        <span
                            className="h-px w-6 shrink-0"
                            style={{
                                backgroundImage:
                                    'repeating-linear-gradient(to right, var(--origem-solnum) 0 6px, transparent 6px 9px)',
                            }}
                        />
                        Agendamento
                    </li>
                    <li className="flex items-center gap-2">
                        <span
                            className="h-px w-6 shrink-0"
                            style={{
                                backgroundImage:
                                    'repeating-linear-gradient(to right, var(--permuta) 0 2px, transparent 2px 5px)',
                            }}
                        />
                        Decisão humana
                    </li>
                </ul>
            </div>

            <div className="space-y-1.5">
                <p className="font-semibold text-foreground">Frentes</p>
                <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-2">
                        <span className="h-3 w-1.5 shrink-0 rounded-sm bg-primary" />
                        I — Permutas
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="h-3 w-1.5 shrink-0 rounded-sm bg-origem-adto-forn-int" />
                        II — SISPAG
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="h-3 w-1.5 shrink-0 rounded-sm bg-origem-adto-cli-nac" />
                        IV — Recebimentos
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="h-3 w-1.5 shrink-0 rounded-sm bg-muted-foreground" />
                        Plataforma
                    </li>
                </ul>
                <p className="pt-1 text-[11px] italic">
                    O triângulo de alerta numa caixa indica risco registrado; vermelho, risco crítico.
                </p>
            </div>
        </div>
    )
}
