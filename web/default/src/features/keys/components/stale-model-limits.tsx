/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { cleanupStaleTokenModelLimits, getStaleTokenModelLimits } from '../api'
import type { StaleTokenModelLimit, StaleTokenModelLimitsReport } from '../types'

const STALE_QUERY_KEY = 'stale-token-model-limits'

// eslint-disable-next-line react-refresh/only-export-components
export function useStaleTokenModelLimitsReport() {
  const { t } = useTranslation()
  return useQuery({
    queryKey: [STALE_QUERY_KEY],
    queryFn: async () => {
      const result = await getStaleTokenModelLimits()
      if (!result.success) {
        throw new Error(result.message || t('Failed to load stale model limits'))
      }
      return result.data ?? null
    },
  })
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStaleByTokenId(
  report: StaleTokenModelLimitsReport | null | undefined
) {
  return useMemo(() => {
    const byTokenId = new Map<number, string[]>()
    report?.tokens.forEach((token) => {
      byTokenId.set(token.token_id, token.stale_models)
    })
    return byTokenId
  }, [report])
}

export function StaleModelLimitsEntry({
  report,
  onOpen,
}: {
  report: StaleTokenModelLimitsReport | null | undefined
  onOpen: (tokenId?: number) => void
}) {
  const { t } = useTranslation()
  const affectedTokens = report?.tokens.length ?? 0
  if (affectedTokens === 0) return null

  return (
    <Button
      variant='outline'
      size='sm'
      className='border-warning/40 text-warning hover:bg-warning/10 hover:text-warning h-8'
      title={t('Stale models in token model limits')}
      onClick={() => onOpen()}
    >
      <AlertTriangle className='size-4' />
      {t('Stale models')}
      <Badge
        variant='warning'
        className='h-4 gap-0 rounded-full px-1.5 text-[11px]'
      >
        {affectedTokens}
      </Badge>
    </Button>
  )
}

export function StaleModelLimitsBadge({
  staleModels,
  onOpen,
}: {
  staleModels: string[]
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type='button'
            aria-label={t('Stale models in token model limits')}
            onClick={onOpen}
            className='shrink-0 cursor-pointer outline-none'
          />
        }
      >
        <Badge variant='warning' className='h-5 gap-1 rounded-full px-2'>
          <AlertTriangle className='size-3' />
          {t('Stale models')} · {staleModels.length}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className='max-w-80 whitespace-normal'>
        <div className='space-y-1.5 text-xs'>
          <p>
            {t(
              'The following models are no longer served by any enabled channel. They are kept in case a channel serves them again, and can be removed manually.'
            )}
          </p>
          <p className='break-all'>{staleModels.join(', ')}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function StaleModelLimitsDialog({
  open,
  onOpenChange,
  report,
  focusTokenId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: StaleTokenModelLimitsReport | null
  focusTokenId: number | null
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<Record<number, string[]>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !report) return
    setSelection(
      Object.fromEntries(
        report.tokens.map((token) => [token.token_id, [...token.stale_models]])
      )
    )
  }, [open, report])

  useEffect(() => {
    if (!open || focusTokenId == null) return
    const target = document.querySelector<HTMLElement>(
      `[data-stale-token-id="${focusTokenId}"]`
    )
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // Only scroll on open — selection changes must not re-scroll the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusTokenId])

  if (!open || !report) return null

  const selectedCount = Object.values(selection).reduce(
    (sum, models) => sum + models.length,
    0
  )
  const tokenSelection = (token: StaleTokenModelLimit) =>
    selection[token.token_id] ?? []

  const toggleModel = (tokenId: number, model: string, checked: boolean) => {
    setSelection((prev) => {
      const current = prev[tokenId] ?? []
      const next = checked
        ? [...current, model]
        : current.filter((name) => name !== model)
      return { ...prev, [tokenId]: next }
    })
  }

  const setTokenSelection = (tokenId: number, models: string[]) => {
    setSelection((prev) => ({ ...prev, [tokenId]: models }))
  }

  const handleSubmit = async () => {
    const ids: number[] = []
    const selectedModels = new Set<string>()
    for (const token of report.tokens) {
      const checked = tokenSelection(token)
      if (checked.length === 0) continue
      ids.push(token.token_id)
      checked.forEach((model) => selectedModels.add(model))
    }
    if (ids.length === 0 || submitting) return

    setSubmitting(true)
    try {
      const result = await cleanupStaleTokenModelLimits(ids, [
        ...selectedModels,
      ])
      if (result.success) {
        toast.success(t('Checked stale models removed'))
        onOpenChange(false)
        await queryClient.invalidateQueries({ queryKey: [STALE_QUERY_KEY] })
        await queryClient.invalidateQueries({ queryKey: ['keys'] })
      } else {
        toast.error(result.message || t('Failed to remove stale models'))
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to remove stale models')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('Stale models in token model limits')}</DialogTitle>
          <DialogDescription>
            {t(
              'The following models are no longer served by any enabled channel. They are kept in case a channel serves them again, and can be removed manually.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className='max-h-[min(60vh,30rem)] space-y-2.5 overflow-y-auto pr-1'>
          {report.tokens.map((token) => {
            const checked = tokenSelection(token)
            return (
              <div
                key={token.token_id}
                data-stale-token-id={token.token_id}
                className={cn(
                  'rounded-xl border border-border/60 p-3 transition-colors',
                  focusTokenId === token.token_id &&
                    'border-warning/60 ring-warning/20 ring-1'
                )}
              >
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <span className='min-w-0 truncate text-sm font-medium'>
                    {token.token_name}
                  </span>
                  <span className='flex shrink-0 items-center gap-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 px-1.5 text-xs'
                      onClick={() =>
                        setTokenSelection(token.token_id, [...token.stale_models])
                      }
                    >
                      {t('Select all')}
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 px-1.5 text-xs'
                      onClick={() => setTokenSelection(token.token_id, [])}
                    >
                      {t('Deselect all')}
                    </Button>
                  </span>
                </div>
                <div className='grid gap-1.5 sm:grid-cols-2'>
                  {token.stale_models.map((model) => (
                    <label
                      key={model}
                      className='flex min-w-0 items-center gap-2 text-sm'
                    >
                      <Checkbox
                        checked={checked.includes(model)}
                        onCheckedChange={(value) =>
                          toggleModel(token.token_id, model, !!value)
                        }
                      />
                      <span className='min-w-0 truncate'>{model}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Checked models will be removed; unchecked stale models are kept and reactivate automatically when a channel serves the model again.'
          )}
        </p>
        <DialogFooter>
          <Button
            size='sm'
            disabled={submitting || selectedCount === 0}
            onClick={handleSubmit}
          >
            {t('Clean selected stale models ({{count}})', {
              count: selectedCount,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
