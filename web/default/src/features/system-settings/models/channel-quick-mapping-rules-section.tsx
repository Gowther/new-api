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
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { ChannelQuickMappingRule } from '@/features/channels/types'

import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const OPTION_KEY = 'channel_quick_mapping_setting.rules'
const MATCH_MODE_OPTIONS = [
  { value: 'exact', label: 'Exact Match' },
  { value: 'contains', label: 'Contains' },
] as const

const quickMappingRuleSchema = z.object({
  match_mode: z.enum(['exact', 'contains']),
  match_value: z.string().trim().min(1).max(255),
  case_sensitive: z.boolean(),
  alias_model: z.string().trim().min(1).max(255),
  enabled: z.boolean(),
})

type QuickMappingRuleFormValues = z.infer<typeof quickMappingRuleSchema>
type QuickMappingRuleRow = ChannelQuickMappingRule & { id: number }

type RuleEditorDialogProps = {
  open: boolean
  rule: QuickMappingRuleRow | null
  onOpenChange: (open: boolean) => void
  onSave: (values: QuickMappingRuleFormValues) => void
}

function parseRules(rawValue: string): ChannelQuickMappingRule[] {
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (rule): rule is ChannelQuickMappingRule =>
        Boolean(rule) && typeof rule === 'object'
    )
  } catch {
    return []
  }
}

function toSerializableRules(
  rows: QuickMappingRuleRow[]
): ChannelQuickMappingRule[] {
  return rows.map(({ id: _id, ...rule }) => rule)
}

function buildRuleFormValues(
  rule: QuickMappingRuleRow | null
): QuickMappingRuleFormValues {
  return {
    match_mode: rule?.match_mode ?? 'contains',
    match_value: rule?.match_value ?? '',
    case_sensitive: rule?.case_sensitive ?? false,
    alias_model: rule?.alias_model ?? '',
    enabled: rule?.enabled ?? true,
  }
}

function RuleEditorDialog(props: RuleEditorDialogProps) {
  const { t } = useTranslation()
  const form = useForm<QuickMappingRuleFormValues>({
    resolver: zodResolver(quickMappingRuleSchema),
    defaultValues: buildRuleFormValues(props.rule),
  })
  const selectItems = useMemo(
    () =>
      MATCH_MODE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.label),
      })),
    [t]
  )

  useEffect(() => {
    if (props.open) {
      form.reset(buildRuleFormValues(props.rule))
    }
  }, [form, props.open, props.rule])

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t(props.rule ? 'Edit Quick Mapping Rule' : 'Add Quick Mapping Rule')}
      description={t(
        'A matching selected model only triggers an optional suggestion. You choose any selected channel model as the alias target later.'
      )}
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={form.handleSubmit(props.onSave)}>
            {t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form className='space-y-4' onSubmit={form.handleSubmit(props.onSave)}>
          <FormField
            control={form.control}
            name='match_mode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Match Mode')}</FormLabel>
                <Select
                  items={selectItems}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {selectItems.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t(
                    'Exact matches the complete selected model name. Contains matches any selected model name containing the value.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='match_value'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Match Value')}</FormLabel>
                <FormControl>
                  <Input placeholder='gpt-' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='alias_model'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Alias Model')}</FormLabel>
                <FormControl>
                  <Input placeholder='codex-auto-review' {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'If the upstream does not already provide this model, it can be added as an optional alias mapping.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FieldGroup className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='case_sensitive'
              render={({ field }) => (
                <Field className='justify-between rounded-md border px-3 py-2'>
                  <FieldLabel>{t('Case Sensitive')}</FieldLabel>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </Field>
              )}
            />
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <Field className='justify-between rounded-md border px-3 py-2'>
                  <FieldLabel>{t('Enabled')}</FieldLabel>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </Form>
    </Dialog>
  )
}

type ChannelQuickMappingRulesSectionProps = {
  defaultValue: string
}

