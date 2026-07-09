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

import React, { useCallback, useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Modal,
  Radio,
  RadioGroup,
  Space,
  Typography,
} from '@douyinfe/semi-ui';
import { IconAlertTriangle, IconDelete } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import ModelPricingEditor from './components/ModelPricingEditor';
import ModelRatioSettings from './ModelRatioSettings';
import { API, showError, showSuccess } from '../../../helpers';

const { Text } = Typography;

export default function ModelPricingCombined({ options, refresh }) {
  const { t } = useTranslation();
  const [editMode, setEditMode] = useState('visual');
  const [pricingHealth, setPricingHealth] = useState(null);

  const loadPricingHealth = useCallback(async () => {
    try {
      const res = await API.get('/api/models/pricing_health');
      const { success, message, data } = res.data;
      if (success) {
        setPricingHealth(data || null);
      } else {
        showError(message || t('模型定价健康检查失败'));
      }
    } catch (error) {
      showError(error?.message || t('模型定价健康检查失败'));
    }
  }, [t]);

  useEffect(() => {
    loadPricingHealth();
  }, [loadPricingHealth, options]);

  const previewModels = (models, limit = 6) => {
    const preview = models.slice(0, limit).join(', ');
    const remaining = models.length - limit;
    if (remaining <= 0) return preview;
    return `${preview}, +${remaining}`;
  };

  const cleanupStalePricing = () => {
    Modal.confirm({
      title: t('清理已不存在模型定价？'),
      content: t(
        '这会移除模型名已不在任何渠道中的定价配置，带通配符的模式配置会保留。',
      ),
      centered: true,
      okText: t('清理'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        try {
          const res = await API.post('/api/models/pricing_settings/cleanup');
          const { success, message, data } = res.data;
          if (!success) {
            showError(message || t('清理已不存在模型定价失败'));
            return Promise.reject();
          }
          showSuccess(
            t('已清理 {{count}} 个已不存在模型定价', {
              count: data?.total || 0,
            }),
          );
          await refresh?.();
          await loadPricingHealth();
        } catch (error) {
          showError(error?.message || t('清理已不存在模型定价失败'));
          return Promise.reject(error);
        }
      },
    });
  };

  const renderPricingHealthBanner = () => {
    const staleItems = pricingHealth?.stale_pricing?.items || [];
    const unsetModels = pricingHealth?.unset_pricing || [];
    if (staleItems.length === 0 && unsetModels.length === 0) {
      return null;
    }

    const staleModelNames = staleItems.map((item) => item.model);
    let title = t('模型定价需要处理');
    if (staleItems.length > 0 && unsetModels.length > 0) {
      title = t('模型定价存在失效或缺失配置');
    } else if (staleItems.length > 0) {
      title = t('{{count}} 个失效模型定价可清理', {
        count: staleItems.length,
      });
    } else {
      title = t('{{count}} 个已启用模型需要明确价格', {
        count: unsetModels.length,
      });
    }

    return (
      <Banner
        type='warning'
        closeIcon={null}
        icon={
          <IconAlertTriangle
            size='large'
            style={{ color: 'var(--semi-color-warning)' }}
          />
        }
        title={title}
        description={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {staleItems.length > 0 && (
              <div>
                <Space vertical align='start'>
                  <div>
                    {t(
                      '这些定价项引用的模型名已不在任何渠道中。清理只会移除这些失效定价，带通配符的模式配置会保留。',
                    )}
                  </div>
                  <div>
                    {t('涉及模型')}
                    {': '}
                    <Text
                      code
                      style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}
                    >
                      {previewModels(staleModelNames)}
                    </Text>
                  </div>
                  <Button
                    size='small'
                    type='warning'
                    theme='light'
                    icon={<IconDelete />}
                    onClick={cleanupStalePricing}
                  >
                    {t('清理这些失效定价')}
                  </Button>
                </Space>
              </div>
            )}
            {unsetModels.length > 0 && (
              <div>
                <Space vertical align='start'>
                  <div>
                    {t('这些已启用模型未设置明确价格、倍率或计费表达式。')}
                  </div>
                  <div>
                    {t('涉及模型')}
                    {': '}
                    <Text
                      code
                      style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}
                    >
                      {previewModels(unsetModels)}
                    </Text>
                  </div>
                </Space>
              </div>
            )}
          </div>
        }
        style={{
          marginBottom: 16,
          background: 'var(--semi-color-fill-0)',
          border: '1px solid var(--semi-color-warning-light-hover)',
          borderRadius: 6,
        }}
      />
    );
  };

  return (
    <div>
      {renderPricingHealthBanner()}
      <div style={{ marginTop: 12, marginBottom: 16 }}>
        <RadioGroup
          type='button'
          size='small'
          value={editMode}
          onChange={(e) => setEditMode(e.target.value)}
        >
          <Radio value='visual'>{t('可视化编辑')}</Radio>
          <Radio value='manual'>{t('手动编辑')}</Radio>
        </RadioGroup>
      </div>
      {editMode === 'visual' ? (
        <ModelPricingEditor options={options} refresh={refresh} />
      ) : (
        <ModelRatioSettings options={options} refresh={refresh} />
      )}
    </div>
  );
}
