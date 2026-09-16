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
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Modal, Select } from '@douyinfe/semi-ui';

/** 新建渠道成功后的落点偏好：true=模型路由，false=渠道管理列表。 */
export const CHANNEL_CREATE_FOLLOW_TARGET_KEY = 'channel_create_follow_routing';

export const readStoredFollowRouting = () => {
  try {
    return (
      window.localStorage.getItem(CHANNEL_CREATE_FOLLOW_TARGET_KEY) !== 'false'
    );
  } catch {
    return true;
  }
};

export const writeStoredFollowRouting = (followRouting) => {
  try {
    window.localStorage.setItem(
      CHANNEL_CREATE_FOLLOW_TARGET_KEY,
      String(followRouting),
    );
  } catch {}
};

export const CHANNEL_LIST_PATH = '/console/channel';

/**
 * 创建渠道弹窗共用「底栏开关」的落点行为：偏好开着就带上落地模型选择跟随到
 * 模型路由（粘贴监听器沿用多年的跳转），关掉就落回渠道管理列表。创建响应不带
 * 渠道 ID，但路由表按模型组织，点名一个该渠道服务的模型就够落到它那一行——
 * 工作台会从这个模型推出 vendor。多模型渠道让操作者选落地模型，而不是永远落
 * 字母序第一个；单模型渠道维持直接跳转。
 *
 * landingModal 由调用方渲染，要活得比创建弹窗的关闭动画久。
 */
export const useRoutingFollowUp = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [routingChoice, setRoutingChoice] = useState(null);

  const onChannelList = location.pathname === CHANNEL_LIST_PATH;

  const navigateToRouting = useCallback(
    (model) => {
      const params = new URLSearchParams({
        tab: 'routing',
        routing_model: model,
      });
      navigate(`/console/models?${params.toString()}`);
    },
    [navigate],
  );

  const followCreated = useCallback(
    (createdModels) => {
      if (!readStoredFollowRouting()) {
        if (!onChannelList) navigate(CHANNEL_LIST_PATH);
        return;
      }
      const models = [...new Set(createdModels)].sort((a, b) =>
        a.localeCompare(b),
      );
      const [firstByName] = models;
      if (!firstByName) return;
      if (models.length === 1) {
        navigateToRouting(firstByName);
        return;
      }
      setRoutingChoice({ models, selected: firstByName });
    },
    [navigateToRouting, onChannelList],
  );

  const landingModal = (
    <Modal
      title={t('前往模型路由')}
      visible={routingChoice !== null}
      onCancel={() => setRoutingChoice(null)}
      onOk={() => {
        if (routingChoice?.selected) {
          navigateToRouting(routingChoice.selected);
        }
        setRoutingChoice(null);
      }}
      okText={t('前往')}
      cancelText={t('留在此页')}
      size='small'
    >
      <div className='mb-2'>{t('选择路由表要定位的模型')}</div>
      <Select
        value={routingChoice?.selected}
        onChange={(value) =>
          setRoutingChoice((current) =>
            current ? { ...current, selected: value } : current,
          )
        }
        className='w-full'
        optionList={routingChoice?.models.map((model) => ({
          value: model,
          label: model,
        }))}
      />
    </Modal>
  );

  return { followCreated, landingModal };
};
