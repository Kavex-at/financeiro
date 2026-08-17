import { render, screen } from '@testing-library/react'
import { NdeTable } from '@/app/recebimentos/components/NdeTable'
import type { NotaDebitoEletronica } from '@/lib/recebimentos'

const nde = (o: Partial<NotaDebitoEletronica> = {}): NotaDebitoEletronica => ({
  id: 'nde-1',
  origem: 'ferramenta',
  recebimentoId: 'txn-1',
  filCod: 4,
  correlationId: 'corr-1',
  valor: 15000,
  moeda: 'BRL',
  statusEmissao: 'emitida',
  idempotencyKey: 'nde:txn-1:1',
  ...o,
})

describe('NdeTable', () => {
  it('vazio continua vazio — nada de inventar linha', () => {
    render(<NdeTable ndes={[]} />)
    expect(screen.getByText('Nenhuma NDe')).toBeInTheDocument()
  })

  it('emitida e autorizada mostra número, docCod e o chip do SEFAZ', () => {
    render(
      <NdeTable ndes={[nde({ numeroNde: '000123', ndDocCod: 18337, ndeAutorizado: true })]} />,
    )
    expect(screen.getByText('000123')).toBeInTheDocument()
    expect(screen.getByText('doc 18337')).toBeInTheDocument()
    expect(screen.getByText('autorizada')).toBeInTheDocument()
  })

  it('emitida sem autorização não vira falha — é "aguardando SEFAZ"', () => {
    // A autorização é assíncrona; pintar isso como erro faria o analista reprocessar à toa.
    render(<NdeTable ndes={[nde({ ndDocCod: 18402, ndeAutorizado: false })]} />)
    expect(screen.getByText('emitida')).toBeInTheDocument()
    expect(screen.getByText('aguardando SEFAZ')).toBeInTheDocument()
  })

  it('NDe que não saiu mostra ONDE parou — é o que o analista precisa para retomar', () => {
    render(
      <NdeTable
        ndes={[nde({ id: 'exec:k1', statusEmissao: 'pendente', ndDocCod: 18410, etapa: 'fiscal-done' })]}
      />,
    )
    expect(screen.getByText('pendente')).toBeInTheDocument()
    expect(screen.getByText('parou em: tipo de nota setado')).toBeInTheDocument()
  })

  it('autorizada no ERP sem NDe local ainda mostra a autorização — a tela não nega o fato fiscal', () => {
    // Descasamento real: a execução morreu entre homologar e gravar a nossa linha de NDe.
    render(
      <NdeTable
        ndes={[nde({ id: 'exec:k1', statusEmissao: 'pendente', ndDocCod: 18410, ndeAutorizado: true })]}
      />,
    )
    expect(screen.getByText('pendente')).toBeInTheDocument()
    expect(screen.getByText('autorizada')).toBeInTheDocument()
  })

  it('a mensagem de erro do ERP vem com ícone, nunca só com a cor vermelha', () => {
    // DS princípio 8 / WCAG 2.1 AA: quem não distingue a cor precisa do ícone + texto.
    const { container } = render(
      <NdeTable
        ndes={[
          nde({ statusEmissao: 'erro', ndDocCod: 18411, erroMensagem: 'homologação recusada' }),
        ]}
      />,
    )
    const linha = screen.getByText('homologação recusada').closest('div')
    expect(linha?.querySelector('svg')).toBeInTheDocument()
    expect(container).toHaveTextContent('homologação recusada')
  })

  it('NDe emitida fora da ferramenta é marcada, e mostra cliente e processo', () => {
    // Sem a marca, as colunas vazias pareceriam rastro perdido de algo que a ferramenta emitiu.
    render(
      <NdeTable
        ndes={[
          nde({
            id: 'erp:4:18790',
            origem: 'erp',
            numeroNde: '180792',
            ndDocCod: 18790,
            ndeAutorizado: true,
            cliente: 'DYNAMIS IMPORTADORA E DISTRIBUIDORA LTDA',
            processoRef: '0017DYS/26',
          }),
        ]}
      />,
    )
    expect(screen.getByText('fora da ferramenta')).toBeInTheDocument()
    expect(screen.getByText('DYNAMIS IMPORTADORA E DISTRIBUIDORA LTDA')).toBeInTheDocument()
    expect(screen.getByText('0017DYS/26')).toBeInTheDocument()
    expect(screen.getByText('autorizada')).toBeInTheDocument()
  })

  it('linha da ferramenta NÃO recebe a marca de origem externa', () => {
    render(<NdeTable ndes={[nde({ ndDocCod: 18337, ndeAutorizado: true })]} />)
    expect(screen.queryByText('fora da ferramenta')).not.toBeInTheDocument()
  })

  it('homologada com validações pendentes é sinalizada para revisão', () => {
    render(<NdeTable ndes={[nde({ ndDocCod: 18402, revisaoHumana: true })]} />)
    expect(screen.getByText('revisão')).toBeInTheDocument()
  })
})
