'use client'

import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { PERMISSAO } from '@/lib/permissoes'
import { BorderosPanel } from '../BorderosPanel'

/** Rota dedicada de Borderôs (deep-link / back-compat). A UI vive em `BorderosPanel`,
 * reutilizada também como aba "Borderôs" na Gestão de Permutas. */
export default function BorderosPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.PERMUTAS_VER}>
      <BorderosPanel />
    </ExigePermissao>
  )
}
