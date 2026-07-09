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
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
} from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { Check, CheckSquare, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  API,
  showError,
  showInfo,
  showSuccess,
  stringToColor,
} from '../../../../helpers';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';

const OFFICIAL_PRICE_SOURCES = [
  { value: 'models.dev', label: 'models.dev' },
  { value: 'basellm', label: 'BaseLLM' },
];

const officialPriceFieldOrder = [
  'model_ratio',
  'completion_ratio',
  'cache_ratio',
  'create_cache_ratio',
  'image_ratio',
  'audio_ratio',
  'audio_completion_ratio',
  'model_price',
  'billing_mode',
  'billing_expr',
];

function officialPriceMappingKey(mapping) {
  if (!mapping) return '';
  return `${mapping.source}\u0000${mapping.provider || ''}\u0000${mapping.upstream_model}`;
}

function officialPriceMappingFromCandidate(candidate) {
  return {
    source: candidate.source,
    provider: candidate.provider,
    upstream_model: candidate.upstream_model,
  };
}

function officialPriceFieldSort(left, right) {
  const leftIndex = officialPriceFieldOrder.indexOf(left);
  const rightIndex = officialPriceFieldOrder.indexOf(right);
  return (
    (leftIndex === -1 ? officialPriceFieldOrder.length : leftIndex) -
    (rightIndex === -1 ? officialPriceFieldOrder.length : rightIndex)
  );
}

function formatOfficialPriceValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function selectOfficialSavedCandidates(models) {
  const next = {};
  models.forEach((model) => {
    const selected = model.candidates?.find((candidate) => candidate.selected);
    if (selected) {
      next[model.model_name] = officialPriceMappingFromCandidate(selected);
    }
  });
  return next;
}

function updateOfficialPreviewAfterApply(preview, data) {
  if (!preview || !data) return preview;

  const mappings = data.mappings || preview.mappings || {};
  const updatedFields = data.updated_fields || {};
  return {
    ...preview,
    mappings,
    source_results: data.source_results || preview.source_results,
    models: (preview.models || []).map((model) => {
      const mapping = mappings[model.model_name];
      const selectedKey = officialPriceMappingKey(mapping);
      return {
        ...model,
        current: updatedFields[model.model_name] || model.current,
        mapping,
        candidates: (model.candidates || []).map((candidate) => ({
          ...candidate,
          selected:
            officialPriceMappingKey(
              officialPriceMappingFromCandidate(candidate),
            ) === selectedKey,
        })),
      };
    }),
  };
}

