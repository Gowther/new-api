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
import i18next from 'i18next'
import { useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { parseHttpStatusCodeRules } from '@/lib/http-status-code-rules'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const numericString = z.string().refine((value) => {
  const trimmed = value.trim()
  if (!trimmed) return true
  return !Number.isNaN(Number(trimmed)) && Number(trimmed) >= 0
}, 'Enter a non-negative number or leave empty')

const channelTestModes = ['scheduled_all', 'passive_recovery'] as const
type ChannelTestMode = (typeof channelTestModes)[number]
const channelTestPromptModes = ['fixed', 'random'] as const
type ChannelTestPromptMode = (typeof channelTestPromptModes)[number]
const defaultChannelTestPrompt =
  'Explain in one short sentence why caching can reduce latency.'

function normalizeChannelTestPromptLines(value: string) {
  return Array.from(
    new Set(
      normalizeLineEndings(value)
        .split('\n')
        .map((prompt) => prompt.trim())
        .filter(Boolean)
    )
  )
}

function parseChannelTestPrompts(value?: string) {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    if (Array.isArray(parsed)) {
      const prompts = parsed.filter(
        (prompt): prompt is string => typeof prompt === 'string'
      )
      const normalized = normalizeChannelTestPromptLines(prompts.join('\n'))
      if (normalized.length > 0) return normalized
    }
  } catch {
    // Fall through to the upgrade-safe default.
  }
  return [defaultChannelTestPrompt]
}

function resolveChannelTestPrompt(prompts: string[], selected?: string) {
  if (selected && prompts.includes(selected)) return selected
  return prompts[0] ?? defaultChannelTestPrompt
}

const routingReliabilitySchema = z
  .object({
    RetryTimes: z.coerce.number().min(0).max(10),
    ChannelDisableThreshold: numericString,
    AutomaticDisableChannelEnabled: z.boolean(),
    AutomaticEnableChannelEnabled: z.boolean(),
    AutomaticDisableKeywords: z.string(),
    AutomaticDisableStatusCodes: z.string(),
    AutomaticRetryStatusCodes: z.string(),
    monitor_setting: z.object({
      auto_test_channel_enabled: z.boolean(),
      auto_test_channel_minutes: z.coerce
        .number()
        .int()
        .min(1, 'Interval must be at least 1 minute'),
      channel_test_mode: z.enum(channelTestModes),
      channel_test_prompts: z.string(),
      channel_test_prompt_mode: z.enum(channelTestPromptModes),
      channel_test_prompt: z.string(),
    }),
  })
  .superRefine((values, ctx) => {
    const disableParsed = parseHttpStatusCodeRules(
      values.AutomaticDisableStatusCodes
    )
    if (!disableParsed.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['AutomaticDisableStatusCodes'],
        message: `Invalid status code rules: ${disableParsed.invalidTokens.join(
          ', '
        )}`,
      })
    }

    const retryParsed = parseHttpStatusCodeRules(
      values.AutomaticRetryStatusCodes
    )
    if (!retryParsed.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['AutomaticRetryStatusCodes'],
        message: `Invalid status code rules: ${retryParsed.invalidTokens.join(
          ', '
        )}`,
      })
    }

    if (
      normalizeChannelTestPromptLines(
        values.monitor_setting.channel_test_prompts
      ).length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['monitor_setting', 'channel_test_prompts'],
        message: i18next.t('At least one test prompt is required'),
      })
    }
  })

type RoutingReliabilityFormValues = z.output<typeof routingReliabilitySchema>
type RoutingReliabilityFormInput = z.input<typeof routingReliabilitySchema>

type RoutingReliabilitySectionProps = {
  defaultValues: {
    RetryTimes: number
    ChannelDisableThreshold: string
    AutomaticDisableChannelEnabled: boolean
    AutomaticEnableChannelEnabled: boolean
    AutomaticDisableKeywords: string
    AutomaticDisableStatusCodes: string
    AutomaticRetryStatusCodes: string
    'monitor_setting.auto_test_channel_enabled': boolean
    'monitor_setting.auto_test_channel_minutes': number
    'monitor_setting.channel_test_mode': ChannelTestMode
    'monitor_setting.channel_test_prompts': string
    'monitor_setting.channel_test_prompt_mode': ChannelTestPromptMode
    'monitor_setting.channel_test_prompt': string
  }
}

function normalizeLineEndings(value: string) {
  return value.replaceAll('\r\n', '\n')
}

