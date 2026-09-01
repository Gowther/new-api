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

import React, { useEffect, useRef, useState } from 'react';
import { Button, Col, Form, Row, Spin } from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  selectFilter,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const DEFAULT_INPUTS = {
  'error_briefing_setting.enabled': false,
  'error_briefing_setting.group': 'default',
  'error_briefing_setting.model': '',
  'error_briefing_setting.include_raw_error_text': false,
  'error_briefing_setting.cache_minutes': 5,
  'error_briefing_setting.max_problems': 20,
};

export default function SettingsErrorBriefing(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [inputsRow, setInputsRow] = useState(inputs);
  const [enabledModels, setEnabledModels] = useState([]);
  const refForm = useRef();

  const enabled = inputs['error_briefing_setting.enabled'];

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    if (enabled && !String(inputs['error_briefing_setting.model']).trim()) {
      return showError(t('启用 AI 简报前需要先选择简报模型'));
    }

    // 开启时最后保存开关，关闭时先保存开关，避免中间状态无模型却仍启用。
    const ordered = [...updateArray].sort((left, right) => {
      if (left.key === 'error_briefing_setting.enabled') {
        return enabled ? 1 : -1;
      }
      if (right.key === 'error_briefing_setting.enabled') {
        return enabled ? -1 : 1;
      }
      return 0;
    });

    setLoading(true);
    ordered
      .reduce(
        (chain, item) =>
          chain.then(() =>
            API.put('/api/option/', {
              key: item.key,
              value:
                typeof inputs[item.key] === 'boolean'
                  ? String(inputs[item.key])
                  : inputs[item.key],
            }).then((response) => {
              if (!response.data.success) {
                throw new Error(response.data.message || t('保存失败，请重试'));
              }
            }),
          ),
        Promise.resolve(),
      )
      .then(() => {
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch((error) => {
        showError(error?.message || t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    const currentInputs = { ...DEFAULT_INPUTS };
    for (let key in props.options) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_INPUTS, key)) {
        currentInputs[key] = props.options[key];
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current?.setValues(currentInputs);
  }, [props.options]);

  useEffect(() => {
    let active = true;
    API.get('/api/channel/models_enabled')
      .then((response) => {
        if (!active) return;
        if (response.data.success) {
          setEnabledModels(response.data.data || []);
        } else {
          showError(response.data.message || t('获取启用模型失败'));
        }
      })
      .catch((error) => {
        if (active) showError(error);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const modelOptions = Array.from(
    new Set([
      ...enabledModels,
      String(inputs['error_briefing_setting.model'] || ''),
    ]),
  )
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((model) => ({ label: model, value: model }));

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('AI 错误简报')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'error_briefing_setting.enabled'}
                  label={t('启用 AI 错误简报')}
                  extraText={t(
                    '在错误排障工作台上增加一个按钮，把折叠后的问题总结成一段简报。简报走本部署自己的渠道，因此会像普通请求一样计费和记日志。生成时会把错误文本发送给所选模型。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'error_briefing_setting.enabled': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Select
                  // 受控 Select 配合 allowCreate 时，Semi 会在 optionList 变化的
                  // 同一次更新里用旧的 options 覆盖新收集到的列表，导致异步拿到的
                  // 模型全部丢失。按列表长度重建字段，让它挂载时就拿到完整列表。
                  key={modelOptions.length}
                  field={'error_briefing_setting.model'}
                  label={t('简报模型')}
                  placeholder={t('选择或输入模型名称')}
                  optionList={modelOptions}
                  filter={selectFilter}
                  allowCreate
                  showClear
                  extraText={t(
                    '总结是轻量任务，小而快的模型通常就够用。请选择可通过 Chat Completions 使用的文本模型。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'error_briefing_setting.model': value || '',
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Input
                  field={'error_briefing_setting.group'}
                  label={t('简报分组')}
                  placeholder='default'
                  extraText={t(
                    '用哪个分组的路由来选渠道。正常的路由和故障转移逻辑照常生效。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'error_briefing_setting.group': value,
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'error_briefing_setting.include_raw_error_text'}
                  label={t('发送原始上游错误文本')}
                  extraText={t(
                    '关闭时发送指纹归一化后的文本，其中的 URL、UUID 和长 token 已被替换成占位符。开启时发送掩码后的原文，可读性更好，但内容由上游决定，可能包含你并不想外发的细节。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'error_briefing_setting.include_raw_error_text': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'error_briefing_setting.cache_minutes'}
                  label={t('简报缓存时长（分钟）')}
                  min={1}
                  max={120}
                  extraText={t(
                    '在时间窗没有变化时重复点击会复用缓存的简报，而不是再花一次额度。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'error_briefing_setting.cache_minutes': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  field={'error_briefing_setting.max_problems'}
                  label={t('每份简报的问题数上限')}
                  min={1}
                  max={60}
                  extraText={t(
                    '有多少个折叠后的问题会进入提示词。折叠本身已经收敛了长尾，因此上限设低一些可以让简报更便宜、更好读。',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'error_briefing_setting.max_problems': value,
                    })
                  }
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
