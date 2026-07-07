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

    return (
      <Banner
        type='warning'
        icon={
          <IconAlertTriangle
            size='large'
            style={{ color: 'var(--semi-color-warning)' }}
          />
        }
        title={t('模型定价需要处理')}
        description={
          <div>
            {unsetModels.length > 0 && (
              <div>
                {t('{{count}} 个已启用模型未设置明确价格或倍率。', {
                  count: unsetModels.length,
                })}{' '}
                <Text code>{previewModels(unsetModels)}</Text>
              </div>
            )}
            {staleItems.length > 0 && (
              <div style={{ marginTop: unsetModels.length > 0 ? 8 : 0 }}>
                <Space vertical align='start'>
                  <div>
                    {t('{{count}} 个模型定价已不在任何渠道中。', {
                      count: staleItems.length,
                    })}{' '}
                    <Text code>
                      {previewModels(staleItems.map((item) => item.model))}
                    </Text>
                  </div>
                  <Button
                    size='small'
                    type='warning'
                    theme='light'
                    icon={<IconDelete />}
                    onClick={cleanupStalePricing}
                  >
                    {t('清理已不存在模型定价')}
                  </Button>
                </Space>
              </div>
            )}
          </div>
        }
        style={{ marginBottom: 16 }}
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
