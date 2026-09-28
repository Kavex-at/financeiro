import { Info } from 'lucide-react'

/**
 * Aviso da transição do acesso para o e-mail da Columbia (ADR-0051).
 *
 * Apresentacional: quem decide se aparece é a página (`LoginForm`), que lê a chave manual do
 * backend (`AUTH_TRANSICAO_EMAIL_BANNER`, via `GET /auth/transicao`) — mesmo desenho do
 * `ReadonlyModeBanner` (patterns.md §19). Com `ativo = false` (pendente, falha ou chave desligada)
 * não renderiza nada nem reserva espaço. `role="status"`: é informação, não erro.
 */
export function TransicaoEmailBanner({ ativo }: { ativo: boolean }) {
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
