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

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Button,
  Table,
  Tag,
  Empty,
  Checkbox,
  Collapse,
  Form,
  Input,
  Tooltip,
  Select,
  Modal,
  Spin,
} from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { RefreshCcw, CheckSquare, AlertTriangle, Check } from 'lucide-react';
import {
  API,
  showError,
  showInfo,
  showSuccess,
  showWarning,
  stringToColor,
} from '../../../helpers';
import { useIsMobile } from '../../../hooks/common/useIsMobile';
import { DEFAULT_ENDPOINT } from '../../../constants';
import { useTranslation } from 'react-i18next';
import {
  IllustrationNoResult,
  IllustrationNoResultDark,
} from '@douyinfe/semi-illustrations';
import ChannelSelectorModal from '../../../components/settings/ChannelSelectorModal';

const OFFICIAL_RATIO_PRESET_ID = -100;
const OFFICIAL_RATIO_PRESET_NAME = '官方倍率预设';
const OFFICIAL_RATIO_PRESET_BASE_URL = 'https://basellm.github.io';
const OFFICIAL_RATIO_PRESET_ENDPOINT =
  '/llm-metadata/api/newapi/ratio_config-v1-base.json';
const MODELS_DEV_PRESET_ID = -101;
const MODELS_DEV_PRESET_NAME = 'models.dev 价格预设';
const MODELS_DEV_PRESET_BASE_URL = 'https://models.dev';
const MODELS_DEV_PRESET_ENDPOINT = 'https://models.dev/api.json';

function ConflictConfirmModal({ t, visible, items, loading, onOk, onCancel }) {
  const isMobile = useIsMobile();
  const columns = [
    { title: t('渠道'), dataIndex: 'channel' },
    { title: t('模型'), dataIndex: 'model' },
    {
      title: t('当前计费'),
      dataIndex: 'current',
      render: (text) => <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>,
    },
    {
      title: t('修改为'),
      dataIndex: 'newVal',
      render: (text) => <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>,
    },
  ];

  return (
    <Modal
      title={t('确认冲突项修改')}
      visible={visible}
      confirmLoading={loading}
      cancelButtonProps={{ disabled: loading }}
      maskClosable={!loading}
      onCancel={loading ? undefined : onCancel}
      onOk={onOk}
      size={isMobile ? 'full-width' : 'large'}
    >
      <Table
        columns={columns}
        dataSource={items}
        pagination={false}
        size='small'
      />
    </Modal>
  );
}

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

function OfficialPriceSyncPanel({ t, disabled, refresh }) {
  const [previewData, setPreviewData] = useState(null);
  const [selectedMappings, setSelectedMappings] = useState({});
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

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
    if (!keyword) return models;

    return models.filter((model) => {
      if (model.model_name.toLowerCase().includes(keyword)) return true;
      return (model.candidates || []).some(
        (candidate) =>
          candidate.upstream_model.toLowerCase().includes(keyword) ||
          candidate.source.toLowerCase().includes(keyword) ||
          (candidate.provider || '').toLowerCase().includes(keyword),
      );
    });
  }, [previewData, searchKeyword]);

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
      const res = await API.get('/api/ratio_sync/official/preview');
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
          {record.mapping && (
            <Tag color='blue' shape='circle'>
              {t('已保存')}
            </Tag>
          )}
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
    <div className='mb-4 rounded-md border border-gray-200 p-4 dark:border-gray-700'>
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

        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <Input
            prefix={<IconSearch size={14} />}
            placeholder={t('搜索模型名称')}
            value={searchKeyword}
            onChange={setSearchKeyword}
            className='w-full sm:w-64'
            disabled={panelDisabled || !previewData}
            showClear
          />
          <Button
            icon={<RefreshCcw size={14} />}
            disabled={panelDisabled}
            loading={loading}
            onClick={fetchOfficialPreview}
          >
            {t('预览官方价格')}
          </Button>
          <Button
            icon={<RefreshCcw size={14} />}
            type='secondary'
            disabled={panelDisabled}
            loading={applying}
            onClick={() => applyOfficialMappings({}, true)}
          >
            {t('同步已保存官方价格')}
          </Button>
          <Button
            icon={<CheckSquare size={14} />}
            disabled={panelDisabled || selectedCount === 0}
            loading={applying}
            onClick={() => applyOfficialMappings(selectedMappings, false)}
          >
            {t('应用选中的官方价格')}
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

