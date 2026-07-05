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
import { Modal, Tag, Typography } from '@douyinfe/semi-ui';
import { API } from '../../../helpers';
import { CHANNEL_OPTIONS } from '../../../constants';

const CHANNEL_STATUS_META = {
  0: { label: '未知', color: 'grey' },
  1: { label: '已启用', color: 'green' },
  2: { label: '手动禁用', color: 'red' },
  3: { label: '自动禁用', color: 'orange' },
};

const getChannelTypeLabel = (type) =>
  CHANNEL_OPTIONS.find((option) => option.value === type)?.label ||
  String(type ?? '');

const renderModelOverlapItems = (items, t) => {
  if (!items || items.length === 0) {
    return (
      <div className='rounded-md border border-dashed p-6 text-center'>
        <Typography.Text strong>{t('未发现模型重叠')}</Typography.Text>
        <div className='mt-1 text-sm text-gray-500'>
          {t('未发现同源渠道中重复分配的模型。')}
        </div>
      </div>
    );
  }

  return (
    <div className='max-h-[520px] space-y-3 overflow-y-auto pr-1'>
      {items.map((item) => {
        const upstreamKey = [
          item.upstream?.type,
          item.upstream?.base_url,
          item.upstream?.openai_organization,
          item.upstream?.key_fingerprint,
          item.model,
        ].join(':');
        return (
          <div key={upstreamKey} className='rounded-md border p-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <Tag color='blue'>{item.model}</Tag>
              <Typography.Text strong>
                {getChannelTypeLabel(item.upstream?.type)}
              </Typography.Text>
            </div>
            <div className='mt-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2'>
              <div>
                <span className='font-medium'>{t('真实上游')}</span>
                <span className='ml-2 break-all'>
                  {item.upstream?.base_url || t('默认端点')}
                </span>
              </div>
              <div>
                <span className='font-medium'>{t('Key 指纹')}</span>
                <span className='ml-2 font-mono'>
                  {item.upstream?.key_fingerprint || t('无 Key 指纹')}
                </span>
              </div>
              {item.upstream?.openai_organization && (
                <div className='md:col-span-2'>
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
              <Typography.Text strong>{t('其他逻辑渠道')}</Typography.Text>
              {item.channels.map((channel) => {
                const statusMeta =
                  CHANNEL_STATUS_META[channel.status] || CHANNEL_STATUS_META[0];
                return (
                  <div
                    key={channel.id}
                    className='flex flex-col gap-1 rounded-md bg-gray-50 px-3 py-2 text-sm md:flex-row md:items-center md:justify-between'
                  >
                    <span className='min-w-0 font-medium'>
                      <span className='text-gray-500'>#{channel.id}</span>{' '}
                      <span className='break-words'>{channel.name}</span>
                    </span>
                    <span className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500'>
                      <Tag size='small' color={statusMeta.color}>
                        {t(statusMeta.label)}
                      </Tag>
                      <span>
                        {t('优先级')}: {channel.priority ?? 0}
                      </span>
                      {channel.group && (
                        <span>
                          {t('分组')}: {channel.group}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const checkChannelModelOverlap = async (payload = {}) => {
  const res = await API.post('/api/channel/model_overlap', payload);
  const { success, message, data } = res.data;
  if (!success) {
    throw new Error(message || '模型重叠检查失败');
  }
  return data?.items || [];
};

export const showModelOverlapResult = (items, t) => {
  Modal.info({
    title: t('模型重叠检查'),
    content: renderModelOverlapItems(items, t),
    width: 760,
    okText: t('关闭'),
  });
};

export const confirmModelOverlap = (items, t) => {
  if (!items || items.length === 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    Modal.confirm({
      title: t('检测到模型重叠'),
      content: (
        <div className='space-y-3'>
          <Typography.Text>
            {t('这些模型已存在于同源逻辑渠道中，是否继续保存？')}
          </Typography.Text>
          {renderModelOverlapItems(items, t)}
        </div>
      ),
      width: 760,
      okText: t('继续保存'),
      cancelText: t('取消'),
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
};
