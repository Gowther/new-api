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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatLogQuota, formatTimestampToDate } from '@/lib/format'

import {
  buildLogExportCsv,
  downloadLogCsv,
} from '../../../../../../shared/log-export'
import { exportLogs } from '../../api'
import type { GetLogsParams } from '../../types'

export function ExportLogsDialog(props: {
  getParams: () => GetLogsParams
  isAdmin: boolean
}) {
  const { t } = useTranslation()
  const [params, setParams] = useState<GetLogsParams | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      requestRef.current?.abort()
      requestRef.current = null
    },
    []
  )

  const close = () => {
    requestRef.current?.abort()
    setParams(null)
  }
  const start = async () => {
    if (!params || requestRef.current) return
    const request = new AbortController()
    requestRef.current = request
    setExporting(true)
    setError('')
    try {
      const text = await exportLogs(params, props.isAdmin, request.signal)
      if (request.signal.aborted) return
      const result = buildLogExportCsv(text, {
        isAdmin: props.isAdmin,
        t,
        formatQuota: formatLogQuota,
        formatTime: formatTimestampToDate,
      })
      downloadLogCsv(result.lines)
      toast.success(t('Exported {{count}} logs', { count: result.count }))
      setParams(null)
    } catch (reason) {
      if (!request.signal.aborted) {
        setError(
          reason instanceof Error ? reason.message : 'Failed to export logs'
        )
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null
        setExporting(false)
      }
    }
  }
  return (
    <>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => {
          setError('')
          setParams(props.getParams())
        }}
      >
        {t('Export CSV')}
      </Button>
      <Dialog
        open={params !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Export logs')}</DialogTitle>
            <DialogDescription>
              {t(
                'Export all logs matching the current search, up to 365 days.'
              )}
            </DialogDescription>
          </DialogHeader>
          {params?.start_timestamp && params?.end_timestamp ? (
            <p className='text-sm'>
              {formatTimestampToDate(params.start_timestamp)} —{' '}
              {formatTimestampToDate(params.end_timestamp)}
            </p>
          ) : null}
          {exporting && <p role='status'>{t('Exporting...')}</p>}
          {error && (
            <p role='alert' className='text-destructive text-sm'>
              {t(error)}
            </p>
          )}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={close}>
              {t('Cancel')}
            </Button>
            <Button type='button' disabled={exporting} onClick={start}>
              {t('Export CSV')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
