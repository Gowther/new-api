/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { ArrowRightLeft, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { getChannelKey } from '@/features/channels/api'
import {
  buildCCSwitchURL,
  CC_SWITCH_APP_CONFIGS,
  getCCSwitchModelOptions,
  getRecommendedCCSwitchApp,
  type CCSwitchApp,
} from '@/lib/cc-switch'

import type { Channel } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel: Channel
}

export function ChannelCCSwitchDialog({ open, onOpenChange, channel }: Props) {
  const { t } = useTranslation()
  const [app, setApp] = useState<CCSwitchApp>('codex')
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [models, setModels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const verification = useSecureVerification()

  const modelConfig = useMemo(
    () =>
      getCCSwitchModelOptions(
        channel.models,
        channel.model_mapping,
        channel.test_model
      ),
    [channel.models, channel.model_mapping, channel.test_model]
  )
  const currentConfig = CC_SWITCH_APP_CONFIGS[app]

  useEffect(() => {
    if (!open) return
    const recommendedApp = getRecommendedCCSwitchApp(channel.type)
    setApp(recommendedApp)
    setName(channel.name)
    setEndpoint(channel.base_url ?? '')
    setModels({ model: modelConfig.defaultModel })
  }, [open, channel, modelConfig.defaultModel])

  const handleAppChange = (value: string) => {
    const nextApp = value as CCSwitchApp
    setApp(nextApp)
    setModels({ model: modelConfig.defaultModel })
  }

  const fetchAndOpen = async () => {
    const response = await getChannelKey(channel.id)
    const data = response.data
    if (!response.success || !data?.key) {
      throw new Error(response.message || t('Failed to fetch channel key'))
    }

    const rawKey = data.key.trim()
    if (
      data.is_multi_key ||
      rawKey.includes('\n') ||
      rawKey.startsWith('{') ||
      rawKey.startsWith('[')
    ) {
      throw new Error(
        t('This channel credential format is not supported by CC Switch')
      )
    }

    const resolvedEndpoint = endpoint.trim() || data.base_url?.trim()
    if (!resolvedEndpoint) {
      throw new Error(t('This channel has no configured upstream endpoint'))
    }
    const url = buildCCSwitchURL({
      app,
      name: name || data.name || channel.name,
      models,
      apiKey: rawKey,
      endpoint: resolvedEndpoint,
      homepage: resolvedEndpoint,
    })
    window.location.href = url
    onOpenChange(false)
    return response
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.warning(t('Please enter a name'))
      return
    }
    if (!models.model?.trim()) {
      toast.warning(t('Please select a primary model'))
      return
    }
    if (channel.channel_info?.is_multi_key) {
      toast.warning(t('Multi-key channels cannot be exported to CC Switch yet'))
      return
    }

    setLoading(true)
    try {
      await verification.withVerification(fetchAndOpen, {
        preferredMethod: 'passkey',
        title: t('Verify to export channel'),
        description: t(
          'Confirm your identity before exporting this channel upstream key.'
        ),
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Export failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('Export channel to CC Switch')}
        contentClassName='sm:max-w-lg'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t('Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <ArrowRightLeft className='size-4' />
              )}
              {t('Open CC Switch')}
            </Button>
          </>
        }
      >
        <div className='space-y-4'>
          <div className='flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <span>
              {t(
                'Direct upstream connection; New API routing, billing, and logs will be bypassed.'
              )}
            </span>
          </div>

          <div className='space-y-2'>
            <Label>{t('Application')}</Label>
            <RadioGroup
              value={app}
              onValueChange={handleAppChange}
              className='flex gap-4'
            >
              {(
                Object.entries(CC_SWITCH_APP_CONFIGS) as [
                  CCSwitchApp,
                  (typeof CC_SWITCH_APP_CONFIGS)[CCSwitchApp],
                ][]
              ).map(([key, config]) => (
                <div key={key} className='flex items-center gap-2'>
                  <RadioGroupItem
                    value={key}
                    id={`channel-ccswitch-app-${key}`}
                  />
                  <Label
                    htmlFor={`channel-ccswitch-app-${key}`}
                    className='cursor-pointer'
                  >
                    {config.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='channel-ccswitch-name'>{t('Name')}</Label>
            <Input
              id='channel-ccswitch-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='channel-ccswitch-endpoint'>
              {t('Upstream Endpoint')}
            </Label>
            <Input
              id='channel-ccswitch-endpoint'
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={t('Use the channel default endpoint')}
            />
          </div>

          {currentConfig.modelFields.map((field) => (
            <div key={field.key} className='space-y-2'>
              <Label>
                {t(field.labelKey)}
                {field.required && (
                  <span className='ml-0.5 text-destructive'>*</span>
                )}
              </Label>
              <ComboboxInput
                options={modelConfig.options}
                value={models[field.key] || ''}
                onValueChange={(value) =>
                  setModels((previous) => ({ ...previous, [field.key]: value }))
                }
                placeholder={t('Select or enter model name')}
                emptyText={t('No models found')}
                allowCustomValue
              />
            </div>
          ))}
        </div>
      </Dialog>

      <SecureVerificationDialog
        open={verification.open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) verification.cancel()
        }}
        methods={verification.methods}
        state={verification.state}
        onVerify={verification.executeVerification}
        onCancel={verification.cancel}
        onCodeChange={verification.setCode}
        onMethodChange={verification.switchMethod}
      />
    </>
  )
}
