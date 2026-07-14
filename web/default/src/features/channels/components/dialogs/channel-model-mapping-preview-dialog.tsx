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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import type { ChannelModelMappingPreview } from '../../types'

type ChannelModelMappingPreviewDialogProps = {
  open: boolean
  preview: ChannelModelMappingPreview | null
  isApplying?: boolean
  onOpenChange: (open: boolean) => void
  onApply: (preview: ChannelModelMappingPreview) => void
}

function formatModelNames(models: string[]) {
  return models.length > 0 ? models.join(', ') : '-'
}

export function ChannelModelMappingPreviewDialog(
  props: ChannelModelMappingPreviewDialogProps
) {
  const { t } = useTranslation()
  const preview = props.preview

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Smart Model Mapping Preview')}
      description={t(
        'Review the model list and mapping changes before applying them to this channel form.'
      )}
      contentClassName='sm:max-w-3xl'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.isApplying}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => preview && props.onApply(preview)}
            disabled={!preview?.has_changes || props.isApplying}
          >
            {t('Apply to Form')}
          </Button>
        </>
      }
    >
      {!preview ? null : (
        <div className='space-y-4'>
          {preview.has_conflicts && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'Conflicting mapping rules were not applied. Adjust the channel mapping manually and preview again.'
                )}
              </AlertDescription>
            </Alert>
          )}

          {!preview.has_changes && !preview.has_conflicts && (
            <Alert>
              <AlertDescription>
                {t('No matching model mapping rules were found.')}
              </AlertDescription>
            </Alert>
          )}

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='rounded-md border p-3'>
              <p className='text-muted-foreground text-xs font-medium'>
                {t('Removed Models')}
              </p>
              <p className='mt-1 break-all text-sm'>
                {formatModelNames(preview.removed_models)}
              </p>
            </div>
            <div className='rounded-md border p-3'>
              <p className='text-muted-foreground text-xs font-medium'>
                {t('Added Models')}
              </p>
              <p className='mt-1 break-all text-sm'>
                {formatModelNames(preview.added_models)}
              </p>
            </div>
          </div>

          <StaticDataTable
            data={preview.changes}
            emptyClassName='text-muted-foreground py-8'
            emptyContent={t('No matching model mapping rules were found.')}
            columns={[
              {
                id: 'upstream-model',
                header: t('Upstream Model'),
                cellClassName: 'font-mono text-xs',
                cell: (change) => change.upstream_model,
              },
              {
                id: 'exposed-model',
                header: t('Exposed Model'),
                cellClassName: 'font-mono text-xs',
                cell: (change) => (
                  <div className='flex items-center gap-1'>
                    <span>{change.exposed_model}</span>
                    <ArrowRight className='h-3.5 w-3.5 text-muted-foreground' />
                    <span>{change.upstream_model}</span>
                  </div>
                ),
              },
              {
                id: 'rule',
                header: t('Rule'),
                cell: (change) =>
                  `${t(change.match_mode === 'exact' ? 'Exact Match' : 'Contains')} · ${change.match_value}`,
              },
              {
                id: 'status',
                header: t('Status'),
                cell: (change) =>
                  change.status === 'applied'
                    ? t('Ready to Apply')
                    : t('Conflict'),
              },
            ]}
          />
        </div>
      )}
    </Dialog>
  )
}
