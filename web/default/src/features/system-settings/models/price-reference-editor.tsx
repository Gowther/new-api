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
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'

import { useUpdateOption } from '../hooks/use-update-option'
import { safeJsonParse } from '../utils/json-parser'

export const MODEL_PRICE_REFERENCE_OPTION_KEY = 'ModelPriceReference'

type PriceReferenceBinding = {
  id: string
  alias: string
  source: string
}

let bindingRowSeq = 0

function makeBindingRow(alias: string, source: string): PriceReferenceBinding {
  bindingRowSeq += 1
  return { id: `ref-row-${bindingRowSeq}`, alias, source }
}

type PriceReferenceEditorProps = {
  defaultValue: string
  modelPrice: string
  modelRatio: string
  billingMode: string
  billingExpr: string
  unsetModels: string[]
}

function parseBindings(defaultValue: string): PriceReferenceBinding[] {
  const parsed = safeJsonParse<Record<string, string>>(defaultValue, {
    fallback: {},
    silent: true,
  })
  return Object.entries(parsed)
    .filter(
      ([alias, source]) =>
        alias.trim() !== '' &&
        typeof source === 'string' &&
        source.trim() !== ''
    )
    .map(([alias, source]) => makeBindingRow(alias.trim(), source.trim()))
    .sort((a, b) => a.alias.localeCompare(b.alias))
}

function serializeBindings(rows: PriceReferenceBinding[]): string {
  const map: Record<string, string> = {}
  for (const row of rows) {
    const alias = row.alias.trim()
    const source = row.source.trim()
    if (alias !== '' && source !== '') {
      map[alias] = source
    }
  }
  return JSON.stringify(map, null, 2)
}

