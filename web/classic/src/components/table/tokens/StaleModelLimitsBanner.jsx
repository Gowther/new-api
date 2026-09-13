/*
Copyright (C) 2025 QuantumNous

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

import React, { useEffect, useState } from 'react';
import { Banner, Button, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../helpers';

// 提醒当前用户令牌模型限制中已无任何启用渠道提供的模型。
// 失效条目本身无危害且模型回归后自动生效，因此只提醒 + 手动清理，绝不自动删除。
const StaleModelLimitsBanner = ({ onChanged, t }) => {
  const [report, setReport] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [cleaningId, setCleaningId] = useState(null);

  const loadReport = async () => {
    try {
      const res = await API.get('/api/token/stale_model_limits');
      const { success, message, data } = res.data || {};
      if (success) {
        setReport(data || { stale_models: [], tokens: [] });
      } else {
        showError(message || t('加载失效模型信息失败'));
      }
    } catch (e) {
      showError(e.message || t('加载失效模型信息失败'));
    }
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dismissed || !report || !report.tokens || report.tokens.length === 0) {
    return null;
  }

  const handleCleanup = async (tokenId) => {
    setCleaningId(tokenId);
    try {
      const res = await API.post('/api/token/stale_model_limits/cleanup', {
        ids: [tokenId],
      });
      const { success, message } = res.data || {};
      if (success) {
        showSuccess(t('已从该令牌移除失效模型'));
        await loadReport();
        onChanged?.();
      } else {
        showError(message || t('移除失效模型失败'));
      }
    } catch (e) {
      showError(e.message || t('移除失效模型失败'));
    } finally {
      setCleaningId(null);
    }
  };

  return (
    <Banner
      type='warning'
      className='!rounded-lg mb-3'
      title={t('令牌模型限制中存在已无渠道提供的模型')}
      description={
        <div className='flex flex-col gap-2'>
          <Typography.Text type='tertiary' size='small'>
            {t(
              '以下模型已无任何启用渠道提供。条目已保留，渠道恢复提供后自动生效，可按需手动移除。',
            )}
          </Typography.Text>
          <div className='flex flex-wrap gap-1.5'>
            {report.stale_models.map((model) => (
              <span
                key={model}
                className='rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-xs break-all dark:border-gray-700 dark:bg-gray-800'
              >
                {model}
              </span>
            ))}
          </div>
          <div className='flex flex-col gap-1.5'>
            {report.tokens.map((token) => (
              <div
                key={token.token_id}
                className='flex flex-wrap items-center justify-between gap-2'
              >
                <Typography.Text
                  small
                  ellipsis={{ showTooltip: true }}
                  style={{ maxWidth: 420 }}
                >
                  {token.token_name}
                  <Typography.Text type='tertiary'>
                    {' '}
                    · {token.stale_models.join(', ')}
                  </Typography.Text>
                </Typography.Text>
                <Button
                  size='small'
                  theme='light'
                  loading={cleaningId === token.token_id}
                  onClick={() => handleCleanup(token.token_id)}
                >
                  {t('移除失效模型')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      }
      onClose={() => setDismissed(true)}
    />
  );
};

export default StaleModelLimitsBanner;
