/**
 * O sinal `fonte` sempre existiu no tipo (`lib/types.ts`) e o fixture sempre se
 * identificou corretamente — mas NENHUMA tela lia o campo. Estes testes fixam
 * que ele agora chega aos olhos de quem usa o painel, e que a falha de carga
 * tem retry em vez de virar dado falso silencioso.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { DemoDataBanner, LoadErrorBanner } from './banners'

describe('DemoDataBanner', () => {
  it('grita quando a fonte é o fixture', () => {
    render(<DemoDataBanner fonte="fixture" />)

    expect(screen.getByRole('alert')).toHaveTextContent(/dados de demonstração/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/não a carteira do banco/i)
  })

  it('não aparece quando a fonte é o banco', () => {
    render(<DemoDataBanner fonte="banco" />)

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('LoadErrorBanner', () => {
  it('não aparece sem erro', () => {
    render(<LoadErrorBanner message={null} onRetry={() => {}} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('mostra a mensagem e chama o retry', () => {
    const onRetry = jest.fn()
    render(<LoadErrorBanner message="API 500" onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('API 500')
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('com dados antigos na tela, diz que eles podem estar desatualizados', () => {
    render(<LoadErrorBanner message="API 500" onRetry={() => {}} stale />)

    expect(screen.getByRole('alert')).toHaveTextContent(/podem estar desatualizados/i)
  })

  it('sem dados antigos, diz apenas que não carregou', () => {
    render(<LoadErrorBanner message="API 500" onRetry={() => {}} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar/i)
  })

  it('desabilita o retry enquanto recarrega', () => {
    render(<LoadErrorBanner message="API 500" onRetry={() => {}} retrying />)

    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeDisabled()
  })
})