export function PriceReferenceEditor({
  defaultValue,
  modelPrice,
  modelRatio,
  billingMode,
  billingExpr,
  unsetModels,
}: PriceReferenceEditorProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<PriceReferenceBinding[]>(() =>
    parseBindings(defaultValue)
  )
  const [savedValue, setSavedValue] = useState(() =>
    serializeBindings(parseBindings(defaultValue))
  )

  useEffect(() => {
    const bindings = parseBindings(defaultValue)
    setRows(bindings)
    setSavedValue(serializeBindings(bindings))
  }, [defaultValue])

  const pricedModelOptions = useMemo(() => {
    const names = new Set<string>()
    for (const record of [
      safeJsonParse<Record<string, number>>(modelPrice, {
        fallback: {},
        silent: true,
      }),
      safeJsonParse<Record<string, number>>(modelRatio, {
        fallback: {},
        silent: true,
      }),
    ]) {
      for (const name of Object.keys(record)) {
        if (name.trim() !== '') {
          names.add(name)
        }
      }
    }
    // 阶梯计费模型只配置在 billing_mode/billing_expr 里，也要作为跟随目标
    const modeRecord = safeJsonParse<Record<string, string>>(billingMode, {
      fallback: {},
      silent: true,
    })
    for (const [name, mode] of Object.entries(modeRecord)) {
      if (mode === 'tiered_expr' && name.trim() !== '') {
        names.add(name)
      }
    }
    const exprRecord = safeJsonParse<Record<string, string>>(billingExpr, {
      fallback: {},
      silent: true,
    })
    for (const [name, expr] of Object.entries(exprRecord)) {
      if (
        typeof expr === 'string' &&
        expr.trim() !== '' &&
        name.trim() !== ''
      ) {
        names.add(name)
      }
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }))
  }, [modelPrice, modelRatio, billingMode, billingExpr])

  const aliasCandidates = useMemo(() => {
    const names = new Set<string>()
    for (const model of unsetModels) {
      if (model.trim() !== '') {
        names.add(model)
      }
    }
    for (const row of rows) {
      if (row.alias.trim() !== '') {
        names.add(row.alias.trim())
      }
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }))
  }, [unsetModels, rows])

  const buildRowAliasOptions = useCallback(
    (row: PriceReferenceBinding) => {
      const usedByOthers = new Set(
        rows
          .filter((other) => other.id !== row.id)
          .map((other) => other.alias.trim())
          .filter((alias) => alias !== '')
      )
      return aliasCandidates.filter((option) => !usedByOthers.has(option.value))
    },
    [aliasCandidates, rows]
  )

  const isDirty = useMemo(
    () => serializeBindings(rows) !== savedValue,
    [rows, savedValue]
  )

  const updateRow = useCallback(
    (index: number, patch: Partial<PriceReferenceBinding>) => {
      setRows((prev) =>
        prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
      )
    },
    []
  )

  const removeRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, makeBindingRow('', '')])
  }, [])

  const handleSave = useCallback(async () => {
    const aliases = new Set<string>()
    for (const row of rows) {
      const alias = row.alias.trim()
      const source = row.source.trim()
      if (alias === '' || source === '') {
        toast.error(
          t('Each binding needs both an alias model and a follow model')
        )
        return
      }
      if (alias === source) {
        toast.error(
          t('The alias model and the follow model cannot be the same')
        )
        return
      }
      if (aliases.has(alias)) {
        toast.error(t('Each alias model can only be bound once'))
        return
      }
      aliases.add(alias)
    }

    const value = serializeBindings(rows)
    const result = await updateOption.mutateAsync({
      key: MODEL_PRICE_REFERENCE_OPTION_KEY,
      value,
    })
    if (result.success) {
      setSavedValue(value)
      toast.success(t('Price reference bindings saved'))
      queryClient.invalidateQueries({ queryKey: ['model-pricing-health'] })
    } else {
      toast.error(
        result.message || t('Failed to save price reference bindings')
      )
    }
  }, [rows, queryClient, t, updateOption])

  return (
    <div className='rounded-xl border p-4'>
      <div className='text-base font-medium'>
        {t('Price reference bindings')}
      </div>
      <p className='text-muted-foreground mt-1 text-sm'>
        {t(
          'Bind an unpriced alias model to a priced model. Price items the alias does not define on its own are resolved from the bound model and follow its future changes, including official price sync updates.'
        )}
      </p>

      {rows.length === 0 ? (
        <div className='text-muted-foreground mt-4 rounded-lg border border-dashed p-6 text-center text-sm'>
          {t(
            'No bindings configured yet. Add one to make an unpriced alias model follow the pricing of an existing model.'
          )}
        </div>
      ) : (
        <div className='mt-4 flex flex-col gap-2'>
          <div className='text-muted-foreground hidden items-center gap-3 text-sm md:grid md:grid-cols-[1fr_1fr_2.25rem]'>
            <span>{t('Alias model')}</span>
            <span>{t('Follow model')}</span>
            <span aria-hidden='true' />
          </div>
          {rows.map((row, index) => (
            <div
              key={row.id}
              className='grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_1fr_2.25rem]'
            >
              <ComboboxInput
                options={buildRowAliasOptions(row)}
                value={row.alias}
                onValueChange={(value) => updateRow(index, { alias: value })}
                placeholder={t('Alias model')}
                allowCustomValue
              />
              <ComboboxInput
                options={pricedModelOptions}
                value={row.source}
                onValueChange={(value) => updateRow(index, { source: value })}
                placeholder={t('Follow model')}
                allowCustomValue
              />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t('Remove binding')}
                onClick={() => removeRow(index)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className='mt-4 flex justify-end gap-2'>
        <Button type='button' variant='outline' size='sm' onClick={addRow}>
          <Plus data-icon='inline-start' />
          {t('Add binding')}
        </Button>
        <Button
          type='button'
          size='sm'
          disabled={!isDirty || updateOption.isPending}
          onClick={handleSave}
        >
          <Save data-icon='inline-start' />
          {updateOption.isPending ? t('Saving...') : t('Save bindings')}
        </Button>
      </div>
    </div>
  )
}
