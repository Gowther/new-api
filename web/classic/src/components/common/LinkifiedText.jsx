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

const URL_CANDIDATE_REGEX =
  /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?::\d+)?(?:[/?#][^\s<>"']*)?/g;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?，。；：！？、]+$/;
const ALWAYS_TRAILING_BRACKETS = '）】》〉」』';
const PAIRED_TRAILING_BRACKETS = [
  { closing: ')', opening: '(' },
  { closing: ']', opening: '[' },
  { closing: '}', opening: '{' },
];

export function LinkifiedText({ text, className = '', linkClassName = '' }) {
  const segments = parseLinkifiedText(text);
  const rootClassName = ['whitespace-pre-wrap break-words', className]
    .filter(Boolean)
    .join(' ');
  const anchorClassName = [
    'font-medium underline underline-offset-2 hover:opacity-80',
    linkClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={rootClassName}>
      {segments.map((segment) => {
        if (segment.type === 'text') {
          return <span key={segment.key}>{segment.text}</span>;
        }

        return (
          <a
            key={segment.key}
            href={segment.href}
            target='_blank'
            rel='noopener noreferrer'
            className={anchorClassName}
            onClick={stopLinkPropagation}
          >
            {segment.text}
          </a>
        );
      })}
    </span>
  );
}

function parseLinkifiedText(text) {
  const segments = [];
  let cursor = 0;

  URL_CANDIDATE_REGEX.lastIndex = 0;
  let match = URL_CANDIDATE_REGEX.exec(text);

  while (match) {
    const candidate = match[0];
    const start = match.index;

    if (!isUnsafeCandidateBoundary(text, candidate, start)) {
      const normalized = normalizeLinkCandidate(candidate);

      if (normalized) {
        appendTextSegment(segments, text.slice(cursor, start), cursor);
        segments.push({
          type: 'link',
          key: `link-${start}`,
          text: normalized.text,
          href: normalized.href,
        });
        appendTextSegment(
          segments,
          normalized.trailingText,
          start + normalized.text.length,
        );
        cursor = start + candidate.length;
      }
    }

    match = URL_CANDIDATE_REGEX.exec(text);
  }

  appendTextSegment(segments, text.slice(cursor), cursor);
  return segments;
}

function appendTextSegment(segments, text, start) {
  if (!text) {
    return;
  }

  segments.push({
    type: 'text',
    key: `text-${start}`,
    text,
  });
}

function normalizeLinkCandidate(candidate) {
  const normalized = splitTrailingText(candidate);
  if (!normalized.text) {
    return null;
  }

  const href = getSafeHref(normalized.text);
  if (!href) {
    return null;
  }

  return {
    ...normalized,
    href,
  };
}

function splitTrailingText(candidate) {
  let text = candidate;
  let trailingText = '';
  let changed = true;

  while (changed && text) {
    changed = false;

    const withoutPunctuation = text.replace(TRAILING_PUNCTUATION_REGEX, '');
    if (withoutPunctuation.length !== text.length) {
      trailingText = text.slice(withoutPunctuation.length) + trailingText;
      text = withoutPunctuation;
      changed = true;
      continue;
    }

    const lastChar = text.at(-1);
    if (!lastChar) {
      continue;
    }

    if (ALWAYS_TRAILING_BRACKETS.includes(lastChar)) {
      trailingText = lastChar + trailingText;
      text = text.slice(0, -1);
      changed = true;
      continue;
    }

    const bracketPair = PAIRED_TRAILING_BRACKETS.find(
      (pair) => pair.closing === lastChar,
    );
    if (
      bracketPair &&
      countCharacter(text, bracketPair.closing) >
        countCharacter(text, bracketPair.opening)
    ) {
      trailingText = lastChar + trailingText;
      text = text.slice(0, -1);
      changed = true;
    }
  }

  return { text, trailingText };
}

function getSafeHref(text) {
  const hrefText = /^https?:\/\//i.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(hrefText);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (!url.hostname) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function isUnsafeCandidateBoundary(text, candidate, start) {
  if (/^https?:\/\//i.test(candidate)) {
    return false;
  }

  if (text.slice(Math.max(0, start - 3), start) === '://') {
    return true;
  }

  const previousChar = text[start - 1];
  return previousChar ? /[\w@.-]/.test(previousChar) : false;
}

function countCharacter(text, character) {
  let count = 0;
  for (const item of text) {
    if (item === character) {
      count += 1;
    }
  }
  return count;
}

function stopLinkPropagation(event) {
  event.stopPropagation();
}