export default function UpstreamRatioSync(props) {
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const isMobile = useIsMobile();

  // 渠道选择相关
  const [allChannels, setAllChannels] = useState([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);

  // 渠道端点配置
  const [channelEndpoints, setChannelEndpoints] = useState({}); // { channelId: endpoint }

  // 差异数据和测试结果
  const [differences, setDifferences] = useState({});
  const [resolutions, setResolutions] = useState({});

  // 是否已经执行过同步
  const [hasSynced, setHasSynced] = useState(false);

  // 分页相关状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 搜索相关状态
  const [searchKeyword, setSearchKeyword] = useState('');

  // 倍率类型过滤
  const [ratioTypeFilter, setRatioTypeFilter] = useState('');

  // 冲突确认弹窗相关
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [conflictItems, setConflictItems] = useState([]); // {channel, model, current, newVal, ratioType}

  const channelSelectorRef = React.useRef(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [ratioTypeFilter, searchKeyword]);

  const fetchAllChannels = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/ratio_sync/channels');

      if (res.data.success) {
        const channels = res.data.data || [];

        const transferData = channels.map((channel) => ({
          key: channel.id,
          label: channel.name,
          value: channel.id,
          disabled: false,
          _originalData: channel,
        }));

        setAllChannels(transferData);

        // 合并已有 endpoints，避免每次打开弹窗都重置
        setChannelEndpoints((prev) => {
          const merged = { ...prev };
          transferData.forEach((channel) => {
            const id = channel.key;
            const base = channel._originalData?.base_url || '';
            const name = channel.label || '';
            const channelType = channel._originalData?.type;
            const isOfficialRatioPreset =
              id === OFFICIAL_RATIO_PRESET_ID ||
              base === OFFICIAL_RATIO_PRESET_BASE_URL ||
              name === OFFICIAL_RATIO_PRESET_NAME;
            const isModelsDevPreset =
              id === MODELS_DEV_PRESET_ID ||
              base === MODELS_DEV_PRESET_BASE_URL ||
              name === MODELS_DEV_PRESET_NAME;
            const isOpenRouter = channelType === 20;
            if (!merged[id]) {
              if (isModelsDevPreset) {
                merged[id] = MODELS_DEV_PRESET_ENDPOINT;
              } else if (isOfficialRatioPreset) {
                merged[id] = OFFICIAL_RATIO_PRESET_ENDPOINT;
              } else if (isOpenRouter) {
                merged[id] = 'openrouter';
              } else {
                merged[id] = DEFAULT_ENDPOINT;
              }
            }
          });
          return merged;
        });
      } else {
        showError(res.data.message);
      }
    } catch (error) {
      showError(t('获取渠道失败：') + error.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmChannelSelection = () => {
    const selected = allChannels
      .filter((ch) => selectedChannelIds.includes(ch.value))
      .map((ch) => ch._originalData);

    if (selected.length === 0) {
      showWarning(t('请至少选择一个渠道'));
      return;
    }

    setModalVisible(false);
    fetchRatiosFromChannels(selected);
  };

  const fetchRatiosFromChannels = async (channelList) => {
    setSyncLoading(true);

    const upstreams = channelList.map((ch) => ({
      id: ch.id,
      name: ch.name,
      base_url: ch.base_url,
      endpoint: channelEndpoints[ch.id] || DEFAULT_ENDPOINT,
    }));

    const payload = {
      upstreams: upstreams,
      timeout: 10,
    };

    try {
      const res = await API.post('/api/ratio_sync/fetch', payload);

      if (!res.data.success) {
        showError(res.data.message || t('后端请求失败'));
        setSyncLoading(false);
        return;
      }

      const { differences = {}, test_results = [] } = res.data.data;

      const errorResults = test_results.filter((r) => r.status === 'error');
      if (errorResults.length > 0) {
        showWarning(
          t('部分渠道测试失败：') +
            errorResults.map((r) => `${r.name}: ${r.error}`).join(', '),
        );
      }

      setDifferences(differences);
      setResolutions({});
      setHasSynced(true);

      if (Object.keys(differences).length === 0) {
        showSuccess(t('未找到差异化价格，无需同步'));
      }
    } catch (e) {
      showError(t('请求后端接口失败：') + e.message);
    } finally {
      setSyncLoading(false);
    }
  };

  const ratioSyncFields = [
    'model_ratio',
    'completion_ratio',
    'cache_ratio',
    'create_cache_ratio',
    'image_ratio',
    'audio_ratio',
    'audio_completion_ratio',
  ];

  const numericSyncFields = new Set([...ratioSyncFields, 'model_price']);
  const syncFieldOrder = [
    ...ratioSyncFields,
    'model_price',
    'billing_mode',
    'billing_expr',
  ];

  function getSyncFieldLabel(ratioType) {
    const typeMap = {
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
    };
    return typeMap[ratioType] || ratioType;
  }

  function getOrderedRatioTypes(ratioTypes) {
    const keys = Object.keys(ratioTypes || {});
    const ordered = [
      ...syncFieldOrder.filter((field) => keys.includes(field)),
      ...keys.filter((field) => !syncFieldOrder.includes(field)),
    ];
    return ratioTypeFilter
      ? ordered.filter((field) => field === ratioTypeFilter)
      : ordered;
  }

  function deleteResolutionField(newRes, model, ratioType) {
    if (!newRes[model]) return;
    delete newRes[model][ratioType];
    if (ratioType === 'billing_expr') {
      delete newRes[model].billing_mode;
    }
    if (ratioType === 'billing_mode') {
      delete newRes[model].billing_expr;
    }
    if (Object.keys(newRes[model]).length === 0) {
      delete newRes[model];
    }
  }

  function getBillingCategory(ratioType) {
    if (ratioType === 'model_price') return 'price';
    if (ratioType === 'billing_mode' || ratioType === 'billing_expr') {
      return 'tiered';
    }
    return 'ratio';
  }

  function optionKeyBySyncField(ratioType) {
    const explicit = {
      billing_mode: 'billing_setting.billing_mode',
      billing_expr: 'billing_setting.billing_expr',
    };
    if (explicit[ratioType]) return explicit[ratioType];
    return ratioType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  function getUpstreamValue(model, ratioType, sourceName) {
    return differences[model]?.[ratioType]?.upstreams?.[sourceName];
  }

  function isSelectableUpstreamValue(value) {
    return value !== null && value !== undefined && value !== 'same';
  }

  function getPreferredSyncField(model, ratioType, sourceName) {
    const exprValue = getUpstreamValue(model, 'billing_expr', sourceName);
    if (ratioType !== 'billing_expr' && isSelectableUpstreamValue(exprValue)) {
      return 'billing_expr';
    }
    return ratioType;
  }

  function shouldShowSyncField(model, ratioType, sourceName) {
    if (!sourceName) return true;
    return getPreferredSyncField(model, ratioType, sourceName) === ratioType;
  }

  const selectValue = useCallback(
    (model, ratioType, value, sourceName) => {
      const preferredRatioType = sourceName
        ? getPreferredSyncField(model, ratioType, sourceName)
        : ratioType;
      const preferredValue =
        preferredRatioType === ratioType
          ? value
          : getUpstreamValue(model, preferredRatioType, sourceName);
      ratioType = preferredRatioType;
      value = preferredValue;

      const category = getBillingCategory(ratioType);

      setResolutions((prev) => {
        const newModelRes = { ...(prev[model] || {}) };

        Object.keys(newModelRes).forEach((rt) => {
          if (
            category !== 'tiered' &&
            getBillingCategory(rt) !== 'tiered' &&
            getBillingCategory(rt) !== category
          ) {
            delete newModelRes[rt];
          }
        });

        newModelRes[ratioType] = value;

        if (category === 'tiered' && sourceName) {
          const modeValue =
            differences[model]?.billing_mode?.upstreams?.[sourceName];
          const exprValue =
            differences[model]?.billing_expr?.upstreams?.[sourceName];
          if (
            modeValue !== undefined &&
            modeValue !== null &&
            modeValue !== 'same'
          ) {
            newModelRes.billing_mode = modeValue;
          } else if (ratioType === 'billing_expr') {
            newModelRes.billing_mode = 'tiered_expr';
          }
          if (
            exprValue !== undefined &&
            exprValue !== null &&
            exprValue !== 'same'
          ) {
            newModelRes.billing_expr = exprValue;
          }
        }

        return {
          ...prev,
          [model]: newModelRes,
        };
      });
    },
    [setResolutions, differences],
  );

  const applySync = async () => {
    const currentRatios = {
      ModelRatio: JSON.parse(props.options.ModelRatio || '{}'),
      CompletionRatio: JSON.parse(props.options.CompletionRatio || '{}'),
      CacheRatio: JSON.parse(props.options.CacheRatio || '{}'),
      CreateCacheRatio: JSON.parse(props.options.CreateCacheRatio || '{}'),
      ImageRatio: JSON.parse(props.options.ImageRatio || '{}'),
      AudioRatio: JSON.parse(props.options.AudioRatio || '{}'),
      AudioCompletionRatio: JSON.parse(
        props.options.AudioCompletionRatio || '{}',
      ),
      ModelPrice: JSON.parse(props.options.ModelPrice || '{}'),
      'billing_setting.billing_mode': JSON.parse(
        props.options['billing_setting.billing_mode'] || '{}',
      ),
      'billing_setting.billing_expr': JSON.parse(
        props.options['billing_setting.billing_expr'] || '{}',
      ),
    };

    const conflicts = [];

    const getLocalBillingCategory = (model) => {
      if (currentRatios.ModelPrice[model] !== undefined) return 'price';
      if (
        currentRatios.ModelRatio[model] !== undefined ||
        currentRatios.CompletionRatio[model] !== undefined ||
        currentRatios.CacheRatio[model] !== undefined ||
        currentRatios.CreateCacheRatio[model] !== undefined ||
        currentRatios.ImageRatio[model] !== undefined ||
        currentRatios.AudioRatio[model] !== undefined ||
        currentRatios.AudioCompletionRatio[model] !== undefined
      )
        return 'ratio';
      return null;
    };

    const findSourceChannel = (model, ratioType, value) => {
      if (differences[model] && differences[model][ratioType]) {
        const upMap = differences[model][ratioType].upstreams || {};
        const entry = Object.entries(upMap).find(([_, v]) => v === value);
        if (entry) return entry[0];
      }
      return t('未知');
    };

    Object.entries(resolutions).forEach(([model, ratios]) => {
      const localCat = getLocalBillingCategory(model);
      const newCat =
        'model_price' in ratios
          ? 'price'
          : ratioSyncFields.some((rt) => rt in ratios)
            ? 'ratio'
            : 'tiered';

      if (localCat && newCat !== 'tiered' && localCat !== newCat) {
        const currentDesc =
          localCat === 'price'
            ? `${t('固定价格')} : ${currentRatios.ModelPrice[model]}`
            : `${t('模型倍率')} : ${currentRatios.ModelRatio[model] ?? '-'}\n${t('补全倍率')} : ${currentRatios.CompletionRatio[model] ?? '-'}`;

        let newDesc = '';
        if (newCat === 'price') {
          newDesc = `${t('固定价格')} : ${ratios['model_price']}`;
        } else {
          const newModelRatio = ratios['model_ratio'] ?? '-';
          const newCompRatio = ratios['completion_ratio'] ?? '-';
          newDesc = `${t('模型倍率')} : ${newModelRatio}\n${t('补全倍率')} : ${newCompRatio}`;
        }

        const channels = Object.entries(ratios)
          .map(([rt, val]) => findSourceChannel(model, rt, val))
          .filter((v, idx, arr) => arr.indexOf(v) === idx)
          .join(', ');

        conflicts.push({
          channel: channels,
          model,
          current: currentDesc,
          newVal: newDesc,
        });
      }
    });

    if (conflicts.length > 0) {
      setConflictItems(conflicts);
      setConfirmVisible(true);
      return;
    }

    await performSync(currentRatios);
  };

  const performSync = useCallback(
    async (currentRatios) => {
      const finalRatios = {
        ModelRatio: { ...currentRatios.ModelRatio },
        CompletionRatio: { ...currentRatios.CompletionRatio },
        CacheRatio: { ...currentRatios.CacheRatio },
        CreateCacheRatio: { ...currentRatios.CreateCacheRatio },
        ImageRatio: { ...currentRatios.ImageRatio },
        AudioRatio: { ...currentRatios.AudioRatio },
        AudioCompletionRatio: { ...currentRatios.AudioCompletionRatio },
        ModelPrice: { ...currentRatios.ModelPrice },
        'billing_setting.billing_mode': {
          ...currentRatios['billing_setting.billing_mode'],
        },
        'billing_setting.billing_expr': {
          ...currentRatios['billing_setting.billing_expr'],
        },
      };

      Object.entries(resolutions).forEach(([model, ratios]) => {
        const selectedTypes = Object.keys(ratios);
        const hasPrice = selectedTypes.includes('model_price');
        const hasRatio = selectedTypes.some((rt) =>
          ratioSyncFields.includes(rt),
        );

        if (hasPrice) {
          delete finalRatios.ModelRatio[model];
          delete finalRatios.CompletionRatio[model];
          delete finalRatios.CacheRatio[model];
          delete finalRatios.CreateCacheRatio[model];
          delete finalRatios.ImageRatio[model];
          delete finalRatios.AudioRatio[model];
          delete finalRatios.AudioCompletionRatio[model];
        }
        if (hasRatio) {
          delete finalRatios.ModelPrice[model];
        }

        Object.entries(ratios).forEach(([ratioType, value]) => {
          const optionKey = optionKeyBySyncField(ratioType);
          finalRatios[optionKey][model] = numericSyncFields.has(ratioType)
            ? parseFloat(value)
            : value;
        });
      });

      setLoading(true);
      showInfo(t('正在同步价格，请稍候'));
      let success = false;
      try {
        const updates = Object.entries(finalRatios).map(([key, value]) =>
          API.put('/api/option/', {
            key,
            value: JSON.stringify(value, null, 2),
          }),
        );

        const results = await Promise.all(updates);

        if (results.every((res) => res.data.success)) {
          showSuccess(t('同步成功'));
          props.refresh();

          setDifferences((prevDifferences) => {
            const newDifferences = { ...prevDifferences };

            Object.entries(resolutions).forEach(([model, ratios]) => {
              Object.keys(ratios).forEach((ratioType) => {
                if (newDifferences[model] && newDifferences[model][ratioType]) {
                  delete newDifferences[model][ratioType];

                  if (Object.keys(newDifferences[model]).length === 0) {
                    delete newDifferences[model];
                  }
                }
              });
            });

            return newDifferences;
          });

          setResolutions({});
          success = true;
        } else {
          showError(t('部分保存失败'));
        }
      } catch (error) {
        showError(t('保存失败'));
      } finally {
        setLoading(false);
      }
      return success;
    },
    [resolutions, props.options, props.refresh],
  );

  const getCurrentPageData = (dataSource) => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return dataSource.slice(startIndex, endIndex);
  };

  const renderHeader = () => (
    <div className='flex flex-col w-full'>
      <div className='flex flex-col md:flex-row justify-between items-center gap-4 w-full'>
        <div className='flex flex-col md:flex-row gap-2 w-full md:w-auto order-2 md:order-1'>
          <Button
            icon={<RefreshCcw size={14} />}
            className='w-full md:w-auto mt-2'
            disabled={loading || syncLoading || confirmLoading}
            onClick={() => {
              setModalVisible(true);
              if (allChannels.length === 0) {
                fetchAllChannels();
              }
            }}
          >
            {t('选择同步渠道')}
          </Button>

          {(() => {
            const hasSelections = Object.keys(resolutions).length > 0;

            return (
              <Button
                icon={<CheckSquare size={14} />}
                type='secondary'
                onClick={applySync}
                loading={loading || confirmLoading}
                disabled={
                  !hasSelections || loading || syncLoading || confirmLoading
                }
                className='w-full md:w-auto mt-2'
              >
                {t('应用同步')}
              </Button>
            );
          })()}

          <div className='flex flex-col sm:flex-row gap-2 w-full md:w-auto mt-2'>
            <Input
              prefix={<IconSearch size={14} />}
              placeholder={t('搜索模型名称')}
              value={searchKeyword}
              onChange={setSearchKeyword}
              className='w-full sm:w-64'
              disabled={loading || syncLoading || confirmLoading}
              showClear
            />

            <Select
              placeholder={t('按价格字段筛选')}
              value={ratioTypeFilter}
              onChange={setRatioTypeFilter}
              className='w-full sm:w-48'
              disabled={loading || syncLoading || confirmLoading}
              showClear
              onClear={() => setRatioTypeFilter('')}
            >
              <Select.Option value='model_ratio'>{t('模型倍率')}</Select.Option>
              <Select.Option value='completion_ratio'>
                {t('补全倍率')}
              </Select.Option>
              <Select.Option value='cache_ratio'>{t('缓存倍率')}</Select.Option>
              <Select.Option value='create_cache_ratio'>
                {t('缓存创建倍率')}
              </Select.Option>
              <Select.Option value='image_ratio'>{t('图片倍率')}</Select.Option>
              <Select.Option value='audio_ratio'>{t('音频倍率')}</Select.Option>
              <Select.Option value='audio_completion_ratio'>
                {t('音频补全倍率')}
              </Select.Option>
              <Select.Option value='model_price'>{t('固定价格')}</Select.Option>
              <Select.Option value='billing_expr'>
                {t('表达式计费')}
              </Select.Option>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDifferenceTable = () => {
    const dataSource = useMemo(() => {
      return Object.entries(differences).map(([model, ratioTypes]) => {
        const hasPrice = 'model_price' in ratioTypes;
        const hasOtherRatio = ratioSyncFields.some((rt) => rt in ratioTypes);

        return {
          key: model,
          model,
          ratioTypes,
          billingConflict: hasPrice && hasOtherRatio,
        };
      });
    }, [differences]);

    const filteredDataSource = useMemo(() => {
      if (!searchKeyword.trim() && !ratioTypeFilter) {
        return dataSource;
      }

      return dataSource.filter((item) => {
        const matchesKeyword =
          !searchKeyword.trim() ||
          item.model.toLowerCase().includes(searchKeyword.toLowerCase().trim());

        const matchesRatioType =
          !ratioTypeFilter || ratioTypeFilter in item.ratioTypes;

        return matchesKeyword && matchesRatioType;
      });
    }, [dataSource, searchKeyword, ratioTypeFilter]);

    const upstreamNames = useMemo(() => {
      const set = new Set();
      filteredDataSource.forEach((row) => {
        getOrderedRatioTypes(row.ratioTypes).forEach((ratioType) => {
          Object.keys(row.ratioTypes[ratioType]?.upstreams || {}).forEach(
            (name) => set.add(name),
          );
        });
      });
      return Array.from(set);
    }, [filteredDataSource, ratioTypeFilter]);

    const renderValueTag = (value, color = 'default') => {
      if (value === null || value === undefined) {
        return (
          <Tag color='default' shape='circle'>
            {t('未设置')}
          </Tag>
        );
      }

      const text = String(value);
      return (
        <Tooltip content={text}>
          <Tag color={color} shape='circle'>
            <span className='inline-block max-w-[360px] truncate align-bottom'>
              {text}
            </span>
          </Tag>
        </Tooltip>
      );
    };

    const renderCurrentFields = (record) => {
      const fields = getOrderedRatioTypes(record.ratioTypes);
      return (
        <div className='flex min-w-[260px] flex-col gap-2'>
          {fields.map((ratioType) => (
            <div
              key={ratioType}
              className='flex min-w-0 flex-wrap items-center gap-2'
            >
              <Tag color={stringToColor(ratioType)} shape='circle'>
                {getSyncFieldLabel(ratioType)}
              </Tag>
              {renderValueTag(record.ratioTypes[ratioType]?.current, 'blue')}
            </div>
          ))}
        </div>
      );
    };

    const renderUpstreamField = (record, ratioType, upName) => {
      const diff = record.ratioTypes[ratioType] || {};
      const upstreamVal = diff.upstreams?.[upName];
      const isConfident = diff.confidence?.[upName] !== false;
      const isPreferredField =
        getPreferredSyncField(record.model, ratioType, upName) === ratioType;

      if (upstreamVal === null || upstreamVal === undefined) {
        return renderValueTag(undefined);
      }

      if (upstreamVal === 'same') {
        return (
          <Tag color='blue' shape='circle'>
            {t('与本地相同')}
          </Tag>
        );
      }

      const text = String(upstreamVal);
      const isSelected =
        isPreferredField &&
        resolutions[record.model]?.[ratioType] === upstreamVal;
      const valueNode = isPreferredField ? (
        <Checkbox
          checked={isSelected}
          disabled={loading || syncLoading || confirmLoading}
          onChange={(e) => {
            const isChecked = e.target.checked;
            if (isChecked) {
              selectValue(record.model, ratioType, upstreamVal, upName);
            } else {
              setResolutions((prev) => {
                const newRes = { ...prev };
                deleteResolutionField(newRes, record.model, ratioType);
                return newRes;
              });
            }
          }}
        >
          <Tooltip content={text}>
            <span className='inline-block max-w-[360px] truncate align-bottom'>
              {text}
            </span>
          </Tooltip>
        </Checkbox>
      ) : (
        <Tooltip content={text}>
          <Tag color='default' shape='circle' type='light'>
            <span className='inline-block max-w-[360px] truncate align-bottom'>
              {text}
            </span>
          </Tag>
        </Tooltip>
      );

      return (
        <div className='flex min-w-0 items-center gap-2'>
          {valueNode}
          {!isConfident && (
            <Tooltip
              position='left'
              content={t('该数据可能不可信，请谨慎使用')}
            >
              <AlertTriangle size={16} className='shrink-0 text-yellow-500' />
            </Tooltip>
          )}
        </div>
      );
    };

    const renderUpstreamFields = (record, upName) => {
      const fields = getOrderedRatioTypes(record.ratioTypes).filter(
        (ratioType) => shouldShowSyncField(record.model, ratioType, upName),
      );
      return (
        <div className='flex min-w-[280px] flex-col gap-2'>
          {fields.map((ratioType) => (
            <div key={ratioType} className='flex min-w-0 items-start gap-2'>
              <Tag
                color={stringToColor(ratioType)}
                shape='circle'
                className='shrink-0'
              >
                {getSyncFieldLabel(ratioType)}
              </Tag>
              <div className='min-w-0 flex-1'>
                {renderUpstreamField(record, ratioType, upName)}
              </div>
            </div>
          ))}
        </div>
      );
    };

    if (filteredDataSource.length === 0) {
      if (syncLoading) {
        return (
          <div className='flex min-h-[260px] flex-col items-center justify-center gap-3'>
            <Spin size='large' />
            <div className='text-sm text-gray-500'>
              {t('正在同步上游价格，请稍候')}
            </div>
          </div>
        );
      }

      return (
        <Empty
          image={<IllustrationNoResult style={{ width: 150, height: 150 }} />}
          darkModeImage={
            <IllustrationNoResultDark style={{ width: 150, height: 150 }} />
          }
          description={
            searchKeyword.trim()
              ? t('未找到匹配的模型')
              : Object.keys(differences).length === 0
                ? hasSynced
                  ? t('暂无差异化价格显示')
                  : t('请先选择同步渠道')
                : t('请先选择同步渠道')
          }
          style={{ padding: 30 }}
        />
      );
    }

    const columns = [
      {
        title: t('模型'),
        dataIndex: 'model',
        fixed: 'left',
        render: (text, record) => (
          <div className='flex min-w-[180px] items-center gap-2'>
            <span className='font-medium'>{text}</span>
            {record.billingConflict && (
              <Tooltip
                position='top'
                content={t('该模型存在固定价格与倍率计费方式冲突，请确认选择')}
              >
                <AlertTriangle size={14} className='shrink-0 text-yellow-500' />
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        title: t('当前价格'),
        dataIndex: 'current',
        render: (_, record) => renderCurrentFields(record),
      },
      ...upstreamNames.map((upName) => {
        const channelStats = (() => {
          let selectableCount = 0;
          let selectedCount = 0;

          filteredDataSource.forEach((row) => {
            getOrderedRatioTypes(row.ratioTypes).forEach((ratioType) => {
              const upstreamVal =
                row.ratioTypes[ratioType]?.upstreams?.[upName];
              if (
                getPreferredSyncField(row.model, ratioType, upName) ===
                  ratioType &&
                isSelectableUpstreamValue(upstreamVal)
              ) {
                selectableCount++;
                if (resolutions[row.model]?.[ratioType] === upstreamVal) {
                  selectedCount++;
                }
              }
            });
          });

          return {
            selectableCount,
            selectedCount,
            allSelected:
              selectableCount > 0 && selectedCount === selectableCount,
            partiallySelected:
              selectedCount > 0 && selectedCount < selectableCount,
            hasSelectableItems: selectableCount > 0,
          };
        })();

        const handleBulkSelect = (checked) => {
          if (checked) {
            filteredDataSource.forEach((row) => {
              getOrderedRatioTypes(row.ratioTypes).forEach((ratioType) => {
                const upstreamVal =
                  row.ratioTypes[ratioType]?.upstreams?.[upName];
                if (
                  getPreferredSyncField(row.model, ratioType, upName) ===
                    ratioType &&
                  isSelectableUpstreamValue(upstreamVal)
                ) {
                  selectValue(row.model, ratioType, upstreamVal, upName);
                }
              });
            });
          } else {
            setResolutions((prev) => {
              const newRes = { ...prev };
              filteredDataSource.forEach((row) => {
                getOrderedRatioTypes(row.ratioTypes).forEach((ratioType) => {
                  if (
                    row.ratioTypes[ratioType]?.upstreams?.[upName] !== undefined
                  ) {
                    deleteResolutionField(newRes, row.model, ratioType);
                  }
                });
              });
              return newRes;
            });
          }
        };

        return {
          title: channelStats.hasSelectableItems ? (
            <Checkbox
              checked={channelStats.allSelected}
              indeterminate={channelStats.partiallySelected}
              disabled={loading || syncLoading || confirmLoading}
              onChange={(e) => handleBulkSelect(e.target.checked)}
            >
              {upName}
            </Checkbox>
          ) : (
            <span>{upName}</span>
          ),
          dataIndex: upName,
          render: (_, record) => renderUpstreamFields(record, upName),
        };
      }),
    ];

    return (
      <Table
        columns={columns}
        dataSource={getCurrentPageData(filteredDataSource)}
        pagination={{
          currentPage: currentPage,
          pageSize: pageSize,
          total: filteredDataSource.length,
          showSizeChanger: true,
          showQuickJumper: true,
          pageSizeOptions: ['5', '10', '20', '50'],
          onChange: (page, size) => {
            setCurrentPage(page);
            setPageSize(size);
          },
          onShowSizeChange: (current, size) => {
            setCurrentPage(1);
            setPageSize(size);
          },
        }}
        scroll={{ x: 'max-content' }}
        size='middle'
        loading={loading || syncLoading}
      />
    );
  };

  const updateChannelEndpoint = useCallback((channelId, endpoint) => {
    setChannelEndpoints((prev) => ({ ...prev, [channelId]: endpoint }));
  }, []);

  const handleModalClose = () => {
    setModalVisible(false);
    if (channelSelectorRef.current) {
      channelSelectorRef.current.resetPagination();
    }
  };

  return (
    <>
      <Form.Section text={t('官方价格同步')}>
        <OfficialPriceSyncPanel
          t={t}
          disabled={loading || syncLoading || confirmLoading}
          refresh={props.refresh}
        />
      </Form.Section>
      <Collapse className='mt-4'>
        <Collapse.Panel header={t('渠道价格同步')} itemKey='channel-price-sync'>
          <div className='pt-3'>
            {renderHeader()}
            {renderDifferenceTable()}
          </div>
        </Collapse.Panel>
      </Collapse>

      <ChannelSelectorModal
        ref={channelSelectorRef}
        t={t}
        visible={modalVisible}
        onCancel={handleModalClose}
        onOk={confirmChannelSelection}
        allChannels={allChannels}
        selectedChannelIds={selectedChannelIds}
        setSelectedChannelIds={setSelectedChannelIds}
        channelEndpoints={channelEndpoints}
        updateChannelEndpoint={updateChannelEndpoint}
      />

      <ConflictConfirmModal
        t={t}
        visible={confirmVisible}
        items={conflictItems}
        loading={confirmLoading}
        onOk={async () => {
          setConfirmLoading(true);
          const curRatios = {
            ModelRatio: JSON.parse(props.options.ModelRatio || '{}'),
            CompletionRatio: JSON.parse(props.options.CompletionRatio || '{}'),
            CacheRatio: JSON.parse(props.options.CacheRatio || '{}'),
            CreateCacheRatio: JSON.parse(
              props.options.CreateCacheRatio || '{}',
            ),
            ImageRatio: JSON.parse(props.options.ImageRatio || '{}'),
            AudioRatio: JSON.parse(props.options.AudioRatio || '{}'),
            AudioCompletionRatio: JSON.parse(
              props.options.AudioCompletionRatio || '{}',
            ),
            ModelPrice: JSON.parse(props.options.ModelPrice || '{}'),
            'billing_setting.billing_mode': JSON.parse(
              props.options['billing_setting.billing_mode'] || '{}',
            ),
            'billing_setting.billing_expr': JSON.parse(
              props.options['billing_setting.billing_expr'] || '{}',
            ),
          };
          try {
            const success = await performSync(curRatios);
            if (success) {
              setConfirmVisible(false);
            }
          } finally {
            setConfirmLoading(false);
          }
        }}
        onCancel={() => setConfirmVisible(false)}
      />
    </>
  );
}
