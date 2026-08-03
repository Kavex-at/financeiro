'use client'

import * as React from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { fetchFiliais } from '@/lib/api'
import type { Filial } from '@/lib/types'
import { formatBRL } from '@/lib/utils'
import {
  importExtrato,
  previewImportExtrato,
  type ImportExtratoPreview,
} from '@/lib/recebimentos'

interface ImportarExtratoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Chamado após uma importação bem-sucedida — a página recarrega o painel. */
  onImported: () => void
}

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' })

const msgErro = (e: unknown) => (e instanceof Error ? e.message : 'Falha inesperada.')

/**
 * ImportarExtratoDialog — canal MANUAL do Módulo 1: sobe um extrato `.xlsx` (Bradesco) e importa os
 * créditos para a MESMA carteira do canal automático (fin095). O parsing é no SERVIDOR (segue a doutrina
 * de raw-payload + dedup; difere do spec `design-system/excel-import-dialog.md`, que parseia no cliente).
 *
 * Fluxo confirm-before-commit: escolher filial → selecionar arquivo → PREVIEW (dry-run, sem escrita) →
 * Confirmar → importação. A filial é obrigatória porque o extrato só traz agência/conta, não o `filCod`.
 */
export function ImportarExtratoDialog({ open, onOpenChange, onImported }: ImportarExtratoDialogProps) {
  const [filiais, setFiliais] = React.useState<Filial[]>([])
  const [filCod, setFilCod] = React.useState<number | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<ImportExtratoPreview | null>(null)
  const [validando, setValidando] = React.useState(false)
  const [importando, setImportando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  /**
   * `linhaIndice` dos créditos DESMARCADOS na amostra — default vazio (tudo selecionado, mesmo
   * comportamento de antes). Linhas fora da amostra exibida nunca entram aqui, então permanecem
   * incluídas na importação (não há como desmarcar o que não se vê).
   */
  const [excluidos, setExcluidos] = React.useState<Set<number>>(new Set())
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Carrega filiais ao abrir; zera o estado ao fechar (o dialog é reusável).
  React.useEffect(() => {
    if (!open) {
      setFilCod(null)
      setFile(null)
      setPreview(null)
      setErro(null)
      setValidando(false)
      setImportando(false)
      setExcluidos(new Set())
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    let vivo = true
    fetchFiliais()
      .then((r) => {
        if (vivo) setFiliais(r.filiais)
      })
      .catch(() => {
        if (vivo) setErro('Não foi possível carregar as filiais.')
      })
    return () => {
      vivo = false
    }
  }, [open])

  const rodarPreview = React.useCallback(async (f: File, fc: number) => {
    setValidando(true)
    setErro(null)
    setPreview(null)
    setExcluidos(new Set())
    try {
      setPreview(await previewImportExtrato(f, fc))
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setValidando(false)
    }
  }, [])

  const aoEscolherArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
    setErro(null)
    setExcluidos(new Set())
    if (f && filCod !== null) void rodarPreview(f, filCod)
  }

  const aoEscolherFilial = (v: string | null) => {
    const fc = v === null ? null : Number(v)
    setFilCod(fc)
    setPreview(null)
    setErro(null)
    setExcluidos(new Set())
    if (file && fc !== null) void rodarPreview(file, fc)
  }

  const alternarLinha = (linhaIndice: number) => {
    setExcluidos((prev) => {
      const next = new Set(prev)
      if (next.has(linhaIndice)) next.delete(linhaIndice)
      else next.add(linhaIndice)
      return next
    })
  }

  const alternarTodas = (marcar: boolean) => {
    if (!preview) return
    setExcluidos(marcar ? new Set() : new Set(preview.amostra.map((l) => l.linhaIndice)))
  }

  const confirmar = async () => {
    if (!file || filCod === null) return
    setImportando(true)
    setErro(null)
    try {
      const r = await importExtrato(file, filCod, Array.from(excluidos))
      toast.success(
        r.reaproveitada
          ? 'Esta seleção já havia sido importada — nada foi duplicado.'
          : `${r.inseridas} novo(s) crédito(s) importado(s), ${r.deduplicadas} já conhecido(s).`,
      )
      onImported()
      onOpenChange(false)
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setImportando(false)
    }
  }

  const opcoesFilial = filiais.map((f) => ({
    value: String(f.filCod),
    label: `${f.filCod} · ${f.filDesNome}`,
    ...(f.ufEspSigla ? { hint: f.ufEspSigla } : {}),
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Importar extrato (.xlsx)</DialogTitle>
          <DialogDescription>
            Canal manual, alternativo à ingestão automática. Suba o extrato do banco (Bradesco); só os
            créditos são importados.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-sm font-medium">Filial</span>
              <Combobox
                id="filial-import-extrato"
                aria-label="Filial do extrato"
                options={opcoesFilial}
                value={filCod === null ? null : String(filCod)}
                onChange={aoEscolherFilial}
                placeholder="Escolha a filial…"
              />
            </div>
            <div className="space-y-1">
              <span className="text-sm font-medium">Arquivo</span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                onChange={aoEscolherArquivo}
                disabled={filCod === null}
                aria-label="Arquivo .xlsx do extrato"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent disabled:opacity-50"
              />
              {filCod === null ? (
                <p className="text-xs text-muted-foreground">Escolha a filial antes do arquivo.</p>
              ) : null}
            </div>
          </div>

          {validando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Validando arquivo…
            </div>
          ) : null}

          {erro ? (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div>{erro}</div>
            </div>
          ) : null}

          {preview && !validando ? (
            <PreviewResumo
              preview={preview}
              excluidos={excluidos}
              onToggleLinha={alternarLinha}
              onToggleTodas={alternarTodas}
            />
          ) : !validando && !erro && !file ? (
            <EmptyState
              icon={<FileSpreadsheet className="size-6" aria-hidden />}
              title="Nenhum arquivo selecionado"
              description="Escolha a filial e selecione um .xlsx para ver a prévia dos créditos."
            />
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importando}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmar()} disabled={!preview || validando || importando}>
              {importando ? <Spinner className="size-4" /> : <Upload className="size-4" aria-hidden />}
              Confirmar importação
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

interface PreviewResumoProps {
  preview: ImportExtratoPreview
  /** `linhaIndice` desmarcados. */
  excluidos: Set<number>
  onToggleLinha: (linhaIndice: number) => void
  onToggleTodas: (marcar: boolean) => void
}

/** Cabeçalho + contagens + amostra selecionável (verde = novo, esmaecido = já importado). */
function PreviewResumo({ preview, excluidos, onToggleLinha, onToggleTodas }: PreviewResumoProps) {
  const { cabecalho, amostra } = preview
  const restante = preview.totalCreditos - amostra.length
  const selecionados = amostra.length - excluidos.size
  const todasSelecionadas = excluidos.size === 0
  const nenhumaSelecionada = selecionados === 0
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        <span className="font-medium">{preview.totalCreditos} crédito(s)</span>
        <Badge variant="outline">{preview.novos} novo(s)</Badge>
        <Badge variant="outline">{preview.jaImportados} já importado(s)</Badge>
        <span className="text-muted-foreground">· {preview.totalIgnorados} débito(s) ignorado(s)</span>
        {excluidos.size > 0 ? (
          <Badge variant="outline">{selecionados} selecionado(s) de {amostra.length}</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {cabecalho.banco.toUpperCase()}
        {cabecalho.agencia ? ` · ag. ${cabecalho.agencia}` : ''}
        {cabecalho.conta ? ` · conta ${cabecalho.conta}` : ''}
        {cabecalho.periodoDe ? ` · período ${fmtData(cabecalho.periodoDe)}` : ''}
        {cabecalho.periodoAte ? ` a ${fmtData(cabecalho.periodoAte)}` : ''}
      </p>

      {preview.jaImportadoArquivo ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            Este arquivo já foi importado antes. Confirmar de novo é seguro — nada será duplicado.
          </div>
        </div>
      ) : null}

      <div className="max-h-72 overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={todasSelecionadas ? true : nenhumaSelecionada ? false : 'indeterminate'}
                  onCheckedChange={(v) => onToggleTodas(v === true)}
                  aria-label="Selecionar todos os créditos"
                />
              </TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Lançamento</TableHead>
              <TableHead>Contraparte</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {amostra.map((l) => {
              const selecionada = !excluidos.has(l.linhaIndice)
              return (
                <TableRow key={l.linhaIndice} className={l.novo ? '' : 'opacity-60'}>
                  <TableCell>
                    <Checkbox
                      checked={selecionada}
                      onCheckedChange={() => onToggleLinha(l.linhaIndice)}
                      aria-label={`Selecionar crédito ${l.descricao}`}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtData(l.data)}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">{l.descricao}</TableCell>
                  <TableCell className="max-w-[14rem] truncate">{l.contraparteNome ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(l.valor)}</TableCell>
                  <TableCell>
                    {l.novo ? (
                      <Badge variant="outline">novo</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">já importado</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {restante > 0 ? (
        <p className="text-xs text-muted-foreground">… e mais {restante} crédito(s) não exibido(s).</p>
      ) : null}
    </div>
  )
}