export function ChannelQuickMappingRulesSection(
  props: ChannelQuickMappingRulesSectionProps
) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const rowIdRef = useRef(0)
  const [rows, setRows] = useState<QuickMappingRuleRow[]>([])
  const [editingRule, setEditingRule] = useState<QuickMappingRuleRow | null>(
    null
  )
  const [editorOpen, setEditorOpen] = useState(false)

  useEffect(() => {
    const rules = parseRules(props.defaultValue)
    rowIdRef.current = rules.length
    setRows(rules.map((rule, index) => ({ ...rule, id: index + 1 })))
  }, [props.defaultValue])

  const serializedRules = useMemo(
    () => JSON.stringify(toSerializableRules(rows)),
    [rows]
  )

  const handleSaveRule = useCallback(
    (values: QuickMappingRuleFormValues) => {
      const aliasModel = values.alias_model.trim().toLowerCase()
      const duplicatesAlias = rows.some(
        (rule) =>
          rule.id !== editingRule?.id &&
          rule.alias_model.trim().toLowerCase() === aliasModel
      )
      if (duplicatesAlias) {
        toast.error(t('Each alias model can only be configured once.'))
        return
      }

      setRows((currentRows) => {
        if (editingRule) {
          return currentRows.map((rule) =>
            rule.id === editingRule.id ? { ...values, id: rule.id } : rule
          )
        }
        rowIdRef.current += 1
        return [...currentRows, { ...values, id: rowIdRef.current }]
      })
      setEditorOpen(false)
      setEditingRule(null)
    },
    [editingRule, rows, t]
  )

  const handleDeleteRule = useCallback((id: number) => {
    setRows((currentRows) => currentRows.filter((rule) => rule.id !== id))
  }, [])

  const handleSave = useCallback(async () => {
    try {
      await updateOption.mutateAsync({
        key: OPTION_KEY,
        value: serializedRules,
      })
    } catch {
      // useUpdateOption provides the user-facing error toast.
    }
  }, [serializedRules, updateOption])

  return (
    <SettingsSection title={t('Channel Quick Mapping Rules')}>
      <div className='space-y-4'>
        <Alert>
          <AlertDescription>
            {t(
              'After selecting models for a new or existing channel, a matching rule optionally suggests adding its alias. The original selected models are always kept.'
            )}
          </AlertDescription>
        </Alert>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          <p className='text-muted-foreground text-xs'>
            {t(
              'If the alias model already exists upstream or already has a mapping, no suggestion is shown.'
            )}
          </p>
          <Button
            size='sm'
            onClick={() => {
              setEditingRule(null)
              setEditorOpen(true)
            }}
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add Rule')}
          </Button>
        </div>

        <StaticDataTable
          data={rows}
          getRowKey={(row) => row.id}
          emptyClassName='text-muted-foreground py-8'
          emptyContent={t('No quick mapping rules configured.')}
          columns={[
            {
              id: 'match',
              header: t('Match'),
              cell: (row) => (
                <div className='space-y-0.5'>
                  <p className='font-mono text-xs'>{row.match_value}</p>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      row.match_mode === 'exact' ? 'Exact Match' : 'Contains'
                    )}
                    {row.case_sensitive ? ` · ${t('Case Sensitive')}` : ''}
                  </p>
                </div>
              ),
            },
            {
              id: 'alias-model',
              header: t('Alias Model'),
              cellClassName: 'font-mono text-xs',
              cell: (row) => row.alias_model,
            },
            {
              id: 'enabled',
              header: t('Enabled'),
              cell: (row) => (row.enabled ? t('Yes') : t('No')),
            },
            {
              id: 'actions',
              header: t('Actions'),
              className: 'text-right',
              cellClassName: 'text-right',
              cell: (row) => (
                <div className='flex justify-end gap-1'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => {
                      setEditingRule(row)
                      setEditorOpen(true)
                    }}
                    aria-label={t('Edit')}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => handleDeleteRule(row.id)}
                    aria-label={t('Delete')}
                  >
                    <Trash2 className='text-destructive' />
                  </Button>
                </div>
              ),
            },
          ]}
        />

        <div className='flex justify-end'>
          <Button onClick={handleSave} disabled={updateOption.isPending}>
            {t('Save Quick Mapping Rules')}
          </Button>
        </div>
      </div>

      <RuleEditorDialog
        open={editorOpen}
        rule={editingRule}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditingRule(null)
        }}
        onSave={handleSaveRule}
      />
    </SettingsSection>
  )
}
