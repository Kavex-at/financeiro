'use client'

import Link from 'next/link'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ACAO_PAGAMENTO,
  ACAO_PENDENCIA_LOTE,
  type AcaoPagamento,
  EFEITO_PENDENCIA,
  ESTADO_PRONTIDAO,
  type ItemLote,
  type LotePagamento,
  PENDENCIA_LOTE,
  type PendenciaLote,
  type TituloAPagar,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { AcaoDoTitulo, OrientacaoNoConexos } from '../situacao/AcaoDoTitulo'
import { ROTULO_DONO } from '../situacao/rotulos'
import { ROTULO_EFEITO } from './prontidaoLotes'

/** Quantas pendências o card mostra antes do "Mostrar as outras". */
const VISIVEIS = 4

const NOME_FONTE: Readonly<Record<string, string>> = {
  DUPLICIDADE: 'duplicidade',
  AJUSTE_CENTAVOS: 'ajuste de centavos',
  BOLETO: 'sugestão de boleto',
}

const CLASSE_EFEITO: Readonly<Record<PendenciaLote['efeito'], string>> = {
  [EFEITO_PENDENCIA.BARRA]: 'border-danger bg-danger-subtle text-danger-foreground',
  [EFEITO_PENDENCIA.SAI]: 'border-warning/40 bg-warning-subtle text-warning-foreground',
}

const ehAcaoPagamento = (codigo: string): codigo is AcaoPagamento =>
  (Object.values(ACAO_PAGAMENTO) as string[]).includes(codigo)

/** O título da linha do lote, no formato que `AcaoDoTitulo` entende (só o que ele lê). */
const tituloDoItem = (item: ItemLote, p: PendenciaLote): TituloAPagar => ({
  filCod: item.filCod,
  docCod: item.docCod,
  titCod: item.titCod,
  valor: item.valor ?? 0,
  liberado: true,
  pago: false,
  ...(item.credor ? { credor: item.credor } : {}),
  ...(item.vencimento !== undefined ? { vencimento: item.vencimento } : {}),
  situacaoPagamento: {
    estado: 'BLOQUEADO',
    motivos: p.motivo ? [p.motivo] : [],
    ...(p.motivo ? { principal: p.motivo } : {}),
    ...(p.acao && ehAcaoPagamento(p.acao.codigo)
      ? { acao: { codigo: p.acao.codigo, rotulo: p.acao.rotulo } }
      : {}),
  },
})

export interface AcoesDaPendencia {
  podeExecutar: boolean
  /** Abre o diálogo de alerta de duplicidade do item (o mesmo da tabela de itens). */
  onTratarAlerta: (item: ItemLote) => void
  /** Abre os boletos DDA/sugestão do título. Ausente = sem o botão "Ver boleto". */
  onVerBoleto?: (t: TituloAPagar) => void
  /** Depois de uma ação que muda o servidor. */
  onResolvido: () => void | Promise<void>
}

/** O botão da pendência. Cada código leva a um fluxo que já existe, nunca a um botão morto. */
function AcaoDaPendencia({
  pendencia: p,
  item,
  acoes,
}: {
  pendencia: PendenciaLote
  item?: ItemLote
  acoes: AcoesDaPendencia
}) {
  if (!item) return null
  if (p.codigo === PENDENCIA_LOTE.DUPLICIDADE_ABERTA) {
    if (!acoes.podeExecutar) return null
    return (
      <Button size="sm" variant="outline" onClick={() => acoes.onTratarAlerta(item)}>
        {p.acao?.rotulo ?? 'Tratar alerta'}
      </Button>
    )
  }
  if (!p.acao) return null
  if (p.acao.codigo === ACAO_PENDENCIA_LOTE.PEDIR_AUTORIZACAO) {
    const modalidade = item.modalidade === 'PIX' ? 'PIX' : 'TED'
    const href = `/sispag/favorecidos-autorizados?${new URLSearchParams({
      pedir: '1',
      modalidade,
      filCod: String(item.filCod),
      ...(item.credor ? { credor: item.credor } : {}),
    }).toString()}`
    return (
      <Button size="sm" variant="outline" asChild>
        <Link href={href}>{p.acao.rotulo}</Link>
      </Button>
    )
  }
  if (p.acao.codigo === ACAO_PENDENCIA_LOTE.ABRIR_CADASTRO_NO_CONEXOS) {
    return (
      <OrientacaoNoConexos
        rotulo={p.acao.rotulo}
        titulo="Cadastrar conta ou chave PIX no Conexos"
        passos="O favorecido não tem conta bancária nem chave PIX no cadastro de pessoas do Conexos. Cadastre e finalize de novo: a finalização relê o cadastro e, sem destino, retira o item do lote."
        filCod={item.filCod}
        documento={`${item.docCod}/${item.titCod}`}
      />
    )
  }
  if (p.codigo === PENDENCIA_LOTE.SITUACAO_BLOQUEADA && ehAcaoPagamento(p.acao.codigo)) {
    if (p.acao.codigo === ACAO_PAGAMENTO.VER_BOLETO && !acoes.onVerBoleto) return null
    return (
      <AcaoDoTitulo
        titulo={tituloDoItem(item, p)}
        podeExecutar={acoes.podeExecutar}
        onVerBoleto={acoes.onVerBoleto ?? (() => undefined)}
        onResolvido={acoes.onResolvido}
      />
    )
  }
  return null
}

