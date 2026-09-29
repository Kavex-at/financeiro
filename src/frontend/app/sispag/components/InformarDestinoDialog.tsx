'use client'

import { Landmark } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type ChavePixTipo,
  definirDestinoItem,
  type DestinoManualEntrada,
  type ItemLote,
  type LotePagamento,
  TIPOS_CHAVE_PIX_DIGITAVEIS,
  validarDestinoManual,
} from '@/lib/sispag'

type Aba = 'CONTA' | 'CHAVE_PIX'

/** Um campo de texto com label, erro inline e `aria-describedby` (docs/design-system/forms.md). */
function Campo({
  id,
  label,
  valor,
  onChange,
  erro,
  className,
  inputMode = 'numeric',
  descricao,
}: {
  id: string
  label: string
  valor: string
  onChange: (v: string) => void
  erro?: string
  className?: string
  inputMode?: 'numeric' | 'text' | 'email' | 'tel'
  descricao?: string
}) {
  const erroId = `${id}-erro`
  const descId = `${id}-desc`
  const describedBy = [erro ? erroId : null, descricao && !erro ? descId : null]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={valor}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="aria-invalid:border-destructive"
      />
      {erro ? (
        <p id={erroId} role="alert" className="text-xs text-destructive">
          {erro}
        </p>
      ) : descricao ? (
        <p id={descId} className="text-xs text-muted-foreground">
          {descricao}
        </p>
      ) : null}
    </div>
  )
}

/**
 * "Informar destino" (ADR-0054) — a analista digita o destino de TED (conta) ou PIX (chave) SÓ
 * para este item do lote. Vence o cadastro do Conexos e não é escrito nele.
 *
 * O formato é conferido aqui, espelhando o backend. A titularidade (o CPF/CNPJ tem de ser o do
 * favorecido), o estado do lote e o congelamento depois do envio são do backend: a mensagem dele
 * fica INLINE, com o diálogo aberto para corrigir. O valor digitado não é logado em lugar nenhum.
 */
