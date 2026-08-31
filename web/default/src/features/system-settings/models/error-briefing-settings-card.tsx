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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Combobox } from '@/components/ui/combobox'
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
import { Switch } from '@/components/ui/switch'
import { getEnabledModels } from '@/features/channels/api'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

/**
 * Nested object so the dotted FormField `name` props match react-hook-form's
 * path semantics, following the other settings cards in this directory.
 */
const errorBriefingBaseSchema = z.object({
  error_briefing_setting: z.object({
    enabled: z.boolean(),
    group: z.string(),
    model: z.string(),
    include_raw_error_text: z.boolean(),
    cache_minutes: z.coerce.number().int().min(1).max(120),
    max_problems: z.coerce.number().int().min(1).max(60),
  }),
})

const createErrorBriefingSchema = (requiredModelMessage: string) =>
  errorBriefingBaseSchema.superRefine((values, ctx) => {
    // Enabling without a model would put a button on the workbench that always
    // fails, so the model is required at the moment it is switched on. The
    // backend rejects this too; catching it here keeps the message local.
    if (
      values.error_briefing_setting.enabled &&
      values.error_briefing_setting.model.trim() === ''
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['error_briefing_setting', 'model'],
        message: requiredModelMessage,
      })
    }
  })

type ErrorBriefingFormInput = z.input<typeof errorBriefingBaseSchema>
type ErrorBriefingFormValues = z.output<typeof errorBriefingBaseSchema>

type FlatErrorBriefingDefaults = {
  'error_briefing_setting.enabled': boolean
  'error_briefing_setting.group': string
  'error_briefing_setting.model': string
  'error_briefing_setting.include_raw_error_text': boolean
  'error_briefing_setting.cache_minutes': number
  'error_briefing_setting.max_problems': number
}

const buildFormDefaults = (
  defaults: FlatErrorBriefingDefaults
): ErrorBriefingFormInput => ({
  error_briefing_setting: {
    enabled: defaults['error_briefing_setting.enabled'],
    group: defaults['error_briefing_setting.group'] ?? 'default',
    model: defaults['error_briefing_setting.model'] ?? '',
    include_raw_error_text:
      defaults['error_briefing_setting.include_raw_error_text'],
    cache_minutes: defaults['error_briefing_setting.cache_minutes'] ?? 5,
    max_problems: defaults['error_briefing_setting.max_problems'] ?? 20,
  },
})

const normalizeFormValues = (
  values: ErrorBriefingFormValues
): FlatErrorBriefingDefaults => ({
  'error_briefing_setting.enabled': values.error_briefing_setting.enabled,
  'error_briefing_setting.group': values.error_briefing_setting.group.trim(),
  'error_briefing_setting.model': values.error_briefing_setting.model.trim(),
  'error_briefing_setting.include_raw_error_text':
    values.error_briefing_setting.include_raw_error_text,
  'error_briefing_setting.cache_minutes':
    values.error_briefing_setting.cache_minutes,
  'error_briefing_setting.max_problems':
    values.error_briefing_setting.max_problems,
})

interface Props {
  defaultValues: FlatErrorBriefingDefaults
}

export function ErrorBriefingSettingsCard(props: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const schema = useMemo(
    () =>
      createErrorBriefingSchema(
        t('A briefing model is required to enable AI error briefing')
      ),
    [t]
  )
  const enabledModelsQuery = useQuery({
    queryKey: ['enabled-models'],
    queryFn: async () => {
      const response = await getEnabledModels()
      return response.success ? (response.data ?? []) : []
    },
  })
  const modelOptions = useMemo(
    () =>
      [...new Set(enabledModelsQuery.data ?? [])]
        .sort((left, right) => left.localeCompare(right))
        .map((model) => ({ label: model, value: model })),
    [enabledModelsQuery.data]
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(props.defaultValues),
    [props.defaultValues]
  )

  const form = useForm<
    ErrorBriefingFormInput,
    unknown,
    ErrorBriefingFormValues
  >({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })

  const baselineRef = useRef<FlatErrorBriefingDefaults>(props.defaultValues)
  const baselineSerializedRef = useRef<string>(
    JSON.stringify(props.defaultValues)
  )

  useEffect(() => {
    const serialized = JSON.stringify(props.defaultValues)
    if (serialized === baselineSerializedRef.current) return
    baselineRef.current = props.defaultValues
    baselineSerializedRef.current = serialized
    form.reset(buildFormDefaults(props.defaultValues))
  }, [props.defaultValues, form])

  const onSubmit = async (values: ErrorBriefingFormValues) => {
    const normalized = normalizeFormValues(values)
    const changedKeys = (
      Object.keys(normalized) as Array<keyof FlatErrorBriefingDefaults>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (changedKeys.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    // Enabling lands last so the model is already configured; disabling lands
    // first so clearing the model never leaves an enabled but invalid setting.
    changedKeys.sort((left, right) => {
      if (left === 'error_briefing_setting.enabled') {
        return normalized['error_briefing_setting.enabled'] ? 1 : -1
      }
      if (right === 'error_briefing_setting.enabled') {
        return normalized['error_briefing_setting.enabled'] ? -1 : 1
      }
      return 0
    })

    for (const key of changedKeys) {
      const result = await updateOption.mutateAsync({
        key,
        value: normalized[key],
      })
      if (!result.success) return
    }

    baselineRef.current = normalized
    baselineSerializedRef.current = JSON.stringify(normalized)
    form.reset(buildFormDefaults(normalized))
  }

  return (
    <SettingsSection title={t('AI Error Briefing')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='error_briefing_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable AI error briefing')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Adds a button on the error workbench that summarizes the folded fault problems into a short briefing. The briefing runs through this deployment’s own channels, so it is billed and logged like any other request. Generating one sends error text to the selected model.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='error_briefing_setting.model'
            render={({ field }) => (
              <FormItem className='max-w-sm'>
                <FormLabel>{t('Briefing model')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={modelOptions}
                    value={field.value}
                    onValueChange={(value) => field.onChange(value ?? '')}
                    placeholder={t('Select or enter model name')}
                    emptyText={t('No models found')}
                    allowCustomValue
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Summarizing is a light task, so a small fast model is usually enough. Choose a text model available through Chat Completions.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='error_briefing_setting.group'
            render={({ field }) => (
              <FormItem className='max-w-sm'>
                <FormLabel>{t('Briefing group')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder='default' />
                </FormControl>
                <FormDescription>
                  {t(
                    'The group whose routing picks the channel. Normal routing and failover apply.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='error_briefing_setting.include_raw_error_text'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Send raw upstream error text')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Off sends the fingerprint-normalized text, which already has URLs, UUIDs, and long tokens replaced by placeholders. On sends the masked original, which reads better but is upstream-controlled and may carry more detail than you want to send.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='error_briefing_setting.cache_minutes'
            render={({ field }) => (
              <FormItem className='max-w-xs'>
                <FormLabel>{t('Briefing cache duration (minutes)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={1}
                    max={120}
                    {...safeNumberFieldProps(field)}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Repeated clicks on an unchanged time window reuse the cached briefing instead of spending quota again.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='error_briefing_setting.max_problems'
            render={({ field }) => (
              <FormItem className='max-w-xs'>
                <FormLabel>{t('Problems per briefing')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={1}
                    max={60}
                    {...safeNumberFieldProps(field)}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'How many folded problems reach the model. Folding already collapses the long tail, so a low cap keeps the briefing cheap and skimmable.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
