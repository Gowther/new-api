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
import { Button, Form, InputNumber, Select } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';

import { DATE_RANGE_PRESETS } from '../../../constants/console.constants';

/** 「最近」窗口的单位选项，值是分钟数。 */
const RECENT_UNITS = [
  { value: 'minute', minutes: 1, labelKey: '分钟' },
  { value: 'hour', minutes: 60, labelKey: '小时' },
  { value: 'day', minutes: 1440, labelKey: '天' },
];

/** 把分钟数拆成最大的整单位展示（90 分钟显示 90 分钟，120 分钟显示 2 小时）。 */
function splitRecentMinutes(minutes) {
  for (let i = RECENT_UNITS.length - 1; i >= 0; i--) {
    const unit = RECENT_UNITS[i];
    if (minutes % unit.minutes === 0) {
      return { amount: minutes / unit.minutes, unit: unit.value };
    }
  }
  return { amount: minutes, unit: 'minute' };
}

const LogsFilters = ({
  formInitValues,
  setFormApi,
  refresh,
  setShowColumnSelector,
  resetFilters,
  timeRange,
  handleTimeModeChange,
  handleRecentValueChange,
  handleDateRangeChange,
  loading,
  isAdminUser,
  t,
}) => {
  const recent = splitRecentMinutes(timeRange.recentMinutes || 60);

  const handleRecentUnitChange = (nextUnit) => {
    const unit = RECENT_UNITS.find((item) => item.value === nextUnit);
    if (!unit) return;
    // 切单位时把当前分钟数换算成新单位下的整数，窗口尽量贴近原值
    const amount = Math.max(
      1,
      Math.round((timeRange.recentMinutes || 60) / unit.minutes),
    );
    handleRecentValueChange(amount, nextUnit);
  };

  return (
    <Form
      initValues={formInitValues}
      getFormApi={(api) => setFormApi(api)}
      onSubmit={() => refresh()}
      allowEmpty={true}
      autoComplete='off'
      layout='vertical'
      trigger='change'
      stopValidateWithError={false}
    >
      <div className='flex flex-col gap-2'>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2'>
          {/* 时间选择器 */}
          <div className='col-span-1 lg:col-span-2 flex flex-col sm:flex-row gap-2 min-w-0'>
            <div className='flex gap-2 shrink-0'>
              <Select
                aria-label={t('时间范围')}
                size='small'
                className='w-full sm:w-36 shrink-0'
                value={timeRange.timeMode}
                onChange={(value) => handleTimeModeChange(value)}
                optionList={[
                  { value: 'today', label: t('今天') },
                  { value: 'recent', label: t('最近') },
                  { value: 'fixed', label: t('自定义时间') },
                ]}
              />
              {timeRange.timeMode === 'recent' && (
                <>
                  <InputNumber
                    aria-label={t('最近时长')}
                    size='small'
                    min={1}
                    precision={0}
                    value={recent.amount}
                    onChange={(value) =>
                      handleRecentValueChange(value, recent.unit)
                    }
                    className='w-24 shrink-0'
                  />
                  <Select
                    aria-label={t('时间单位')}
                    size='small'
                    className='w-24 shrink-0'
                    value={recent.unit}
                    onChange={handleRecentUnitChange}
                    optionList={RECENT_UNITS.map((unit) => ({
                      value: unit.value,
                      label: t(unit.labelKey),
                    }))}
                  />
                </>
              )}
            </div>
            <Form.DatePicker
              field='dateRange'
              className='w-full'
              type='dateTimeRange'
              placeholder={[t('开始时间'), t('结束时间')]}
              showClear
              pure
              size='small'
              presets={DATE_RANGE_PRESETS.map((preset) => ({
                text: t(preset.text),
                start: preset.start,
                end: preset.text === '今天' ? () => new Date() : preset.end,
                timeMode: preset.text === '今天' ? 'today' : 'fixed',
              }))}
              onPresetClick={(preset) =>
                handleTimeModeChange(preset.timeMode, false)
              }
              onChange={handleDateRangeChange}
            />
          </div>

          {/* 其他搜索字段 */}
          <Form.Input
            field='token_name'
            prefix={<IconSearch />}
            placeholder={t('令牌名称')}
            showClear
            pure
            size='small'
          />

          <Form.Input
            field='model_name'
            prefix={<IconSearch />}
            placeholder={t('模型名称')}
            showClear
            pure
            size='small'
          />

          <Form.Input
            field='group'
            prefix={<IconSearch />}
            placeholder={t('分组')}
            showClear
            pure
            size='small'
          />

          <Form.Input
            field='request_id'
            prefix={<IconSearch />}
            placeholder={t('Request ID')}
            showClear
            pure
            size='small'
          />

          <Form.Input
            field='upstream_request_id'
            prefix={<IconSearch />}
            placeholder={t('Upstream Request ID')}
            showClear
            pure
            size='small'
          />

          {isAdminUser && (
            <>
              <Form.Input
                field='channel'
                prefix={<IconSearch />}
                placeholder={t('渠道 ID')}
                showClear
                pure
                size='small'
              />
              <Form.Input
                field='username'
                prefix={<IconSearch />}
                placeholder={t('用户名称')}
                showClear
                pure
                size='small'
              />
            </>
          )}
        </div>

        {/* 操作按钮区域 */}
        <div className='flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3'>
          {/* 日志类型选择器 */}
          <div className='w-full sm:w-auto flex gap-2'>
            <Form.Select
              field='logType'
              placeholder={t('日志类型')}
              className='w-full sm:w-auto min-w-[120px]'
              showClear
              pure
              onChange={() => {
                // 延迟执行搜索，让表单值先更新
                setTimeout(() => {
                  refresh();
                }, 0);
              }}
              size='small'
            >
              <Form.Select.Option value='0'>{t('全部')}</Form.Select.Option>
              <Form.Select.Option value='1'>{t('充值')}</Form.Select.Option>
              <Form.Select.Option value='2'>{t('消费')}</Form.Select.Option>
              <Form.Select.Option value='3'>{t('管理')}</Form.Select.Option>
              <Form.Select.Option value='4'>{t('系统')}</Form.Select.Option>
              <Form.Select.Option value='5'>{t('错误')}</Form.Select.Option>
              <Form.Select.Option value='6'>{t('退款')}</Form.Select.Option>
            </Form.Select>
            {/* 结果筛选与成功率统计同口径：失败 = 错误日志 + 零 token 消费日志 */}
            <Form.Select
              field='result'
              placeholder={t('请求结果')}
              className='w-full sm:w-auto min-w-[120px]'
              showClear
              pure
              onChange={() => {
                setTimeout(() => {
                  refresh();
                }, 0);
              }}
              size='small'
            >
              <Form.Select.Option value=''>{t('全部')}</Form.Select.Option>
              <Form.Select.Option value='success'>
                {t('成功')}
              </Form.Select.Option>
              <Form.Select.Option value='failed'>
                {t('失败')}
              </Form.Select.Option>
            </Form.Select>
          </div>

          <div className='flex gap-2 w-full sm:w-auto justify-end'>
            <Button
              type='tertiary'
              htmlType='submit'
              loading={loading}
              size='small'
            >
              {t('查询')}
            </Button>
            <Button type='tertiary' onClick={resetFilters} size='small'>
              {t('重置')}
            </Button>
            <Button
              type='tertiary'
              onClick={() => setShowColumnSelector(true)}
              size='small'
            >
              {t('列设置')}
            </Button>
          </div>
        </div>
      </div>
    </Form>
  );
};

export default LogsFilters;