type NormalizedRoutingReliabilityValues = {
  RetryTimes: number
  ChannelDisableThreshold: string
  AutomaticDisableChannelEnabled: boolean
  AutomaticEnableChannelEnabled: boolean
  AutomaticDisableKeywords: string
  AutomaticDisableStatusCodes: string
  AutomaticRetryStatusCodes: string
  'monitor_setting.auto_test_channel_enabled': boolean
  'monitor_setting.auto_test_channel_minutes': number
  'monitor_setting.channel_test_mode': ChannelTestMode
  'monitor_setting.channel_test_prompts': string
  'monitor_setting.channel_test_prompt_mode': ChannelTestPromptMode
  'monitor_setting.channel_test_prompt': string
}

function normalizeChannelTestMode(value?: string): ChannelTestMode {
  return value === 'passive_recovery' ? 'passive_recovery' : 'scheduled_all'
}

function normalizeChannelTestPromptMode(value?: string): ChannelTestPromptMode {
  return value === 'random' ? 'random' : 'fixed'
}

const buildFormDefaults = (
  defaults: RoutingReliabilitySectionProps['defaultValues']
): RoutingReliabilityFormInput => {
  const prompts = parseChannelTestPrompts(
    defaults['monitor_setting.channel_test_prompts']
  )
  return {
    RetryTimes: defaults.RetryTimes ?? 0,
    ChannelDisableThreshold: defaults.ChannelDisableThreshold ?? '',
    AutomaticDisableChannelEnabled: defaults.AutomaticDisableChannelEnabled,
    AutomaticEnableChannelEnabled: defaults.AutomaticEnableChannelEnabled,
    AutomaticDisableKeywords: normalizeLineEndings(
      defaults.AutomaticDisableKeywords ?? ''
    ),
    AutomaticDisableStatusCodes: defaults.AutomaticDisableStatusCodes ?? '',
    AutomaticRetryStatusCodes: defaults.AutomaticRetryStatusCodes ?? '',
    monitor_setting: {
      auto_test_channel_enabled:
        defaults['monitor_setting.auto_test_channel_enabled'],
      auto_test_channel_minutes:
        defaults['monitor_setting.auto_test_channel_minutes'],
      channel_test_mode: normalizeChannelTestMode(
        defaults['monitor_setting.channel_test_mode']
      ),
      channel_test_prompts: prompts.join('\n'),
      channel_test_prompt_mode: normalizeChannelTestPromptMode(
        defaults['monitor_setting.channel_test_prompt_mode']
      ),
      channel_test_prompt: resolveChannelTestPrompt(
        prompts,
        defaults['monitor_setting.channel_test_prompt']
      ),
    },
  }
}

const normalizeDefaults = (
  defaults: RoutingReliabilitySectionProps['defaultValues']
): NormalizedRoutingReliabilityValues => {
  const prompts = parseChannelTestPrompts(
    defaults['monitor_setting.channel_test_prompts']
  )
  return {
    RetryTimes: defaults.RetryTimes ?? 0,
    ChannelDisableThreshold: (defaults.ChannelDisableThreshold ?? '').trim(),
    AutomaticDisableChannelEnabled: defaults.AutomaticDisableChannelEnabled,
    AutomaticEnableChannelEnabled: defaults.AutomaticEnableChannelEnabled,
    AutomaticDisableKeywords: normalizeLineEndings(
      defaults.AutomaticDisableKeywords ?? ''
    ),
    AutomaticDisableStatusCodes: parseHttpStatusCodeRules(
      defaults.AutomaticDisableStatusCodes ?? ''
    ).normalized,
    AutomaticRetryStatusCodes: parseHttpStatusCodeRules(
      defaults.AutomaticRetryStatusCodes ?? ''
    ).normalized,
    'monitor_setting.auto_test_channel_enabled':
      defaults['monitor_setting.auto_test_channel_enabled'],
    'monitor_setting.auto_test_channel_minutes':
      defaults['monitor_setting.auto_test_channel_minutes'],
    'monitor_setting.channel_test_mode': normalizeChannelTestMode(
      defaults['monitor_setting.channel_test_mode']
    ),
    'monitor_setting.channel_test_prompts': JSON.stringify(prompts),
    'monitor_setting.channel_test_prompt_mode': normalizeChannelTestPromptMode(
      defaults['monitor_setting.channel_test_prompt_mode']
    ),
    'monitor_setting.channel_test_prompt': resolveChannelTestPrompt(
      prompts,
      defaults['monitor_setting.channel_test_prompt']
    ),
  }
}

