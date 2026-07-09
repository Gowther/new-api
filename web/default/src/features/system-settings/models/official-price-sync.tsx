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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CheckSquare, Loader2, RefreshCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { applyOfficialPriceSync, previewOfficialPriceSync } from '../api'
import type {
  OfficialPriceApplyData,
  OfficialPriceCandidate,
  OfficialPriceFieldValue,
  OfficialPriceMapping,
  OfficialPriceModelPreview,
  OfficialPricePreviewData,
} from '../types'
import { RATIO_TYPE_OPTIONS } from './constants'

const PRICE_FIELD_ORDER = [
  'model_ratio',
  'completion_ratio',
  'cache_ratio',
  'create_cache_ratio',
  'image_ratio',
  'audio_ratio',
  'audio_completion_ratio',
  'model_price',
  'billing_mode',
  'billing_expr',
]

const EXTRA_FIELD_LABELS: Record<string, string> = {
  billing_mode: 'Billing mode',
}

function mappingKey(mapping?: OfficialPriceMapping) {
  if (!mapping) return ''
  return `${mapping.source}\u0000${mapping.provider || ''}\u0000${mapping.upstream_model}`
}

function mappingFromCandidate(
  candidate: OfficialPriceCandidate
): OfficialPriceMapping {
  return {
    source: candidate.source,
    provider: candidate.provider,
    upstream_model: candidate.upstream_model,
  }
}

function fieldOrder(field: string) {
  const index = PRICE_FIELD_ORDER.indexOf(field)
  return index === -1 ? PRICE_FIELD_ORDER.length : index
}

function formatFieldValue(value: OfficialPriceFieldValue | undefined) {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

function selectSavedCandidates(
  models: OfficialPriceModelPreview[]
): Record<string, OfficialPriceMapping> {
  const next: Record<string, OfficialPriceMapping> = {}
  for (const model of models) {
    const selected = model.candidates.find((candidate) => candidate.selected)
    if (selected) next[model.model_name] = mappingFromCandidate(selected)
  }
  return next
}

function updatePreviewAfterApply(
  preview: OfficialPricePreviewData,
  data?: OfficialPriceApplyData
): OfficialPricePreviewData {
  if (!data) return preview

  const mappings = data.mappings || preview.mappings
  const updatedFields = data.updated_fields || {}
  return {
    ...preview,
    mappings,
    source_results: data.source_results || preview.source_results,
    models: preview.models.map((model) => {
      const mapping = mappings[model.model_name]
      const selectedKey = mappingKey(mapping)
      return {
        ...model,
        current: updatedFields[model.model_name] || model.current,
        mapping,
        candidates: model.candidates.map((candidate) => ({
          ...candidate,
          selected: mappingKey(mappingFromCandidate(candidate)) === selectedKey,
        })),
      }
    }),
  }
}

type FieldListProps = {
  fields: Record<string, OfficialPriceFieldValue>
}

function FieldList({ fields }: FieldListProps) {
  const { t } = useTranslation()
  const entries = Object.entries(fields).sort(
    ([left], [right]) => fieldOrder(left) - fieldOrder(right)
  )

  if (entries.length === 0) {
    return <span className='text-muted-foreground text-xs'>-</span>
  }

  return (
    <div className='flex min-w-[220px] flex-wrap gap-1.5'>
      {entries.map(([field, value]) => {
        const label =
          RATIO_TYPE_OPTIONS.find((option) => option.value === field)?.label ||
          EXTRA_FIELD_LABELS[field] ||
          field
        return (
          <Badge key={field} variant='outline' className='max-w-[360px]'>
            <span className='truncate'>
              {t(label)}: {formatFieldValue(value)}
            </span>
          </Badge>
        )
      })}
    </div>
  )
}

type CandidateButtonProps = {
  candidate: OfficialPriceCandidate
  selected: boolean
  disabled: boolean
  onSelect: () => void
}

function CandidateButton({
  candidate,
  selected,
  disabled,
  onSelect,
}: CandidateButtonProps) {
  const { t } = useTranslation()
  const detailParts = [
    candidate.provider ? `${t('Provider')}: ${candidate.provider}` : undefined,
    candidate.input_price !== undefined
      ? `${t('Input')}: ${candidate.input_price}`
      : undefined,
    candidate.output_price !== undefined
      ? `${t('Output')}: ${candidate.output_price}`
      : undefined,
    candidate.cache_read_price !== undefined
      ? `${t('Cache read price')}: ${candidate.cache_read_price}`
      : undefined,
  ].filter(Boolean)

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'border-border bg-background hover:bg-muted/60 flex w-full min-w-[360px] flex-col gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected && 'border-primary bg-primary/5'
      )}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <span
          className={cn(
            'border-border flex size-4 shrink-0 items-center justify-center rounded-full border',
            selected && 'border-primary bg-primary text-primary-foreground'
          )}
        >
          {selected && <Check className='size-3' />}
        </span>
        <span className='min-w-0 flex-1 truncate font-medium'>
          {candidate.upstream_model}
        </span>
        <Badge variant='secondary'>{candidate.source}</Badge>
        {selected && <Badge>{t('Selected')}</Badge>}
      </div>
      <FieldList fields={candidate.fields} />
      <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
        <span>{t('Score {{score}}', { score: candidate.score })}</span>
        {detailParts.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </div>
    </button>
  )
}

