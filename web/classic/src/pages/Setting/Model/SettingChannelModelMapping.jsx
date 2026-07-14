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
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconDelete, IconEdit, IconPlus, IconPlay } from '@douyinfe/semi-icons';

import { API, showError, showInfo, showSuccess } from '../../../helpers';

const { Text } = Typography;
const OPTION_KEY = 'channel_model_mapping_setting.rules';

const emptyRule = {
  match_mode: 'contains',
  match_value: '',
  case_sensitive: false,
  exposed_model: '',
  priority: 0,
  enabled: true,
};

const parseRules = (rawValue) => {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((rule) => rule && typeof rule === 'object')
      : [];
  } catch {
    return [];
  }
};

const normalizeRule = (rule) => ({
  match_mode: rule.match_mode === 'exact' ? 'exact' : 'contains',
  match_value: String(rule.match_value || '').trim(),
  case_sensitive: Boolean(rule.case_sensitive),
  exposed_model: String(rule.exposed_model || '').trim(),
  priority: Number(rule.priority || 0),
  enabled: rule.enabled !== false,
});

const SettingChannelModelMapping = (props) => {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [draftRule, setDraftRule] = useState(emptyRule);
  const [editorVisible, setEditorVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testModel, setTestModel] = useState('');
  const [testPreview, setTestPreview] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setRules(parseRules(props.options?.[OPTION_KEY]).map(normalizeRule));
  }, [props.options]);

  const columns = useMemo(
    () => [
      {
        title: t('匹配方式'),
        dataIndex: 'match_mode',
        render: (value, record) => (
          <Space vertical spacing={2} align='start'>
            <Tag color='blue'>
              {value === 'exact' ? t('完全匹配') : t('包含匹配')}
            </Tag>
            <Text size='small' type='tertiary'>
              {record.case_sensitive ? t('区分大小写') : t('忽略大小写')}
            </Text>
          </Space>
        ),
      },
      {
        title: t('匹配内容'),
        dataIndex: 'match_value',
        render: (value) => <code>{value}</code>,
      },
      {
        title: t('对外模型名'),
        dataIndex: 'exposed_model',
        render: (value) => <code>{value}</code>,
      },
      {
        title: t('优先级'),
        dataIndex: 'priority',
      },
      {
        title: t('启用'),
        dataIndex: 'enabled',
        render: (value) => (
          <Tag color={value ? 'green' : 'grey'}>
            {value ? t('是') : t('否')}
          </Tag>
        ),
      },
      {
        title: t('操作'),
        render: (_value, _record, index) => (
          <Space>
            <Button
              theme='borderless'
              icon={<IconEdit />}
              onClick={() => {
                setEditingIndex(index);
                setDraftRule(normalizeRule(rules[index]));
                setEditorVisible(true);
              }}
            />
            <Button
              theme='borderless'
              type='danger'
              icon={<IconDelete />}
              onClick={() => {
                setRules((currentRules) =>
                  currentRules.filter(
                    (_rule, ruleIndex) => ruleIndex !== index,
                  ),
                );
                setTestPreview(null);
              }}
            />
          </Space>
        ),
      },
    ],
    [rules, t],
  );

  const openNewRuleEditor = () => {
    setEditingIndex(null);
    setDraftRule(emptyRule);
    setEditorVisible(true);
  };

  const saveRule = () => {
    const nextRule = normalizeRule(draftRule);
    if (!nextRule.match_value || !nextRule.exposed_model) {
      showInfo(t('请填写匹配内容和对外模型名'));
      return;
    }
    if (nextRule.priority < -10000 || nextRule.priority > 10000) {
      showInfo(t('优先级必须在 -10000 到 10000 之间'));
      return;
    }
    setRules((currentRules) => {
      if (editingIndex === null) return [...currentRules, nextRule];
      return currentRules.map((rule, index) =>
        index === editingIndex ? nextRule : rule,
      );
    });
    setEditorVisible(false);
    setTestPreview(null);
  };

  const saveRules = async () => {
    setSaving(true);
    try {
      const response = await API.put('/api/option/', {
        key: OPTION_KEY,
        value: JSON.stringify(rules),
      });
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('保存失败'));
      }
      showSuccess(t('映射规则已保存'));
      props.refresh();
    } catch (error) {
      showError(error?.message || t('保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const testRules = async () => {
    const model = testModel.trim();
    if (!model) {
      showInfo(t('请输入要测试的上游模型'));
      return;
    }
    setTesting(true);
    try {
      const response = await API.post('/api/channel/model_mapping/preview', {
        models: [model],
        rules,
      });
      if (!response?.data?.success || !response.data.data) {
        throw new Error(response?.data?.message || t('测试失败'));
      }
      setTestPreview(response.data.data);
    } catch (error) {
      showError(error?.message || t('测试失败'));
    } finally {
      setTesting(false);
    }
  };

  let testPreviewDescription = '';
  if (testPreview?.has_changes) {
    testPreviewDescription = t('预览映射：{{source}} → {{target}}', {
      source: testPreview.changes[0]?.exposed_model,
      target: testPreview.changes[0]?.upstream_model,
    });
  } else if (testPreview?.has_conflicts) {
    testPreviewDescription = t('测试发现映射冲突，请调整规则后重试。');
  } else if (testPreview) {
    testPreviewDescription = t('没有匹配到映射规则。');
  }

  return (
    <>
      <Form.Section text={t('渠道模型映射规则')}>
        <Banner
          type='info'
          description={t(
            '在渠道编辑页点击智能映射后，系统会根据这里的规则生成预览；确认后才会修改渠道表单。',
          )}
          className='mb-4'
        />
        <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
          <Text type='tertiary' size='small'>
            {t('优先级越高，规则越先匹配。包含匹配默认忽略大小写。')}
          </Text>
          <Button
            theme='solid'
            type='primary'
            icon={<IconPlus />}
            onClick={openNewRuleEditor}
          >
            {t('新增规则')}
          </Button>
        </div>
        <Table
          columns={columns}
          dataSource={rules}
          rowKey={(_record, index) => index}
          pagination={false}
          empty={t('暂无映射规则')}
          scroll={{ x: 'max-content' }}
        />

        <div className='mt-5 rounded-lg border p-4'>
          <Text strong>{t('测试匹配')}</Text>
          <div className='mt-3 flex flex-wrap gap-2'>
            <Input
              value={testModel}
              placeholder='zai.ai/glm-5.2'
              style={{ width: 320, maxWidth: '100%' }}
              onChange={(value) => setTestModel(value)}
            />
            <Button icon={<IconPlay />} onClick={testRules} loading={testing}>
              {t('测试')}
            </Button>
          </div>
          {testPreview && (
            <Banner
              type={testPreview.has_conflicts ? 'warning' : 'info'}
              className='mt-3'
              description={testPreviewDescription}
            />
          )}
        </div>

        <div className='mt-4 flex justify-end'>
          <Button
            theme='solid'
            type='primary'
            loading={saving}
            onClick={saveRules}
          >
            {t('保存映射规则')}
          </Button>
        </div>
      </Form.Section>

      <Modal
        title={t(editingIndex === null ? '新增映射规则' : '编辑映射规则')}
        visible={editorVisible}
        onCancel={() => setEditorVisible(false)}
        onOk={saveRule}
        okText={t('保存')}
        cancelText={t('取消')}
      >
        <Form labelPosition='top'>
          <Form.Select
            label={t('匹配方式')}
            value={draftRule.match_mode}
            optionList={[
              { value: 'exact', label: t('完全匹配') },
              { value: 'contains', label: t('包含匹配') },
            ]}
            onChange={(value) =>
              setDraftRule((rule) => ({ ...rule, match_mode: value }))
            }
          />
          <Form.Input
            label={t('匹配内容')}
            value={draftRule.match_value}
            placeholder='glm-5.2'
            onChange={(value) =>
              setDraftRule((rule) => ({ ...rule, match_value: value }))
            }
          />
          <Form.Input
            label={t('对外模型名')}
            value={draftRule.exposed_model}
            placeholder='GLM-5.2'
            onChange={(value) =>
              setDraftRule((rule) => ({ ...rule, exposed_model: value }))
            }
            extraText={t('用户会看到并请求这个模型名。')}
          />
          <Form.InputNumber
            label={t('优先级')}
            value={draftRule.priority}
            min={-10000}
            max={10000}
            onChange={(value) =>
              setDraftRule((rule) => ({
                ...rule,
                priority: Number(value || 0),
              }))
            }
          />
          <div className='flex items-center justify-between py-2'>
            <Text>{t('区分大小写')}</Text>
            <Switch
              checked={draftRule.case_sensitive}
              onChange={(checked) =>
                setDraftRule((rule) => ({ ...rule, case_sensitive: checked }))
              }
            />
          </div>
          <div className='flex items-center justify-between py-2'>
            <Text>{t('启用')}</Text>
            <Switch
              checked={draftRule.enabled}
              onChange={(checked) =>
                setDraftRule((rule) => ({ ...rule, enabled: checked }))
              }
            />
          </div>
        </Form>
      </Modal>
    </>
  );
};

export default SettingChannelModelMapping;
