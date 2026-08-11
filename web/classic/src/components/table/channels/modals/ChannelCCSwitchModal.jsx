/*
Copyright (C) 2025 QuantumNous

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
import React, { useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';

import SecureVerificationModal from '../../../common/modals/SecureVerificationModal';
import { useSecureVerification } from '../../../../hooks/common/useSecureVerification';
import { createApiCalls } from '../../../../services/secureVerification';
import { selectFilter, showError } from '../../../../helpers';
import {
  buildCCSwitchURL,
  CC_SWITCH_APP_CONFIGS,
  getCCSwitchModelOptions,
  getRecommendedCCSwitchApp,
} from '../../../../helpers/ccSwitch';

export default function ChannelCCSwitchModal({ visible, onClose, channel }) {
  const { t } = useTranslation();
  const [app, setApp] = useState('codex');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [models, setModels] = useState({});
  const [loading, setLoading] = useState(false);
  const verification = useSecureVerification();

  const modelConfig = useMemo(
    () =>
      getCCSwitchModelOptions(
        channel?.models,
        channel?.model_mapping,
        channel?.test_model,
      ),
    [channel?.models, channel?.model_mapping, channel?.test_model],
  );
  const currentConfig = CC_SWITCH_APP_CONFIGS[app];

  useEffect(() => {
    if (!visible || !channel) return;
    setApp(getRecommendedCCSwitchApp(channel.type));
    setName(channel.name || '');
    setEndpoint(channel.base_url || '');
    setModels({ model: modelConfig.defaultModel });
  }, [visible, channel, modelConfig.defaultModel]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Toast.warning(t('请输入名称'));
      return;
    }
    if (!models.model) {
      Toast.warning(t('请选择主模型'));
      return;
    }
    if (channel?.channel_info?.is_multi_key) {
      Toast.warning(t('多密钥渠道暂不支持导出到 CC Switch'));
      return;
    }

    const fetchAndOpen = async () => {
      const response = await createApiCalls.viewChannelKey(channel.id)();
      const data = response?.data;
      if (!response?.success || !data?.key) {
        throw new Error(response?.message || t('获取渠道密钥失败'));
      }

      const rawKey = data.key.trim();
      if (
        data.is_multi_key ||
        rawKey.includes('\n') ||
        rawKey.startsWith('{') ||
        rawKey.startsWith('[')
      ) {
        throw new Error(t('该渠道使用的凭证格式暂不支持导入 CC Switch'));
      }

      const resolvedEndpoint = endpoint.trim() || data.base_url?.trim();
      if (!resolvedEndpoint) {
        throw new Error(t('该渠道未配置上游地址'));
      }
      const url = buildCCSwitchURL({
        app,
        name: name || data.name || channel.name,
        models,
        apiKey: rawKey,
        endpoint: resolvedEndpoint,
        homepage: resolvedEndpoint,
      });
      window.location.href = url;
      onClose();
      return response;
    };

    setLoading(true);
    try {
      await verification.withVerification(fetchAndOpen, {
        preferredMethod: 'passkey',
        title: t('验证后导出渠道'),
        description: t('请先验证身份再导出渠道上游密钥。'),
      });
    } catch (error) {
      showError(error.message || t('导出失败'));
    } finally {
      setLoading(false);
    }
  };

  const labelStyle = { marginBottom: 4, fontSize: 13 };

  return (
    <>
      <Modal
        title={t('导出渠道到 CC Switch')}
        visible={visible}
        onCancel={onClose}
        onOk={handleSubmit}
        okText={t('打开 CC Switch')}
        cancelText={t('取消')}
        confirmLoading={loading}
        maskClosable={false}
        width={520}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Banner
            type='warning'
            closeIcon={null}
            description={t('直接连接上游会绕过 New API 的路由、计费和日志。')}
          />

          <div>
            <div style={labelStyle}>{t('应用')}</div>
            <RadioGroup
              type='button'
              value={app}
              onChange={(event) => {
                setApp(event.target.value);
                setModels({ model: modelConfig.defaultModel });
              }}
            >
              {Object.entries(CC_SWITCH_APP_CONFIGS).map(([key, config]) => (
                <Radio key={key} value={key}>
                  {config.label}
                </Radio>
              ))}
            </RadioGroup>
          </div>

          <div>
            <div style={labelStyle}>{t('名称')}</div>
            <Input value={name} onChange={setName} />
          </div>

          <div>
            <div style={labelStyle}>{t('上游地址')}</div>
            <Input
              value={endpoint}
              onChange={setEndpoint}
              placeholder={t('留空时使用渠道默认上游地址')}
            />
          </div>

          {currentConfig.modelFields.map((field) => (
            <div key={field.key}>
              <div style={labelStyle}>
                {t(field.labelKey)}
                {field.required && (
                  <Typography.Text type='danger'> *</Typography.Text>
                )}
              </div>
              <Select
                placeholder={t('请选择模型')}
                optionList={modelConfig.options}
                value={models[field.key] || undefined}
                onChange={(value) =>
                  setModels((previous) => ({
                    ...previous,
                    [field.key]: value,
                  }))
                }
                filter={selectFilter}
                style={{ width: '100%' }}
                showClear
                searchable
                allowCreate
                emptyContent={t('暂无数据')}
              />
            </div>
          ))}
        </div>
      </Modal>

      <SecureVerificationModal
        visible={verification.isModalVisible}
        verificationMethods={verification.verificationMethods}
        verificationState={verification.verificationState}
        onVerify={verification.executeVerification}
        onCancel={verification.cancelVerification}
        onCodeChange={verification.setVerificationCode}
        onMethodSwitch={verification.switchVerificationMethod}
        title={verification.verificationState.title}
        description={verification.verificationState.description}
      />
    </>
  );
}
