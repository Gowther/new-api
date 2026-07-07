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
import { SearchCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { CHANNEL_STATUS_CONFIG } from '../../constants'
import { getChannelTypeLabel } from '../../lib'
import type { ChannelModelOverlapItem } from '../../types'

type ModelOverlapDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ChannelModelOverlapItem[]
}

type ModelOverlapConfirmDialogProps = ModelOverlapDialogProps & {
  onConfirm: () => void
  isLoading?: boolean
}

function ModelOverlapItemsList(props: { items: ChannelModelOverlapItem[] }) {
  const { t } = useTranslation()

  if (props.items.length === 0) {
    return (
      <div className='border-border/70 bg-muted/20 rounded-md border border-dashed p-6 text-center'>
        <p className='font-medium'>{t('No model overlaps found')}</p>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t(
            'No duplicated models were found for channels with the same upstream source.'
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      {props.items.map((item) => {
        if (item.warning_type === 'vendor_channel_name') {
          const warningKey = [
            'vendor_channel_name',
            item.target_name,
            item.upstream.type,
            item.upstream.base_url,
            item.upstream.openai_organization,
            item.upstream.key_fingerprint,
          ].join(':')

          return (
            <div
              key={warningKey}
              className='border-border/70 rounded-md border p-3'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>
                  {t('Vendor channel already exists')}
                </Badge>
                <span className='text-sm font-medium break-words'>
                  {item.target_name}
                </span>
              </div>

              <p className='text-muted-foreground mt-2 text-sm'>
                {t(
                  'The channel name to be created appears to match an existing vendor channel. Continuing will create another channel with the same vendor name.'
                )}
              </p>

              <div className='mt-3 space-y-2'>
                <p className='text-sm font-medium'>
                  {t('Existing matching channels')}
                </p>
                {item.channels.map((channel) => {
                  const statusConfig =
                    CHANNEL_STATUS_CONFIG[
                      channel.status as keyof typeof CHANNEL_STATUS_CONFIG
                    ] || CHANNEL_STATUS_CONFIG[0]
                  return (
                    <div
                      key={channel.id}
                      className='bg-muted/30 flex flex-col gap-1 rounded-md px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between'
                    >
                      <span className='min-w-0 font-medium'>
                        <span className='text-muted-foreground'>
                          #{channel.id}
                        </span>{' '}
                        <span className='break-words'>{channel.name}</span>
                      </span>
                      <span className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                        <span>{t(statusConfig.label)}</span>
                        <span>
                          {t('Priority')}: {channel.priority ?? 0}
                        </span>
                        {channel.group && (
                          <span>
                            {t('Group')}: {channel.group}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }

        const upstreamKey = [
          item.upstream.type,
          item.upstream.base_url,
          item.upstream.openai_organization,
          item.upstream.key_fingerprint,
          item.model,
        ].join(':')

        return (
          <div
            key={upstreamKey}
            className='border-border/70 rounded-md border p-3'
          >
            <div className='flex flex-wrap items-center gap-2'>
              <Badge variant='secondary'>{item.model}</Badge>
              <span className='text-sm font-medium'>
                {t(getChannelTypeLabel(item.upstream.type))}
              </span>
            </div>

            <div className='text-muted-foreground mt-3 grid gap-2 text-xs sm:grid-cols-2'>
              <div>
                <span className='font-medium'>{t('Real Upstream')}</span>
                <span className='ml-2 break-all'>
                  {item.upstream.base_url || t('Default endpoint')}
                </span>
              </div>
              <div>
                <span className='font-medium'>{t('Key fingerprint')}</span>
                <span className='ml-2 font-mono'>
                  {item.upstream.key_fingerprint || t('No key fingerprint')}
                </span>
              </div>
              {item.upstream.openai_organization && (
                <div className='sm:col-span-2'>
                  <span className='font-medium'>
                    {t('OpenAI Organization')}
                  </span>
                  <span className='ml-2 break-all'>
                    {item.upstream.openai_organization}
                  </span>
                </div>
              )}
            </div>

            <div className='mt-3 space-y-2'>
              <p className='text-sm font-medium'>
                {t('Other logical channels')}
              </p>
              {item.channels.map((channel) => {
                const statusConfig =
                  CHANNEL_STATUS_CONFIG[
                    channel.status as keyof typeof CHANNEL_STATUS_CONFIG
                  ] || CHANNEL_STATUS_CONFIG[0]
                return (
                  <div
                    key={channel.id}
                    className='bg-muted/30 flex flex-col gap-1 rounded-md px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between'
                  >
                    <span className='min-w-0 font-medium'>
                      <span className='text-muted-foreground'>
                        #{channel.id}
                      </span>{' '}
                      <span className='break-words'>{channel.name}</span>
                    </span>
                    <span className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                      <span>{t(statusConfig.label)}</span>
                      <span>
                        {t('Priority')}: {channel.priority ?? 0}
                      </span>
                      {channel.group && (
                        <span>
                          {t('Group')}: {channel.group}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

export function ModelOverlapDialog(props: ModelOverlapDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <SearchCheck className='h-5 w-5' />
          {t('Model Overlap Check')}
        </>
      }
      description={t(
        'Shows duplicated models assigned to logical channels sharing the same channel type, base URL, key fingerprint, and OpenAI organization.'
      )}
      titleClassName='flex items-center gap-2'
      contentClassName='max-w-3xl'
      contentHeight='min(620px, calc(100vh - 14rem))'
      bodyClassName='space-y-3'
      footer={
        <Button variant='outline' onClick={() => props.onOpenChange(false)}>
          {t('Close')}
        </Button>
      }
    >
      <ModelOverlapItemsList items={props.items} />
    </Dialog>
  )
}

export function ModelOverlapConfirmDialog(
  props: ModelOverlapConfirmDialogProps
) {
  const { t } = useTranslation()

  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Review channel save warnings')}
      desc={t(
        'Model overlaps or matching vendor channel names were found. Continue saving?'
      )}
      confirmText={t('Continue Saving')}
      isLoading={props.isLoading}
      className='max-w-3xl'
      handleConfirm={props.onConfirm}
    >
      <div className='max-h-[min(460px,calc(100vh-18rem))] space-y-3 overflow-y-auto pr-1'>
        <ModelOverlapItemsList items={props.items} />
      </div>
    </ConfirmDialog>
  )
}
