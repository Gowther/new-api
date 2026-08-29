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

import React from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import { API } from '../../../helpers';

/** Long model lists are summarized so the prompt stays readable. */
const MAX_LISTED_MODELS = 6;

/**
 * Ask which temporary targets enabling this channel would release. Writes
 * nothing, so it is safe to run while opening the confirmation prompt.
 */
export const fetchRoutingOverrideConflicts = async (channelId) => {
  const res = await API.get('/api/channel/model_routing_override/conflicts', {
    params: { channel_id: channelId },
  });
  const { success, message, data } = res?.data || {};
  if (!success) {
    throw new Error(message || '加载临时路由冲突失败');
  }
  return Array.isArray(data) ? data : [];
};

/**
 * Names the channels that confirming would release, so the operator decides with
 * the overlap in front of them instead of reading it back from a failure.
 */
export const renderRoutingOverrideConflicts = (conflicts, t) => {
  if (!conflicts || conflicts.length === 0) return null;

  return (
    <div className='mt-3 space-y-2 rounded-md border border-[var(--semi-color-warning)] p-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Tag color='orange' shape='circle' size='small'>
          {t('模型冲突')}
        </Tag>
        <Typography.Text strong>
          {t('已有 {{count}} 个渠道固定了其中部分模型', {
            count: conflicts.length,
          })}
        </Typography.Text>
      </div>
      <Typography.Text type='tertiary' size='small' className='block'>
        {t(
          '继续操作会关闭它们的临时单渠道模式，包括它们覆盖但此渠道不支持的模型。',
        )}
      </Typography.Text>
      <div className='max-h-64 space-y-2 overflow-y-auto pr-1'>
        {conflicts.map((conflict) => {
          const models = conflict.models || [];
          const listed = models.slice(0, MAX_LISTED_MODELS);
          const remaining = models.length - listed.length;
          return (
            <div
              key={conflict.channel_id}
              className='rounded-md bg-[var(--semi-color-fill-0)] px-3 py-2'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <Typography.Text strong className='break-words'>
                  {conflict.channel_name || `#${conflict.channel_id}`}
                </Typography.Text>
                <Typography.Text type='tertiary' size='small'>
                  ID:{conflict.channel_id}
                </Typography.Text>
              </div>
              <div className='mt-1 font-mono text-xs break-words text-[var(--semi-color-text-2)]'>
                {listed.join(', ')}
                {remaining > 0
                  ? ` ${t('以及另外 {{count}} 个', { count: remaining })}`
                  : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
