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
import { Tooltip } from '@douyinfe/semi-ui';

import { LinkifiedText } from './LinkifiedText';

const channelRemarkTooltipStyle = {
  width: 'max-content',
  maxWidth: 'min(48rem, calc(100vw - 32px))',
  maxHeight: 'min(24rem, calc(100vh - 32px))',
  overflow: 'auto',
  padding: '12px 16px',
  wordWrap: 'normal',
};

export function ChannelRemarkTooltip(props) {
  return (
    <Tooltip
      content={
        <div style={{ lineHeight: 1.6 }}>
          {props.title ? (
            <div
              style={{
                fontWeight: 600,
                marginBottom: props.remark ? 4 : 0,
                overflowWrap: 'anywhere',
              }}
            >
              {props.title}
            </div>
          ) : null}
          {props.remark ? (
            <LinkifiedText
              text={props.remark}
              linkClassName='whitespace-nowrap'
            />
          ) : null}
        </div>
      }
      trigger='hover'
      position={props.position || 'topLeft'}
      mouseLeaveDelay={350}
      spacing={2}
      style={channelRemarkTooltipStyle}
    >
      {props.children}
    </Tooltip>
  );
}
