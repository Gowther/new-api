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
import { Tag } from '@douyinfe/semi-ui';
import { CHANNEL_OPTIONS } from '../../../../constants';
import { renderLimitedItems } from '../../../common/ui/RenderUtils';

const channelTypeMap = CHANNEL_OPTIONS.reduce((map, option) => {
  map[option.value] = option;
  return map;
}, {});

export const getBoundChannelTypeLabel = (type) => {
  return channelTypeMap[type]?.label || String(type ?? '');
};

export const getBoundChannelLabel = (channel) => {
  const name = channel?.name?.trim();
  const typeLabel = getBoundChannelTypeLabel(channel?.type);

  if (!name) {
    return typeLabel || '-';
  }
  if (!typeLabel) {
    return name;
  }
  return `${name} (${typeLabel})`;
};

export const renderBoundChannelList = (channels, { maxDisplay = 3 } = {}) => {
  if (!channels || channels.length === 0) return '-';

  return renderLimitedItems({
    items: channels,
    maxDisplay,
    renderItem: (channel, idx) => (
      <Tag
        key={`${channel?.name || 'channel'}-${channel?.type ?? 'unknown'}-${idx}`}
        color='white'
        size='small'
        shape='circle'
      >
        {getBoundChannelLabel(channel)}
      </Tag>
    ),
  });
};