const normalizeFormValues = (
  values: RoutingReliabilityFormValues
): NormalizedRoutingReliabilityValues => {
  const prompts = normalizeChannelTestPromptLines(
    values.monitor_setting.channel_test_prompts
  )
  return {
    RetryTimes: values.RetryTimes,
    ChannelDisableThreshold: values.ChannelDisableThreshold.trim(),
    AutomaticDisableChannelEnabled: values.AutomaticDisableChannelEnabled,
    AutomaticEnableChannelEnabled: values.AutomaticEnableChannelEnabled,
    AutomaticDisableKeywords: normalizeLineEndings(
      values.AutomaticDisableKeywords
    ),
    AutomaticDisableStatusCodes: parseHttpStatusCodeRules(
      values.AutomaticDisableStatusCodes
    ).normalized,
    AutomaticRetryStatusCodes: parseHttpStatusCodeRules(
      values.AutomaticRetryStatusCodes
    ).normalized,
    'monitor_setting.auto_test_channel_enabled':
      values.monitor_setting.auto_test_channel_enabled,
    'monitor_setting.auto_test_channel_minutes':
      values.monitor_setting.auto_test_channel_minutes,
    'monitor_setting.channel_test_mode':
      values.monitor_setting.channel_test_mode,
    'monitor_setting.channel_test_prompts': JSON.stringify(prompts),
    'monitor_setting.channel_test_prompt_mode':
      values.monitor_setting.channel_test_prompt_mode,
    'monitor_setting.channel_test_prompt': resolveChannelTestPrompt(
      prompts,
      values.monitor_setting.channel_test_prompt
    ),
  }
}

