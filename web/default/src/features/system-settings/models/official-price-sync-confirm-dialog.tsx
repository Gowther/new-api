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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  getOfficialPriceFieldLabelKey,
  type SavedOfficialPriceComparison,
} from './official-price-sync-diff'

type OfficialPriceSyncConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  comparison: SavedOfficialPriceComparison
  onConfirm: () => void
  isLoading?: boolean
}

function formatOfficialPriceValue(
  value: string | number | boolean | null | undefined
): string {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

export function OfficialPriceSyncConfirmDialog(
  props: OfficialPriceSyncConfirmDialogProps
) {
  const { t } = useTranslation()
  const hasChanges = props.comparison.changes.length > 0

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.isLoading) props.onOpenChange(open)
      }}
      title={t('Review official price changes')}
      description={t(
        'The following saved mappings have price changes. Confirm to synchronize them.'
      )}
      contentClassName='sm:max-w-5xl'
      contentHeight='min(70vh, 640px)'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={props.isLoading}
          >
            {t('Cancel')}
          </Button>
          {hasChanges ? (
            <Button onClick={props.onConfirm} disabled={props.isLoading}>
              {props.isLoading ? t('Syncing...') : t('Confirm and Sync')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <p className='text-muted-foreground text-sm'>
          {t(
            '{{changed}} model(s) will change, {{unchanged}} unchanged, {{skipped}} without an available official price.',
            {
              changed: props.comparison.changes.length,
              unchanged: props.comparison.unchangedCount,
              skipped: props.comparison.skippedCount,
            }
          )}
        </p>

        {hasChanges ? (
          <div className='max-h-96 overflow-y-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Model')}</TableHead>
                  <TableHead>{t('Official source')}</TableHead>
                  <TableHead>{t('Changed pricing fields')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.comparison.changes.map((change) => (
                  <TableRow key={change.modelName}>
                    <TableCell className='font-mono text-sm'>
                      {change.modelName}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-col gap-1 text-sm'>
                        <Badge variant='outline' className='w-fit'>
                          {change.source}
                        </Badge>
                        <span className='break-all'>
                          {change.upstreamModel}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className='flex min-w-[18rem] flex-col gap-1.5'>
                        {change.fields.map((field) => (
                          <div
                            key={field.field}
                            className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'
                          >
                            <Badge variant='secondary'>
                              {t(getOfficialPriceFieldLabelKey(field.field))}
                            </Badge>
                            <span className='font-mono'>
                              {formatOfficialPriceValue(field.current)}
                            </span>
                            <span className='text-muted-foreground'>→</span>
                            <span className='font-mono'>
                              {formatOfficialPriceValue(field.official)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t('No saved official price changes found')}
          </p>
        )}
      </div>
    </Dialog>
  )
}
