'use client'

import { Eye } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { type DestinoRevelado, revelarDestino } from '@/lib/sispag'

/** Quanto tempo o destino completo fica na tela (ms). */
export const TEMPO_REVELADO_MS = 30_000

const formatar = (r: DestinoRevelado): string => {
  const d = r.destino
  if (d.tipo === 'TED') {
    const ag = d.agencia ? ` · ag. ${d.agencia}${d.agenciaDv ? `-${d.agenciaDv}` : ''}` : ''
    return `banco ${d.banco}${ag} · cc ${d.conta}${d.contaDv ? `-${d.contaDv}` : ''}`
  }
  return `PIX ${d.chaveTipo ?? 'chave'} ${d.chave}`
}

/**
 * "Revelar" o destino completo (I14l): busca SOB DEMANDA, ao vivo no Conexos e auditado no
 * backend; mostra por {@link TEMPO_REVELADO_MS} e esquece. Fica só no estado local deste botão:
 * nada em cache, contexto global ou `localStorage`.
 */
export function RevelarDestinoButton({ autorizacaoId, rotulo }: { autorizacaoId: string; rotulo: string }) {
  const [texto, setTexto] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!texto) return
    const t = setTimeout(() => setTexto(null), TEMPO_REVELADO_MS)
    return () => clearTimeout(t)
  }, [texto])

  async function revelar() {
    setCarregando(true)
    setErro(null)
    try {
      setTexto(formatar(await revelarDestino(autorizacaoId)))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível revelar o destino.')
    } finally {
      setCarregando(false)
    }
  }

  if (texto) {
    return (
      <span className="block text-xs">
        <span className="font-mono tabular-nums" aria-live="polite">
          {texto}
        </span>
        <span className="block text-muted-foreground">Some em 30 segundos. Leitura registrada.</span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-start">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void revelar()}
        disabled={carregando}
        aria-label={`Revelar destino completo de ${rotulo}`}
      >
        {carregando ? <Spinner aria-hidden /> : <Eye className="size-4" aria-hidden />}
        Revelar
      </Button>
      {erro ? (
        <span role="alert" className="text-xs text-danger-foreground">
          {erro}
        </span>
      ) : null}
    </span>
  )
}
