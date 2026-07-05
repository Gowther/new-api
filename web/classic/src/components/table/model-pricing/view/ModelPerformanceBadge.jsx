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
import { Tag, Tooltip } from '@douyinfe/semi-ui';

const formatSuccessRate = (value) => {
  const rate = Number(value);
  if (!Number.isFinite(rate)) {
    return '-';
  }
  return `${rate.toFixed(1)}%`;
};

const getSuccessRateColor = (value) => {
  const rate = Number(value);
  if (!Number.isFinite(rate)) {
    return 'white';
  }
  if (rate >= 99) {
    return 'green';
  }
  if (rate >= 95) {
    return 'yellow';
  }
  return 'red';
};

const ModelPerformanceBadge = ({
  perf,
  t,
  showLabel = true,
  showEmpty = false,
  fallback = null,
}) => {
  const rawSuccessRate = perf?.success_rate;
  const successRate =
    rawSuccessRate == null ? Number.NaN : Number(rawSuccessRate);
  if (!Number.isFinite(successRate)) {
    if (showEmpty) {
      const label = showLabel ? `${t('成功率')} -` : '-';
      return (
        <Tooltip content={`${t('成功率')}：-`}>
          <Tag color='white' shape='circle' size='small'>
            {label}
          </Tag>
        </Tooltip>
      );
    }
    return fallback;
  }

  const formattedRate = formatSuccessRate(successRate);
  const label = showLabel ? `${t('成功率')} ${formattedRate}` : formattedRate;

  return (
    <Tooltip content={`${t('成功率')}：${formattedRate}`}>
      <Tag color={getSuccessRateColor(successRate)} shape='circle' size='small'>
        {label}
      </Tag>
    </Tooltip>
  );
};

export default ModelPerformanceBadge;
