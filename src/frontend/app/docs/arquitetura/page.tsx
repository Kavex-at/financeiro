import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui/page-header'
import { ArquiteturaFlow } from './ArquiteturaFlow'

export const metadata: Metadata = {
    title: 'Arquitetura · Financeiro',
    description:
        'Mapa da automação financeira da Columbia Trading — as três frentes, as camadas técnicas e o estado-alvo.',
    // Rota pública: não deve ser indexada por buscadores.
    robots: { index: false, follow: false },
}

/**
 * `/docs/arquitetura` — mapa navegável da plataforma.
 *
 * Rota pública (registrada em `PUBLIC_ROUTES` do `RouteGate`): o conteúdo é
 * servido a visitantes não autenticados.
 */
export default function ArquiteturaPage() {
    return (
        <div className="space-y-6">
            <PageHeader
                title="Arquitetura"
                subtitle="Automação financeira da Columbia Trading — as três frentes, as camadas que as sustentam e o caminho até o estado-alvo."
            />

            <section className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                    A plataforma automatiza três frentes do financeiro, todas girando em torno do ERP
                    Conexos: <strong className="text-foreground">Permutas</strong>, que reconcilia
                    adiantamentos contra invoices e grava a baixa;{' '}
                    <strong className="text-foreground">SISPAG</strong>, que monta os lotes de pagamento
                    e gera a remessa bancária; e{' '}
                    <strong className="text-foreground">Conciliação de Recebimentos</strong>, que casa os
                    créditos do extrato com os processos, baixa o recebimento e emite a Nota de Débito
                    Eletrônica.
                </p>
                <p>
                    As três escrevem no ERP em produção, sempre com um registro gravado antes da chamada
                    e com uma pessoa decidindo o passo que move dinheiro. O que falta está marcado com
                    contorno tracejado: o transporte da remessa até o banco, que ainda é manual; o
                    casamento automático dos recebimentos; e o alerta que saia da própria plataforma.
                </p>
            </section>

            <ArquiteturaFlow />
        </div>
    )
}