export function InformarDestinoDialog({
  lote,
  item,
  tedEnabled,
  pixEnabled,
  onOpenChange,
  onSalvo,
}: {
  lote: LotePagamento
  item: ItemLote
  tedEnabled: boolean
  pixEnabled: boolean
  onOpenChange: (open: boolean) => void
  onSalvo: (lote: LotePagamento) => void
}) {
  const inicial: Aba =
    item.modalidade === 'PIX' && pixEnabled ? 'CHAVE_PIX' : tedEnabled ? 'CONTA' : 'CHAVE_PIX'
  const [aba, setAba] = React.useState<Aba>(inicial)
  const [conta, setConta] = React.useState({
    bancoCod: '',
    agencia: '',
    agenciaDv: '',
    conta: '',
    contaDv: '',
  })
  const [chavePixTipo, setChavePixTipo] = React.useState<ChavePixTipo>('CPF_CNPJ')
  const [chavePix, setChavePix] = React.useState('')
  const [titular, setTitular] = React.useState('')
  const [erros, setErros] = React.useState<Partial<Record<string, string>>>({})
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const campoConta = (k: keyof typeof conta) => (v: string) => {
    setConta((c) => ({ ...c, [k]: v }))
    setErros((e) => ({ ...e, [k]: undefined }))
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    const entrada: DestinoManualEntrada =
      aba === 'CONTA'
        ? { tipo: 'CONTA', ...conta, titularDocumento: titular }
        : { tipo: 'CHAVE_PIX', chavePixTipo, chavePix, titularDocumento: titular }
    const { destino, erros: encontrados } = validarDestinoManual(entrada)
    setErros(encontrados)
    setErroServidor(null)
    if (!destino) return
    setSalvando(true)
    try {
      const atualizado = await definirDestinoItem(lote.id, {
        filCod: item.filCod,
        docCod: item.docCod,
        titCod: item.titCod,
        versao: lote.versao,
        destino,
      })
      onSalvo(atualizado)
    } catch (err) {
      setErroServidor(err instanceof Error ? err.message : 'Não foi possível salvar o destino.')
    } finally {
      setSalvando(false)
    }
  }

  const prefixo = `destino-${item.docCod}-${item.titCod}`

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={salvar} noValidate>
          <DialogHeader>
            <DialogTitle>Informar destino</DialogTitle>
            <DialogDescription>
              Título {item.docCod}/{item.titCod}
              {item.credor ? ` · ${item.credor}` : ''}. Vale só para este item e substitui o
              destino do cadastro do Conexos, que não é alterado. O titular tem de ser o próprio
              favorecido.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
              <TabsList aria-label="Tipo de destino">
                {tedEnabled ? <TabsTrigger value="CONTA">TED</TabsTrigger> : null}
                {pixEnabled ? <TabsTrigger value="CHAVE_PIX">PIX</TabsTrigger> : null}
              </TabsList>
              {tedEnabled ? (
                <TabsContent value="CONTA" className="grid grid-cols-6 gap-3 pt-2">
                  <Campo
                    id={`${prefixo}-banco`}
                    label="Banco (FEBRABAN)"
                    valor={conta.bancoCod}
                    onChange={campoConta('bancoCod')}
                    erro={erros.bancoCod}
                    className="col-span-2"
                    descricao="3 dígitos. Ex.: 237"
                  />
                  <Campo
                    id={`${prefixo}-agencia`}
                    label="Agência"
                    valor={conta.agencia}
                    onChange={campoConta('agencia')}
                    erro={erros.agencia}
                    className="col-span-3"
                  />
                  <Campo
                    id={`${prefixo}-agencia-dv`}
                    label="DV da agência"
                    valor={conta.agenciaDv}
                    onChange={campoConta('agenciaDv')}
                    erro={erros.agenciaDv}
                    className="col-span-1"
                  />
                  <Campo
                    id={`${prefixo}-conta`}
                    label="Conta"
                    valor={conta.conta}
                    onChange={campoConta('conta')}
                    erro={erros.conta}
                    className="col-span-4"
                  />
                  <Campo
                    id={`${prefixo}-conta-dv`}
                    label="DV da conta"
                    valor={conta.contaDv}
                    onChange={campoConta('contaDv')}
                    erro={erros.contaDv}
                    className="col-span-2"
                  />
                </TabsContent>
              ) : null}
              {pixEnabled ? (
                <TabsContent value="CHAVE_PIX" className="space-y-3 pt-2">
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium">Tipo da chave</legend>
                    <div className="flex flex-wrap gap-4">
                      {TIPOS_CHAVE_PIX_DIGITAVEIS.map((t) => (
                        <label key={t.value} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={`${prefixo}-tipo-chave`}
                            className="accent-primary"
                            checked={chavePixTipo === t.value}
                            onChange={() => {
                              setChavePixTipo(t.value)
                              setErros((e) => ({ ...e, chavePix: undefined }))
                            }}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Por enquanto só chave CPF/CNPJ, a única em que conseguimos conferir o
                      titular. Outros tipos: cadastre a chave no Conexos.
                    </p>
                  </fieldset>
                  <Campo
                    id={`${prefixo}-chave`}
                    label="Chave PIX"
                    valor={chavePix}
                    onChange={(v) => {
                      setChavePix(v)
                      setErros((e) => ({ ...e, chavePix: undefined }))
                    }}
                    erro={erros.chavePix}
                    inputMode={
                      chavePixTipo === 'EMAIL'
                        ? 'email'
                        : chavePixTipo === 'TELEFONE'
                          ? 'tel'
                          : 'text'
                    }
                    descricao="O tipo é o que você escolheu acima — não é adivinhado."
                  />
                </TabsContent>
              ) : null}
            </Tabs>
            <Campo
              id={`${prefixo}-titular`}
              label="CPF/CNPJ do titular"
              valor={titular}
              onChange={(v) => {
                setTitular(v)
                setErros((e) => ({ ...e, titularDocumento: undefined }))
              }}
              erro={erros.titularDocumento}
              descricao="Tem de ser o CPF/CNPJ do favorecido do título."
            />
            {erroServidor ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erroServidor}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? <Spinner aria-hidden /> : <Landmark className="size-4" aria-hidden />}
              Salvar destino
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