export function RoutingReliabilitySection({
  defaultValues,
}: RoutingReliabilitySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<NormalizedRoutingReliabilityValues>(
    normalizeDefaults(defaultValues)
  )

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<
    RoutingReliabilityFormInput,
    unknown,
    RoutingReliabilityFormValues
  >({
    resolver: zodResolver(routingReliabilitySchema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const autoDisableStatusCodes = form.watch('AutomaticDisableStatusCodes')
  const autoRetryStatusCodes = form.watch('AutomaticRetryStatusCodes')
  const channelTestMode = form.watch('monitor_setting.channel_test_mode')
  const channelTestPromptMode = form.watch(
    'monitor_setting.channel_test_prompt_mode'
  )
  const channelTestPromptText = form.watch(
    'monitor_setting.channel_test_prompts'
  )
  const channelTestPrompts = useMemo(
    () => normalizeChannelTestPromptLines(channelTestPromptText),
    [channelTestPromptText]
  )
  const autoDisableParsed = useMemo(
    () => parseHttpStatusCodeRules(autoDisableStatusCodes),
    [autoDisableStatusCodes]
  )
  const autoRetryParsed = useMemo(
    () => parseHttpStatusCodeRules(autoRetryStatusCodes),
    [autoRetryStatusCodes]
  )

  const onSubmit = async (values: RoutingReliabilityFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof NormalizedRoutingReliabilityValues>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      const value = normalized[key]
      await updateOption.mutateAsync({
        key,
        value,
      })
    }

    baselineRef.current = normalized
  }

  return (
    <SettingsSection title={t('Routing Reliability')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />

          <div className='flex min-w-0 flex-col gap-4'>
            <div className='flex flex-col gap-1'>
              <h4 className='text-sm font-medium'>{t('Request retry')}</h4>
            </div>
            <div className='grid min-w-0 gap-6 xl:grid-cols-[minmax(12rem,24rem)_minmax(0,1fr)]'>
              <FormField
                control={form.control}
                name='RetryTimes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Retry Times')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min='0'
                        max='10'
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Number of times to retry failed requests (0-10)')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='AutomaticRetryStatusCodes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Auto-retry status codes')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('e.g. 401, 403, 429, 500-599')}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Accepts comma-separated status codes and inclusive ranges.'
                      )}{' '}
                      {autoRetryParsed.ok &&
                        autoRetryParsed.normalized &&
                        autoRetryParsed.normalized !== field.value.trim() && (
                          <span className='text-muted-foreground'>
                            {t('Normalized:')} {autoRetryParsed.normalized}
                          </span>
                        )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <Separator />

          <div className='flex min-w-0 flex-col gap-4'>
            <div className='flex flex-col gap-1'>
              <h4 className='text-sm font-medium'>
                {t('Channel health checks')}
              </h4>
            </div>
            <div className='grid min-w-0 gap-6 lg:grid-cols-3'>
              <FormField
                control={form.control}
                name='monitor_setting.auto_test_channel_enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Scheduled channel tests')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Automatically probe all channels in the background'
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
                name='monitor_setting.channel_test_mode'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Channel test mode')}</FormLabel>
                    <Select
                      items={[
                        {
                          value: 'scheduled_all',
                          label: t('Scheduled full test'),
                        },
                        {
                          value: 'passive_recovery',
                          label: t('Passive recovery only'),
                        },
                      ]}
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
                          <SelectItem value='scheduled_all'>
                            {t('Scheduled full test')}
                          </SelectItem>
                          <SelectItem value='passive_recovery'>
                            {t('Passive recovery only')}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {t(
                        'Scheduled full test probes non-manually-disabled channels; passive recovery only checks auto-disabled channels after real request failures.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='monitor_setting.auto_test_channel_minutes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Test interval (minutes)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={1}
                        step={1}
                        {...safeNumberFieldProps(field)}
                      />
                    </FormControl>
                    <FormDescription>
                      {channelTestMode === 'passive_recovery'
                        ? t(
                            'Default frequency for checking auto-disabled channels for recovery; channel-specific overrides can run sooner or later'
                          )
                        : t(
                            'Default frequency for scheduled channel tests; channel-specific overrides can run sooner or later'
                          )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='AutomaticEnableChannelEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Re-enable on success')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Bring channels back online after successful checks'
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
            </div>

            <div className='flex min-w-0 flex-col gap-4 pt-2'>
              <div className='flex flex-col gap-1'>
                <h5 className='text-sm font-medium'>{t('Test prompts')}</h5>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Used only for text-generation channel tests, not regular user chats.'
                  )}
                </p>
              </div>
              <div className='grid min-w-0 gap-6 lg:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='monitor_setting.channel_test_prompts'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Prompt list')}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={6}
                          placeholder={t('One prompt per line')}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Chat Completions, Claude, Gemini, and Responses channel tests use this list.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='flex min-w-0 flex-col gap-6'>
                  <FormField
                    control={form.control}
                    name='monitor_setting.channel_test_prompt_mode'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Prompt selection mode')}</FormLabel>
                        <Select
                          items={[
                            { value: 'fixed', label: t('Fixed prompt') },
                            { value: 'random', label: t('Random prompt') },
                          ]}
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
                              <SelectItem value='fixed'>
                                {t('Fixed prompt')}
                              </SelectItem>
                              <SelectItem value='random'>
                                {t('Random prompt')}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          {channelTestPromptMode === 'random'
                            ? t('Choose one configured prompt for each test.')
                            : t('Always use the selected prompt.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {channelTestPromptMode === 'fixed' && (
                    <FormField
                      control={form.control}
                      name='monitor_setting.channel_test_prompt'
                      render={({ field }) => {
                        const selectedPrompt = resolveChannelTestPrompt(
                          channelTestPrompts,
                          field.value
                        )
                        return (
                          <FormItem>
                            <FormLabel>{t('Fixed prompt')}</FormLabel>
                            <Select
                              items={channelTestPrompts.map((prompt) => ({
                                value: prompt,
                                label: prompt,
                              }))}
                              value={selectedPrompt}
                              onValueChange={field.onChange}
                              disabled={channelTestPrompts.length === 0}
                            >
                              <FormControl>
                                <SelectTrigger className='min-w-0'>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectGroup>
                                  {channelTestPrompts.map((prompt) => (
                                    <SelectItem key={prompt} value={prompt}>
                                      {prompt}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              {t('Select the prompt used in fixed mode.')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className='flex min-w-0 flex-col gap-4'>
            <div className='flex flex-col gap-1'>
              <h4 className='text-sm font-medium'>{t('Auto-disable rules')}</h4>
            </div>
            <div className='grid min-w-0 gap-6 lg:grid-cols-2'>
              <FormField
                control={form.control}
                name='AutomaticDisableChannelEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Disable on failure')}</FormLabel>
                      <FormDescription>
                        {t('Automatically disable channels when tests fail')}
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
                name='ChannelDisableThreshold'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Disable threshold (seconds)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step={1}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Automatically disable channels exceeding this response time'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='AutomaticDisableStatusCodes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Auto-disable status codes')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('e.g. 401, 403, 429, 500-599')}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Accepts comma-separated status codes and inclusive ranges.'
                      )}{' '}
                      {autoDisableParsed.ok &&
                        autoDisableParsed.normalized &&
                        autoDisableParsed.normalized !== field.value.trim() && (
                          <span className='text-muted-foreground'>
                            {t('Normalized:')} {autoDisableParsed.normalized}
                          </span>
                        )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='AutomaticDisableKeywords'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Failure keywords')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={6}
                        placeholder={t('one keyword per line')}
                        {...field}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'If an upstream error contains any of these keywords (case insensitive), the channel will be disabled automatically.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