export function OfficialPriceSync() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [previewData, setPreviewData] = useState<OfficialPricePreviewData>()
  const [selectedMappings, setSelectedMappings] = useState<
    Record<string, OfficialPriceMapping>
  >({})
  const [search, setSearch] = useState('')

  const previewMutation = useMutation({
    mutationFn: previewOfficialPriceSync,
    onSuccess: (data) => {
      if (!data.success) {
        toast.error(data.message || t('Failed to preview official prices'))
        return
      }
      setPreviewData(data.data)
      setSelectedMappings(selectSavedCandidates(data.data.models))

      const matchedCount = data.data.models.filter(
        (model) => model.candidates.length > 0
      ).length
      if (matchedCount === 0) {
        toast.info(t('No official price candidates found'))
      } else {
        toast.success(t('Official price candidates loaded'))
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to preview official prices'))
    },
  })

  const applyMutation = useMutation({
    mutationFn: applyOfficialPriceSync,
    onSuccess: (data) => {
      if (!data.success) {
        toast.error(data.message || t('Failed to sync official prices'))
        return
      }

      setPreviewData((prev) =>
        prev ? updatePreviewAfterApply(prev, data.data) : prev
      )
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      queryClient.invalidateQueries({ queryKey: ['model-pricing-health'] })

      const updatedCount = data.data?.updated_models?.length ?? 0
      toast.success(
        updatedCount > 0
          ? t('Updated {{count}} model(s)', { count: updatedCount })
          : t('Prices synced successfully')
      )
    },
    onError: (error: Error) => {
      toast.error(error.message || t('Failed to sync official prices'))
    },
  })

  const filteredModels = useMemo(() => {
    const models = previewData?.models || []
    const keyword = search.trim().toLowerCase()
    if (!keyword) return models

    return models.filter((model) => {
      if (model.model_name.toLowerCase().includes(keyword)) return true
      return model.candidates.some(
        (candidate) =>
          candidate.upstream_model.toLowerCase().includes(keyword) ||
          candidate.source.toLowerCase().includes(keyword) ||
          (candidate.provider || '').toLowerCase().includes(keyword)
      )
    })
  }, [previewData?.models, search])

  const isLoading = previewMutation.isPending || applyMutation.isPending
  const selectedCount = Object.keys(selectedMappings).length

  const handleSelectCandidate = (
    modelName: string,
    candidate: OfficialPriceCandidate
  ) => {
    setSelectedMappings((prev) => {
      const mapping = mappingFromCandidate(candidate)
      if (mappingKey(prev[modelName]) === mappingKey(mapping)) {
        const next = { ...prev }
        delete next[modelName]
        return next
      }
      return { ...prev, [modelName]: mapping }
    })
  }

  const handleApplySelected = () => {
    if (selectedCount === 0) {
      toast.warning(t('No official price selection'))
      return
    }
    applyMutation.mutate({ mappings: selectedMappings, apply_all: false })
  }

  const handleApplySaved = () => {
    applyMutation.mutate({ mappings: {}, apply_all: true })
  }

  return (
    <div className='space-y-4 rounded-md border p-4'>
      <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline'>{t('Official Sync')}</Badge>
          {previewData?.source_results.map((result) => {
            const content =
              result.status === 'success'
                ? `${result.name}: ${result.count ?? 0}`
                : `${result.name}: ${result.error || result.status}`
            return (
              <Tooltip key={result.name}>
                <TooltipTrigger>
                  <Badge
                    variant={
                      result.status === 'success' ? 'secondary' : 'destructive'
                    }
                  >
                    {result.name}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{content}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='relative sm:w-64'>
            <Search className='text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2' />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Search model name...')}
              className='pl-8'
              disabled={isLoading || !previewData}
            />
          </div>
          <Button
            variant='outline'
            onClick={() => previewMutation.mutate()}
            disabled={isLoading}
          >
            {previewMutation.isPending ? (
              <Loader2 className='animate-spin' />
            ) : (
              <RefreshCcw />
            )}
            {t('Preview Official Prices')}
          </Button>
          <Button
            variant='secondary'
            onClick={handleApplySaved}
            disabled={isLoading}
          >
            {applyMutation.isPending ? (
              <Loader2 className='animate-spin' />
            ) : (
              <RefreshCcw />
            )}
            {t('Sync Saved Official Prices')}
          </Button>
          <Button
            onClick={handleApplySelected}
            disabled={isLoading || selectedCount === 0}
          >
            {applyMutation.isPending ? (
              <Loader2 className='animate-spin' />
            ) : (
              <CheckSquare />
            )}
            {t('Apply Selected Official Prices')}
          </Button>
        </div>
      </div>

      {!previewData ? (
        <div className='flex h-40 items-center justify-center rounded-md border'>
          <p className='text-muted-foreground text-sm'>
            {t('No official price preview yet')}
          </p>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className='flex h-40 items-center justify-center rounded-md border'>
          <p className='text-muted-foreground text-sm'>
            {t('No official price matches found')}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-[220px]'>{t('Model')}</TableHead>
              <TableHead>{t('Current Price')}</TableHead>
              <TableHead>{t('Matched Official Prices')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredModels.map((model) => (
              <TableRow key={model.model_name}>
                <TableCell className='whitespace-normal'>
                  <div className='flex min-w-[220px] flex-col gap-1'>
                    <span className='font-medium'>{model.model_name}</span>
                    {model.mapping && (
                      <Badge variant='outline' className='w-fit'>
                        {t('Saved')}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className='whitespace-normal'>
                  <FieldList fields={model.current} />
                </TableCell>
                <TableCell className='whitespace-normal'>
                  {model.candidates.length === 0 ? (
                    <span className='text-muted-foreground text-sm'>
                      {t('No candidates')}
                    </span>
                  ) : (
                    <div className='flex max-w-[860px] flex-col gap-2'>
                      {model.candidates.map((candidate) => {
                        const candidateMapping = mappingFromCandidate(candidate)
                        return (
                          <CandidateButton
                            key={mappingKey(candidateMapping)}
                            candidate={candidate}
                            selected={
                              mappingKey(selectedMappings[model.model_name]) ===
                              mappingKey(candidateMapping)
                            }
                            disabled={isLoading}
                            onSelect={() =>
                              handleSelectCandidate(model.model_name, candidate)
                            }
                          />
                        )
                      })}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
