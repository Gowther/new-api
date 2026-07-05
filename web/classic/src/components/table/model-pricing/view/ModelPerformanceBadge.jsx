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

const signalBars = [{ height: 5 }, { height: 8 }, { height: 11 }];

const toFiniteRate = (value) => {
  if (value == null || value === '') {
    return Number.NaN;
  }
  const rate = Number(value);
  return Number.isFinite(rate) ? rate : Number.NaN;
};

const formatSuccessRate = (value) => {
  const rate = toFiniteRate(value);
  if (!Number.isFinite(rate)) {
    return '-';
  }
  return `${rate.toFixed(1)}%`;
};

const getSuccessRateColor = (value) => {
  const rate = toFiniteRate(value);
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

const getSignalColor = (value) => {
  const rate = toFiniteRate(value);
  if (!Number.isFinite(rate)) {
    return 'var(--semi-color-fill-1)';
  }
  if (rate >= 99) {
    return 'var(--semi-color-success)';
  }
  if (rate >= 95) {
    return 'var(--semi-color-warning)';
  }
  return 'var(--semi-color-danger)';
};

const getSignalRates = (perf, successRate) => {
  const recentRates =
    perf?.recent_success_rates?.map(toFiniteRate).filter(Number.isFinite) ?? [];
  const rates =
    recentRates.length > 0
      ? recentRates.slice(-3)
      : Number.isFinite(successRate)
        ? [successRate]
        : [];
  return [...Array(Math.max(0, 3 - rates.length)).fill(null), ...rates].slice(
    -3,
  );
};

const SuccessRateSignal = ({ rates }) => {
  return (
    <span aria-hidden={true} className='inline-flex h-3.5 items-end gap-0.5'>
      {signalBars.map((bar, index) => {
        const rate = rates[index];
        return (
          <span
            key={index}
            className='w-1 rounded-sm'
            style={{
              height: bar.height,
              backgroundColor: getSignalColor(rate),
              opacity: rate == null ? 0.55 : 1,
            }}
          />
        );
      })}
    </span>
  );
};

const ModelPerformanceBadge = ({
  perf,
  t,
  showLabel = true,
  showEmpty = false,
  fallback = null,
}) => {
  const rawSuccessRate = perf?.success_rate;
  const successRate = toFiniteRate(rawSuccessRate);
  if (!Number.isFinite(successRate)) {
    if (showEmpty) {
      const label = showLabel ? `${t('成功率')} -` : '-';
      return (
        <Tooltip content={`${t('成功率')}：-`}>
          <Tag color='white' shape='circle' size='small'>
            <span className='inline-flex items-center gap-1.5'>
              <SuccessRateSignal rates={getSignalRates(perf, successRate)} />
              <span>{label}</span>
            </span>
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
        <span className='inline-flex items-center gap-1.5'>
          <SuccessRateSignal rates={getSignalRates(perf, successRate)} />
          <span>{label}</span>
        </span>
      </Tag>
    </Tooltip>
  );
};

export default ModelPerformanceBadge;
