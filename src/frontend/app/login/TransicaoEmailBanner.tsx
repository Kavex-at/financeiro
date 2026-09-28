'use client'

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { fetchTransicaoEmail } from '@/lib/auth/transicao'

/**
 * Aviso da transição do acesso para o e-mail da Columbia (ADR-0051).
 *
 * Ligado pela chave manual do backend (`AUTH_TRANSICAO_EMAIL_BANNER`), lida em `GET
 * /auth/transicao`. Só aparece quando a resposta é `true`: enquanto a chamada está pendente, se ela
 * falha ou se a chave está desligada, não renderiza nada nem reserva espaço — o formulário abaixo
 * fica utilizável desde o primeiro render. `role="status"`: é informação, não erro.
 */
export function TransicaoEmailBanner() {
  const [ativo, setAtivo] = useState(false)

  useEffect(() => {
    let cancelado = false
    fetchTransicaoEmail()
      .then((valor) => {
        if (!cancelado) setAtivo(valor)
      })
      .catch(() => undefined)
    return () => {
      cancelado = true
    }
  }, [])

  if (!ativo) return null

  return (
    <div
      role="status"
      className="mb-6 flex gap-3 rounded-lg border border-info/30 bg-info-subtle px-4 py-3 text-sm text-info-foreground"
      data-testid="login-transicao-banner"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">Estamos migrando o acesso para o seu e-mail da Columbia.</p>
        <p>
          Durante a transição, você continua entrando com seu usuário atual. Quando seu e-mail da
          Columbia for cadastrado, ele também passa a valer, com a mesma senha.
        </p>
      </div>
    </div>
  )
}
