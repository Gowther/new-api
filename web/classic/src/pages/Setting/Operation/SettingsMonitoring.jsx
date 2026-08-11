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

import React, { useEffect, useState, useRef } from 'react';
import { Button, Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  parseHttpStatusCodeRules,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';
import HttpStatusCodeRulesInput from '../../../components/settings/HttpStatusCodeRulesInput';

const DEFAULT_CHANNEL_TEST_PROMPT =
  'Explain in one short sentence why caching can reduce latency.';

const normalizeChannelTestPromptText = (value) =>
  Array.from(
    new Set(
      (value || '')
        .replaceAll('\r\n', '\n')
        .split('\n')
        .map((prompt) => prompt.trim())
        .filter(Boolean),
    ),
  );

const parseChannelTestPrompts = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    if (Array.isArray(parsed)) {
      const prompts = normalizeChannelTestPromptText(
        parsed.filter((prompt) => typeof prompt === 'string').join('\n'),
      );
      if (prompts.length > 0) return prompts;
    }
  } catch {
    // Fall through to the upgrade-safe default.
  }
  return [DEFAULT_CHANNEL_TEST_PROMPT];
};

const DEFAULT_INPUTS = {
  ChannelDisableThreshold: '',
  QuotaRemindThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  'monitor_setting.channel_test_mode': 'scheduled_all',
  'monitor_setting.channel_test_prompts': DEFAULT_CHANNEL_TEST_PROMPT,
  'monitor_setting.channel_test_prompt_mode': 'fixed',
  'monitor_setting.channel_test_prompt': DEFAULT_CHANNEL_TEST_PROMPT,
};

