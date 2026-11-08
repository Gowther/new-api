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
import { useTranslation } from 'react-i18next'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { PriceChange } from '../../../../../shared/price-changes'

export function PriceChangeReview(props: { changes: PriceChange[] }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    ModelPrice: t('Model fixed pricing'),
    ModelRatio: t('Model ratio'),
    CacheRatio: t('Prompt cache ratio'),
    CreateCacheRatio: t('Create cache ratio'),
    CompletionRatio: t('Completion ratio'),
    ImageRatio: t('Image ratio'),
    AudioRatio: t('Audio ratio'),
    AudioCompletionRatio: t('Audio completion ratio'),
    BillingMode: t('Billing mode'),
    BillingExpr: t('Billing expression'),
    ModelPriceReference: t('Price references'),
    ExposeRatioEnabled: t('Expose ratio API'),
  }
  return (
    <div className='max-h-[60vh] overflow-auto'>
      <Table aria-label={t('Review price changes')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Model')}</TableHead>
            <TableHead>{t('Setting')}</TableHead>
            <TableHead>{t('Before')}</TableHead>
            <TableHead>{t('After')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.changes.map((change) => (
            <TableRow key={`${change.field}:${change.model}`}>
              <TableCell className='max-w-48 break-words whitespace-normal'>
                {change.model || '—'}
              </TableCell>
              <TableCell>{labels[change.field] || change.field}</TableCell>
              {[change.before, change.after].map((value, index) => (
                <TableCell
                  key={index === 0 ? 'before' : 'after'}
                  className='max-w-64 font-mono break-words whitespace-pre-wrap'
                >
                  {value === undefined ? t('Not set') : String(value)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