/**
 * O que falta para o lote finalizar (ADR-0076, I20f): o resumo e uma linha por pendência, com o
 * efeito, o item, o motivo, quem resolve e o botão. As que barram vêm antes das que saem.
 */
export function PendenciasDoLote({ lote, acoes }: { lote: LotePagamento; acoes: AcoesDaPendencia }) {
  const [todas, setTodas] = React.useState(false)
  const p = lote.prontidao
  if (!p) return null
  const n = lote.itens.length
  const naoFinaliza = p.pendencias.some((x) => x.efeito === EFEITO_PENDENCIA.BARRA)
  const itemDa = (x: PendenciaLote) =>
    x.chave
      ? lote.itens.find(
          (i) => i.filCod === x.chave?.filCod && i.docCod === x.chave.docCod && i.titCod === x.chave.titCod,
        )
      : undefined
  const visiveis = todas ? p.pendencias : p.pendencias.slice(0, VISIVEIS)
  const restantes = p.pendencias.length - visiveis.length

  return (
    <section aria-label="Pendências do lote" className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium">
          {p.estado === ESTADO_PRONTIDAO.PRONTO
            ? `Todos os ${n} itens prontos`
            : `${p.itensQueVao} de ${n} itens vão ao finalizar`}
        </p>
        <p className="text-xs text-muted-foreground">
          {naoFinaliza
            ? 'Resolva o que barra a finalização para poder finalizar.'
            : p.saem > 0
              ? 'Os itens que saem voltam para Títulos a pagar; os outros finalizam normalmente.'
              : 'Sem pendências.'}
        </p>
        {p.fontesIndisponiveis.length > 0 ? (
          <p className="text-xs text-warning-foreground">
            Situação incompleta: sem a consulta de{' '}
            {p.fontesIndisponiveis.map((f) => NOME_FONTE[f] ?? f).join(', ')}. Atualize em instantes.
          </p>
        ) : null}
      </div>
      {visiveis.length > 0 ? (
        <ul className="divide-y rounded-md border bg-card">
          {visiveis.map((x, i) => {
            const item = itemDa(x)
            return (
              <li
                key={`${x.codigo}-${x.chave?.docCod ?? 'lote'}-${x.chave?.titCod ?? i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <Badge variant="outline" className={CLASSE_EFEITO[x.efeito]}>
                  {ROTULO_EFEITO[x.efeito]}
                </Badge>
                <div className="min-w-48 flex-1">
                  <p>
                    {item ? (
                      <>
                        <span className="font-medium">{item.credor ?? '—'}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {item.docCod}/{item.titCod}
                          {item.modalidade ? ` · ${item.modalidade}` : ''}
                          {item.valor !== undefined ? ` · ${formatBRL(item.valor)}` : ''}
                        </span>
                      </>
                    ) : (
                      <span className="font-medium">Lote</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {x.rotulo}
                    {x.detalhe ? `: ${x.detalhe}` : ''}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">resolve: {ROTULO_DONO[x.dono]}</span>
                <AcaoDaPendencia pendencia={x} {...(item ? { item } : {})} acoes={acoes} />
              </li>
            )
          })}
        </ul>
      ) : null}
      {restantes > 0 ? (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setTodas(true)}>
          {restantes === 1 ? 'Mostrar a outra pendência' : `Mostrar as outras ${restantes} pendências`}
        </Button>
      ) : null}
    </section>
  )
}