export default function SettingsMonitoring(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);
  const channelTestMode =
    inputs['monitor_setting.channel_test_mode'] || 'scheduled_all';
  const channelTestPromptMode =
    inputs['monitor_setting.channel_test_prompt_mode'] || 'fixed';
  const channelTestPrompts = normalizeChannelTestPromptText(
    inputs['monitor_setting.channel_test_prompts'],
  );
  const selectedChannelTestPrompt = channelTestPrompts.includes(
    inputs['monitor_setting.channel_test_prompt'],
  )
    ? inputs['monitor_setting.channel_test_prompt']
    : channelTestPrompts[0];
  const parsedAutoDisableStatusCodes = parseHttpStatusCodeRules(
    inputs.AutomaticDisableStatusCodes || '',
  );
  const parsedAutoRetryStatusCodes = parseHttpStatusCodeRules(
    inputs.AutomaticRetryStatusCodes || '',
  );

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    if (!parsedAutoDisableStatusCodes.ok) {
      const details =
        parsedAutoDisableStatusCodes.invalidTokens &&
        parsedAutoDisableStatusCodes.invalidTokens.length > 0
          ? `: ${parsedAutoDisableStatusCodes.invalidTokens.join(', ')}`
          : '';
      return showError(`${t('自动禁用状态码格式不正确')}${details}`);
    }
    if (!parsedAutoRetryStatusCodes.ok) {
      const details =
        parsedAutoRetryStatusCodes.invalidTokens &&
        parsedAutoRetryStatusCodes.invalidTokens.length > 0
          ? `: ${parsedAutoRetryStatusCodes.invalidTokens.join(', ')}`
          : '';
      return showError(`${t('自动重试状态码格式不正确')}${details}`);
    }
    if (channelTestPrompts.length === 0) {
      return showError(t('至少需要一条测活提示词'));
    }
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (typeof inputs[item.key] === 'boolean') {
        value = String(inputs[item.key]);
      } else {
        const normalizedMap = {
          AutomaticDisableStatusCodes: parsedAutoDisableStatusCodes.normalized,
          AutomaticRetryStatusCodes: parsedAutoRetryStatusCodes.normalized,
          'monitor_setting.channel_test_prompts':
            JSON.stringify(channelTestPrompts),
          'monitor_setting.channel_test_prompt': selectedChannelTestPrompt,
        };
        value = normalizedMap[item.key] ?? inputs[item.key];
      }
      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    const currentInputs = { ...DEFAULT_INPUTS };
    for (let key in props.options) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_INPUTS, key)) {
        currentInputs[key] =
          key === 'monitor_setting.channel_test_prompts'
            ? parseChannelTestPrompts(props.options[key]).join('\n')
            : props.options[key];
      }
    }
    const prompts = normalizeChannelTestPromptText(
      currentInputs['monitor_setting.channel_test_prompts'],
    );
    if (
      !prompts.includes(currentInputs['monitor_setting.channel_test_prompt'])
    ) {
      currentInputs['monitor_setting.channel_test_prompt'] = prompts[0];
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current?.setValues(currentInputs);
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('监控设置')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'monitor_setting.auto_test_channel_enabled'}
                  label={t('定时测试通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.auto_test_channel_enabled': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Select
                  field={'monitor_setting.channel_test_mode'}
                  label={t('渠道测试模式')}
                  optionList={[
                    {
                      label: t('定时全量测试'),
                      value: 'scheduled_all',
                    },
                    {
                      label: t('仅被动恢复'),
                      value: 'passive_recovery',
                    },
                  ]}
                  extraText={t(
                    '定时全量测试会探测非手动禁用的渠道；仅被动恢复只会在真实请求失败导致渠道自动禁用后检查这些渠道是否可恢复。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.channel_test_mode': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('自动测试通道间隔时间')}
                  step={1}
                  min={1}
                  suffix={t('分钟')}
                  extraText={
                    channelTestMode === 'passive_recovery'
                      ? t(
                          '系统检查自动禁用渠道是否可恢复的默认频率，渠道可单独覆盖',
                        )
                      : t('系统测试所有渠道的默认频率，渠道可单独覆盖')
                  }
                  placeholder={''}
                  field={'monitor_setting.auto_test_channel_minutes'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.auto_test_channel_minutes':
                        parseInt(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={14} md={14} lg={14} xl={14}>
                <Form.TextArea
                  label={t('测活提示词列表')}
                  placeholder={t('一行一条提示词')}
                  extraText={t(
                    '仅用于文本生成渠道测活，不会用于普通用户聊天；Chat Completions、Claude、Gemini 和 Responses 测活会使用此列表。',
                  )}
                  field={'monitor_setting.channel_test_prompts'}
                  autosize={{ minRows: 5, maxRows: 12 }}
                  onChange={(value) => {
                    const prompts = normalizeChannelTestPromptText(value);
                    const selected = prompts.includes(
                      inputs['monitor_setting.channel_test_prompt'],
                    )
                      ? inputs['monitor_setting.channel_test_prompt']
                      : prompts[0] || '';
                    setInputs({
                      ...inputs,
                      'monitor_setting.channel_test_prompts': value,
                      'monitor_setting.channel_test_prompt': selected,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={10} md={10} lg={10} xl={10}>
                <Form.Select
                  field={'monitor_setting.channel_test_prompt_mode'}
                  label={t('提示词选择模式')}
                  optionList={[
                    { label: t('固定提示词'), value: 'fixed' },
                    { label: t('随机提示词'), value: 'random' },
                  ]}
                  extraText={
                    channelTestPromptMode === 'random'
                      ? t('每次测活从列表中随机选择一条')
                      : t('每次测活都使用指定提示词')
                  }
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.channel_test_prompt_mode': value,
                    })
                  }
                />
                {channelTestPromptMode === 'fixed' && (
                  <Form.Select
                    field={'monitor_setting.channel_test_prompt'}
                    label={t('指定提示词')}
                    optionList={channelTestPrompts.map((prompt) => ({
                      label: prompt,
                      value: prompt,
                    }))}
                    value={selectedChannelTestPrompt}
                    disabled={channelTestPrompts.length === 0}
                    extraText={t('固定模式下使用的提示词')}
                    onChange={(value) =>
                      setInputs({
                        ...inputs,
                        'monitor_setting.channel_test_prompt': value,
                      })
                    }
                  />
                )}
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('测试所有渠道的最长响应时间')}
                  step={1}
                  min={0}
                  suffix={t('秒')}
                  extraText={t(
                    '当运行通道全部测试时，超过此时间将自动禁用通道',
                  )}
                  placeholder={''}
                  field={'ChannelDisableThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      ChannelDisableThreshold: String(value),
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('额度提醒阈值')}
                  step={1}
                  min={0}
                  suffix={'Token'}
                  extraText={t('低于此额度时将发送邮件提醒用户')}
                  placeholder={''}
                  field={'QuotaRemindThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      QuotaRemindThreshold: String(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'AutomaticDisableChannelEnabled'}
                  label={t('失败时自动禁用通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      AutomaticDisableChannelEnabled: value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'AutomaticEnableChannelEnabled'}
                  label={t('成功时自动启用通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      AutomaticEnableChannelEnabled: value,
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <HttpStatusCodeRulesInput
                  label={t('自动禁用状态码')}
                  placeholder={t('例如：401, 403, 429, 500-599')}
                  extraText={t(
                    '支持填写单个状态码或范围（含首尾），使用逗号分隔',
                  )}
                  field={'AutomaticDisableStatusCodes'}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticDisableStatusCodes: value })
                  }
                  parsed={parsedAutoDisableStatusCodes}
                  invalidText={t('自动禁用状态码格式不正确')}
                />
                <HttpStatusCodeRulesInput
                  label={t('自动重试状态码')}
                  placeholder={t('例如：401, 403, 429, 500-599')}
                  extraText={t(
                    '支持填写单个状态码或范围（含首尾），使用逗号分隔；504 和 524 始终不重试，不受此处配置影响',
                  )}
                  field={'AutomaticRetryStatusCodes'}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticRetryStatusCodes: value })
                  }
                  parsed={parsedAutoRetryStatusCodes}
                  invalidText={t('自动重试状态码格式不正确')}
                />
                <Form.TextArea
                  label={t('自动禁用关键词')}
                  placeholder={t('一行一个，不区分大小写')}
                  extraText={t(
                    '当上游通道返回错误中包含这些关键词时（不区分大小写），自动禁用通道',
                  )}
                  field={'AutomaticDisableKeywords'}
                  autosize={{ minRows: 6, maxRows: 12 }}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticDisableKeywords: value })
                  }
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存监控设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
