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
import { Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
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

import { previewChannelModelMappings } from '@/features/channels/api'
import type {
  ChannelModelMappingPreview,
  ChannelModelMappingRule,
} from '@/features/channels/types'

import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const OPTION_KEY = 'channel_model_mapping_setting.rules'
const MATCH_MODE_OPTIONS = [
  { value: 'exact', label: 'Exact Match' },
  { value: 'contains', label: 'Contains' },
] as const

const ruleSchema = z.object({
  match_mode: z.enum(['exact', 'contains']),
  match_value: z.string().trim().min(1).max(255),
  case_sensitive: z.boolean(),
  exposed_model: z.string().trim().min(1).max(255),
  priority: z.number().int().min(-10000).max(10000),
  enabled: z.boolean(),
})

type RuleFormValues = z.infer<typeof ruleSchema>
type RuleRow = ChannelModelMappingRule & { id: number }

type RuleEditorDialogProps = {
  open: boolean
  rule: RuleRow | null
  onOpenChange: (open: boolean) => void
  onSave: (values: RuleFormValues) => void
}

function parseRules(rawValue: string): ChannelModelMappingRule[] {
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (rule): rule is ChannelModelMappingRule =>
        Boolean(rule) && typeof rule === 'object'
    )
  } catch {
    return []
  }
}

function toSerializableRules(rows: RuleRow[]): ChannelModelMappingRule[] {
  return rows.map(({ id: _id, ...rule }) => rule)
}

function buildRuleFormValues(rule: RuleRow | null): RuleFormValues {
  return {
    match_mode: rule?.match_mode ?? 'contains',
    match_value: rule?.match_value ?? '',
    case_sensitive: rule?.case_sensitive ?? false,
    exposed_model: rule?.exposed_model ?? '',
    priority: rule?.priority ?? 0,
    enabled: rule?.enabled ?? true,
  }
}

function RuleEditorDialog(props: RuleEditorDialogProps) {
  const { t } = useTranslation()
  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleSchema),
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
      title={t(props.rule ? 'Edit Mapping Rule' : 'Add Mapping Rule')}
      description={t(
        'The source model is matched against the channel model list. The exposed model is added to the channel and mapped back to the original upstream model.'
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
                    'Exact matches the complete upstream model name. Contains matches any upstream model name containing the value.'
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
                  <Input placeholder='glm-5.2' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='exposed_model'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Exposed Model')}</FormLabel>
                <FormControl>
                  <Input placeholder='GLM-5.2' {...field} />
                </FormControl>
                <FormDescription>
                  {t('This is the model name that users see and request.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FieldGroup className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='priority'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Priority')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={-10000}
                      max={10000}
                      {...field}
                      value={Number.isFinite(field.value) ? field.value : ''}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
          </FieldGroup>
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
        </form>
      </Form>
    </Dialog>
  )
}

type ChannelModelMappingRulesSectionProps = {
  defaultValue: string
}

export function ChannelModelMappingRulesSection(
  props: ChannelModelMappingRulesSectionProps
) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const rowIdRef = useRef(0)
  const [rows, setRows] = useState<RuleRow[]>([])
  const [editingRule, setEditingRule] = useState<RuleRow | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [testModel, setTestModel] = useState('')
  const [testPreview, setTestPreview] =
    useState<ChannelModelMappingPreview | null>(null)
  const [isTesting, setIsTesting] = useState(false)

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
    (values: RuleFormValues) => {
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
      setTestPreview(null)
    },
    [editingRule]
  )

  const handleDeleteRule = useCallback((id: number) => {
    setRows((currentRows) => currentRows.filter((rule) => rule.id !== id))
    setTestPreview(null)
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

  const handleTest = useCallback(async () => {
    const model = testModel.trim()
    if (!model) {
      toast.error(t('Enter a model name to test'))
      return
    }
    setIsTesting(true)
    try {
      const response = await previewChannelModelMappings({
        models: [model],
        rules: toSerializableRules(rows),
      })
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to preview model mapping'))
      }
      setTestPreview(response.data)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to preview model mapping')
      )
    } finally {
      setIsTesting(false)
    }
  }, [rows, t, testModel])

  let testPreviewDescription: string | null = null
  if (testPreview?.has_changes) {
    testPreviewDescription = `${t('Preview Mapping')}: ${testPreview.changes[0]?.exposed_model} → ${testPreview.changes[0]?.upstream_model}`
  } else if (testPreview?.has_conflicts) {
    testPreviewDescription = t('The test found a mapping conflict.')
  } else if (testPreview) {
    testPreviewDescription = t('No matching model mapping rules were found.')
  }

  return (
    <SettingsSection title={t('Channel Model Mapping Rules')}>
      <div className='space-y-4'>
        <Alert>
          <AlertDescription>
            {t(
              'Rules convert detected upstream model names into user-facing model names only after you review and apply the preview in a channel form.'
            )}
          </AlertDescription>
        </Alert>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <p className='text-sm font-medium'>{t('Rules')}</p>
            <p className='text-muted-foreground text-xs'>
              {t('Higher priority rules are evaluated first.')}
            </p>
          </div>
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
          emptyContent={t('No mapping rules configured.')}
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
              id: 'exposed-model',
              header: t('Exposed Model'),
              cellClassName: 'font-mono text-xs',
              cell: (row) => row.exposed_model,
            },
            {
              id: 'priority',
              header: t('Priority'),
              cell: (row) => row.priority,
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

        <FieldGroup className='rounded-md border p-4'>
          <FieldLabel>{t('Test Matching')}</FieldLabel>
          <Field orientation='horizontal' className='items-end'>
            <div className='grid flex-1 gap-1.5'>
              <FieldLabel htmlFor='channel-model-mapping-test-model'>
                {t('Upstream Model')}
              </FieldLabel>
              <Input
                id='channel-model-mapping-test-model'
                value={testModel}
                placeholder='zai.ai/glm-5.2'
                onChange={(event) => setTestModel(event.target.value)}
              />
            </div>
            <Button onClick={handleTest} disabled={isTesting}>
              <Play className='mr-2 h-4 w-4' />
              {t('Test')}
            </Button>
          </Field>
          {testPreview && (
            <Alert>
              <AlertDescription>{testPreviewDescription}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        <div className='flex justify-end'>
          <Button onClick={handleSave} disabled={updateOption.isPending}>
            {t('Save Mapping Rules')}
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
