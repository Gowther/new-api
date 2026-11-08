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
import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, Typography } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import {
  API,
  renderQuota,
  timestamp2string,
  showSuccess,
} from '../../../../helpers';
import {
  buildLogExportCsv,
  downloadLogCsv,
} from '../../../../../../shared/log-export';

export default function ExportLogsModal({ getExportParams, isAdminUser }) {
  const { t } = useTranslation();
  const [params, setParams] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(null);
  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [],
  );
  const close = () => {
    requestRef.current?.abort();
    setParams(null);
  };
  const start = async () => {
    if (!params || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    setExporting(true);
    setError('');
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '')
          query.set(key, String(value));
      }
      const path = isAdminUser ? '/api/log/export' : '/api/log/self/export';
      const response = await API.get(`${path}?${query}`, {
        responseType: 'text',
        signal: request.signal,
        timeout: 0,
        disableDuplicate: true,
        skipErrorHandler: true,
      });
      if (request.signal.aborted) return;
      const result = buildLogExportCsv(response.data, {
        isAdmin: isAdminUser,
        t,
        formatQuota: (quota) => renderQuota(quota, 6),
        formatTime: timestamp2string,
      });
      downloadLogCsv(result.lines);
      showSuccess(t('Exported {{count}} logs', { count: result.count }));
      setParams(null);
    } catch (reason) {
      if (!request.signal.aborted)
        setError(reason.message || 'Failed to export logs');
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setExporting(false);
      }
    }
  };
  return (
    <>
      <Button
        size='small'
        onClick={() => {
          setError('');
          setParams(getExportParams());
        }}
      >
        {t('Export CSV')}
      </Button>
      <Modal
        title={t('Export logs')}
        visible={params !== null}
        onCancel={close}
        onOk={start}
        okText={t('Export CSV')}
        cancelText={t('取消')}
        confirmLoading={exporting}
        okButtonProps={{ disabled: exporting }}
        maskClosable={false}
      >
        <p>
          {t('Export all logs matching the current search, up to 365 days.')}
        </p>
        {params?.start_timestamp && params?.end_timestamp ? (
          <p>
            {timestamp2string(params.start_timestamp)} —{' '}
            {timestamp2string(params.end_timestamp)}
          </p>
        ) : null}
        {exporting && <p role='status'>{t('Exporting...')}</p>}
        {error && (
          <Typography.Text type='danger' role='alert'>
            {t(error)}
          </Typography.Text>
        )}
      </Modal>
    </>
  );
}