function OfficialPriceSyncContent({
  t,
  disabled = false,
  refresh,
  modelNames,
  embedded = false,
  onApplied,
}) {
  const isScoped = modelNames !== undefined;
  const modelNamesKey = modelNames?.join('\u0000') || '';
  const [previewData, setPreviewData] = useState(null);
  const [selectedMappings, setSelectedMappings] = useState({});
  const [searchKeyword, setSearchKeyword] = useState('');
  const [mappingFilter, setMappingFilter] = useState('all');
  const [candidateFilter, setCandidateFilter] = useState('all');
  const [selectedSources, setSelectedSources] = useState(
    OFFICIAL_PRICE_SOURCES.map((source) => source.value),
  );
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setPreviewData(null);
    setSelectedMappings({});
    setSearchKeyword('');
    setMappingFilter('all');
    setCandidateFilter('all');
  }, [modelNamesKey]);

  const fieldLabelMap = useMemo(
    () => ({
      model_ratio: t('模型倍率'),
      completion_ratio: t('补全倍率'),
      cache_ratio: t('缓存倍率'),
      create_cache_ratio: t('缓存创建倍率'),
      image_ratio: t('图片倍率'),
      audio_ratio: t('音频倍率'),
      audio_completion_ratio: t('音频补全倍率'),
      model_price: t('固定价格'),
      billing_mode: t('计费模式'),
      billing_expr: t('表达式计费'),
    }),
    [t],
  );

  const filteredModels = useMemo(() => {
    const models = previewData?.models || [];
    const keyword = searchKeyword.trim().toLowerCase();

    return models.filter((model) => {
      const candidates = model.candidates || [];
      const matchesMapping =
        mappingFilter === 'all' ||
        (mappingFilter === 'saved' && !!model.mapping) ||
        (mappingFilter === 'unsaved' && !model.mapping);
      const matchesCandidates =
        candidateFilter === 'all' ||
        (candidateFilter === 'matched' && candidates.length > 0) ||
        (candidateFilter === 'unmatched' && candidates.length === 0);
      if (!matchesMapping || !matchesCandidates) return false;
      if (!keyword) return true;
      if (model.model_name.toLowerCase().includes(keyword)) return true;
      return candidates.some(
        (candidate) =>
          candidate.upstream_model.toLowerCase().includes(keyword) ||
          candidate.source.toLowerCase().includes(keyword) ||
          (candidate.provider || '').toLowerCase().includes(keyword),
      );
    });
  }, [candidateFilter, mappingFilter, previewData, searchKeyword]);

  const renderFieldList = (fields = {}) => {
    const entries = Object.entries(fields).sort(([left], [right]) =>
      officialPriceFieldSort(left, right),
    );

    if (entries.length === 0) {
      return <span className='text-gray-500'>-</span>;
    }

    return (
      <div className='flex min-w-[220px] flex-wrap gap-1.5'>
        {entries.map(([field, value]) => (
          <Tag key={field} color={stringToColor(field)} shape='circle'>
            <Tooltip content={`${fieldLabelMap[field] || field}: ${value}`}>
              <span className='inline-block max-w-[360px] truncate align-bottom'>
                {fieldLabelMap[field] || field}:{' '}
                {formatOfficialPriceValue(value)}
              </span>
            </Tooltip>
          </Tag>
        ))}
      </div>
    );
  };

  const fetchOfficialPreview = async () => {
    setLoading(true);
    try {
      const res = await API.post('/api/ratio_sync/official/preview', {
        sources: selectedSources,
        model_names: modelNames,
      });
      if (!res.data.success) {
        showError(res.data.message || t('官方价格预览失败'));
        return;
      }

      const data = res.data.data || { models: [], source_results: [] };
      setPreviewData(data);
      setSelectedMappings(selectOfficialSavedCandidates(data.models || []));

      const matchedCount = (data.models || []).filter(
        (model) => (model.candidates || []).length > 0,
      ).length;
      if (matchedCount === 0) {
        showInfo(t('未找到官方价格候选项'));
      } else {
        showSuccess(t('官方价格候选项已加载'));
      }
    } catch (error) {
      showError(t('官方价格预览失败') + ': ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const applyOfficialMappings = async (mappings, applyAll) => {
    setApplying(true);
    try {
      const res = await API.post('/api/ratio_sync/official/apply', {
        mappings,
        apply_all: applyAll,
      });
      if (!res.data.success) {
        showError(res.data.message || t('官方价格同步失败'));
        return;
      }

      setPreviewData((prev) =>
        updateOfficialPreviewAfterApply(prev, res.data.data),
      );
      showSuccess(
        res.data.data?.updated_models?.length
          ? t('已更新 {{count}} 个模型', {
              count: res.data.data.updated_models.length,
            })
          : t('同步成功'),
      );
      refresh();
      onApplied?.(res.data.data);
    } catch (error) {
      showError(t('官方价格同步失败') + ': ' + error.message);
    } finally {
      setApplying(false);
    }
  };

  const selectOfficialCandidate = (modelName, candidate) => {
    setSelectedMappings((prev) => {
      const mapping = officialPriceMappingFromCandidate(candidate);
      if (
        officialPriceMappingKey(prev[modelName]) ===
        officialPriceMappingKey(mapping)
      ) {
        const next = { ...prev };
        delete next[modelName];
        return next;
      }
      return { ...prev, [modelName]: mapping };
    });
  };

  const toggleOfficialPriceSource = (source, checked) => {
    setSelectedSources((previous) => {
      if (checked) {
        return previous.includes(source) ? previous : [...previous, source];
      }
      return previous.filter((value) => value !== source);
    });
    setPreviewData(null);
    setSelectedMappings({});
    setSearchKeyword('');
    setMappingFilter('all');
    setCandidateFilter('all');
  };

  const selectedCount = Object.keys(selectedMappings).length;
  const panelDisabled = disabled || loading || applying;
  const sourceStatus = previewData?.source_results || [];
  const columns = [
    {
      title: t('模型'),
      dataIndex: 'model_name',
      width: 220,
      render: (text, record) => (
        <div className='flex min-w-[180px] flex-col gap-1'>
          <span className='font-medium'>{text}</span>
          <div className='flex flex-wrap gap-1'>
            <Tag color={record.mapping ? 'blue' : 'grey'} shape='circle'>
              {record.mapping ? t('已保存') : t('未同步')}
            </Tag>
            {(record.candidates || []).length === 0 ? (
              <Tag color='grey' shape='circle'>
                {t('无候选项')}
              </Tag>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      title: t('当前价格'),
      dataIndex: 'current',
      render: (fields) => renderFieldList(fields),
    },
    {
      title: t('匹配到的官方价格'),
      dataIndex: 'candidates',
      render: (candidates = [], record) => {
        if (candidates.length === 0) {
          return <span className='text-gray-500'>{t('无候选项')}</span>;
        }

        return (
          <div className='flex max-w-[860px] flex-col gap-2'>
            {candidates.map((candidate) => {
              const mapping = officialPriceMappingFromCandidate(candidate);
              const candidateKey = officialPriceMappingKey(mapping);
              const selected =
                officialPriceMappingKey(selectedMappings[record.model_name]) ===
                candidateKey;
              const priceParts = [
                candidate.provider
                  ? `${t('供应商')}: ${candidate.provider}`
                  : null,
                candidate.input_price !== undefined
                  ? `${t('输入')}: ${candidate.input_price}`
                  : null,
                candidate.output_price !== undefined
                  ? `${t('输出')}: ${candidate.output_price}`
                  : null,
                candidate.cache_read_price !== undefined
                  ? `${t('缓存读取价格')}: ${candidate.cache_read_price}`
                  : null,
              ].filter(Boolean);

              return (
                <button
                  key={candidateKey}
                  type='button'
                  disabled={panelDisabled}
                  onClick={() =>
                    selectOfficialCandidate(record.model_name, candidate)
                  }
                  className={`flex w-full min-w-[360px] flex-col gap-2 rounded-md border p-2 text-left transition-colors ${
                    selected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-transparent'
                  } ${panelDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <div className='flex min-w-0 items-center gap-2'>
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-gray-300'
                      }`}
                    >
                      {selected && <Check size={12} />}
                    </span>
                    <span className='min-w-0 flex-1 truncate font-medium'>
                      {candidate.upstream_model}
                    </span>
                    <Tag shape='circle'>{candidate.source}</Tag>
                    {selected && (
                      <Tag color='green' shape='circle'>
                        {t('已选择')}
                      </Tag>
                    )}
                  </div>
                  {renderFieldList(candidate.fields || {})}
                  <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500'>
                    <span>
                      {t('分数 {{score}}', { score: candidate.score })}
                    </span>
                    {priceParts.map((part) => (
                      <span key={part}>{part}</span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        );
      },
    },
  ];

  return (
    <div
      className={
        embedded
          ? 'space-y-4'
          : 'mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700'
      }
    >
      <div className='mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <Tag color='blue' shape='circle'>
            {t('官方价格同步')}
          </Tag>
          {sourceStatus.map((result) => (
            <Tooltip
              key={result.name}
              content={
                result.status === 'success'
                  ? `${result.name}: ${result.count || 0}`
                  : `${result.name}: ${result.error || result.status}`
              }
            >
              <Tag
                color={result.status === 'success' ? 'green' : 'red'}
                shape='circle'
              >
                {result.name}
              </Tag>
            </Tooltip>
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-3'>
          <span className='text-sm text-gray-500'>{t('价格来源')}</span>
          {OFFICIAL_PRICE_SOURCES.map((source) => (
            <Checkbox
              key={source.value}
              checked={selectedSources.includes(source.value)}
              disabled={panelDisabled}
              onChange={(event) =>
                toggleOfficialPriceSource(source.value, event.target.checked)
              }
            >
              {source.label}
            </Checkbox>
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Input
            prefix={<IconSearch size={14} />}
            placeholder={t('搜索模型名称')}
            value={searchKeyword}
            onChange={setSearchKeyword}
            className='w-full sm:w-64'
            disabled={panelDisabled || !previewData}
            showClear
          />
          <Select
            value={mappingFilter}
            onChange={setMappingFilter}
            disabled={panelDisabled || !previewData}
            style={{ width: 150 }}
          >
            <Select.Option value='all'>
              {`${t('官方价格同步')} · ${t('全部')}`}
            </Select.Option>
            <Select.Option value='saved'>
              {`${t('官方价格同步')} · ${t('已保存')}`}
            </Select.Option>
            <Select.Option value='unsaved'>
              {`${t('官方价格同步')} · ${t('未同步')}`}
            </Select.Option>
          </Select>
          <Select
            value={candidateFilter}
            onChange={setCandidateFilter}
            disabled={panelDisabled || !previewData}
            style={{ width: 150 }}
          >
            <Select.Option value='all'>
              {`${t('候选状态')} · ${t('全部')}`}
            </Select.Option>
            <Select.Option value='matched'>
              {`${t('候选状态')} · ${t('有候选项')}`}
            </Select.Option>
            <Select.Option value='unmatched'>
              {`${t('候选状态')} · ${t('无候选项')}`}
            </Select.Option>
          </Select>
          <Button
            icon={<RefreshCcw size={14} />}
            disabled={panelDisabled || selectedSources.length === 0}
            loading={loading}
            onClick={fetchOfficialPreview}
          >
            {t('预览官方价格')}
          </Button>
          {!isScoped ? (
            <Button
              icon={<RefreshCcw size={14} />}
              type='secondary'
              disabled={panelDisabled}
              loading={applying}
              onClick={() => applyOfficialMappings({}, true)}
            >
              {t('同步已保存官方价格')}
            </Button>
          ) : null}
          <Button
            icon={<CheckSquare size={14} />}
            disabled={panelDisabled || selectedCount === 0}
            loading={applying}
            onClick={() => applyOfficialMappings(selectedMappings, false)}
          >
            {isScoped ? t('保存并应用官方价格') : t('应用选中的官方价格')}
          </Button>
        </div>
      </div>

      {!previewData ? (
        <Empty
          image={<IllustrationNoResult style={{ width: 120, height: 120 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 120, height: 120 }} />
          }
          description={t('暂无官方价格预览')}
          style={{ padding: 24 }}
        />
      ) : filteredModels.length === 0 ? (
        <Empty
          image={<IllustrationNoResult style={{ width: 120, height: 120 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 120, height: 120 }} />
          }
          description={t('未找到官方价格匹配项')}
          style={{ padding: 24 }}
        />
      ) : (
        <Table
          columns={columns}
          dataSource={filteredModels}
          rowKey='model_name'
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
          }}
          scroll={{ x: 'max-content' }}
          size='middle'
          loading={loading}
        />
      )}
    </div>
  );
}

export function OfficialPriceSyncPanel(props) {
  return <OfficialPriceSyncContent {...props} />;
}

export function OfficialPriceSyncModal({
  visible,
  onCancel,
  modelNames,
  refresh,
  onApplied,
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  return (
    <Modal
      title={t('官方价格匹配')}
      visible={visible}
      footer={null}
      onCancel={onCancel}
      maskClosable
      size={isMobile ? 'full-width' : 'large'}
      bodyStyle={{ maxHeight: '72vh', overflowY: 'auto' }}
    >
      {visible ? (
        <OfficialPriceSyncContent
          t={t}
          modelNames={modelNames}
          refresh={refresh}
          embedded
          onApplied={(data) => {
            onApplied?.(data);
            onCancel();
          }}
        />
      ) : null}
    </Modal>
  );
}
