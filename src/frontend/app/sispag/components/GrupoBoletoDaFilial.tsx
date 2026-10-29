'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ChaveTituloGrupo } from '@/lib/sispag'
import { grupoDoBoleto, grupoDoTitulo } from './grupoBoleto'
import { GrupoBoletoBloco } from './GrupoBoletoBloco'
import { useGruposDaFilial } from './useGruposDaFilial'

export type OndeProcurar =
  | { tipo: 'titulo'; chave: ChaveTituloGrupo }
  | { tipo: 'boleto'; ddcCod: number; ditCod: number }

/**
 * Carrega os grupos da filial e mostra o bloco do grupo do título (gaveta) ou do boleto (linha da
 * aba Boletos DDA). Depois de confirmar ou anular, recarrega e avisa a tela (`onAlterado`) para ela
 * reler carteira, lotes e a lista de boletos. O bloco permanece aberto no estado novo.
 */
export function GrupoBoletoDaFilial({
  filCod,
  onde,
  tituloAtual,
  podeExecutar,
  onAlterado,
}: {
  filCod: number | undefined
  onde: OndeProcurar
  tituloAtual?: ChaveTituloGrupo | undefined
  podeExecutar: boolean
  onAlterado?: (() => void | Promise<void>) | undefined
}) {
  const { dados, erro, carregando, recarregar } = useGruposDaFilial(filCod)
  const [aviso, setAviso] = React.useState<string | null>(null)

  const encontrado = dados
    ? onde.tipo === 'titulo'
      ? grupoDoTitulo(dados, onde.chave)
      : grupoDoBoleto(dados, onde.ddcCod, onde.ditCod)
    : undefined
  const chaveBloco =
    onde.tipo === 'titulo'
      ? `${onde.chave.filCod}:${onde.chave.docCod}:${onde.chave.titCod}`
      : `${onde.ddcCod}:${onde.ditCod}`

  return (
    <div className="flex flex-col gap-2">
      <div role="status" className="text-sm text-success-foreground">
        {aviso}
      </div>
      {erro ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-danger-foreground">
          <span>{erro}</span>
          <Button size="sm" variant="outline" onClick={() => void recarregar()}>
            Tentar de novo
          </Button>
        </div>
      ) : carregando && !dados ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Carregando o grupo…
        </div>
      ) : encontrado ? (
        <GrupoBoletoBloco
          key={chaveBloco}
          encontrado={encontrado}
          tituloAtual={tituloAtual}
          podeExecutar={podeExecutar}
          onAlterado={async (mensagem) => {
            setAviso(mensagem)
            await recarregar()
            await onAlterado?.()
          }}
        />
      ) : null}
    </div>
  )
}
