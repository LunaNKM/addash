'use client';

import React, { useEffect, useRef } from 'react';

/**
 * 대시보드 인사이트 / 보고서 Comment가 함께 쓰는 최소 서식 편집기.
 *
 * 굵게는 Ctrl+B(맥은 ⌘B)나 B 버튼으로 지정한 부분에만 적용된다.
 * 문장 모양(하이픈, 대괄호 등)을 보고 굵게 하거나 제목으로 만드는 자동 서식은 없다.
 * 저장 형식은 `<b>`와 줄바꿈만 남긴 문자열이라, 다른 태그는 저장·표시 양쪽에서 버려진다.
 */
export function RichText({ text, className, lineClassName = 'insight-line' }: {
  text: string;
  className: string;
  lineClassName?: string;
}) {
  const lines = sanitizeStored(text).replace(/\r\n/g, '\n').split('\n');
  return (
    <div className={className}>
      {lines.map((line, index) => (
        <div className={lineClassName} key={index}>
          {renderLine(line)}
        </div>
      ))}
    </div>
  );
}

export function RichTextEditor({ initialText, placeholder, busy, minHeight, onCancel, onSave }: {
  initialText: string;
  placeholder: string;
  busy: string;
  minHeight?: number;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = toEditorHtml(initialText);
    editorRef.current.focus();
  }, [initialText]);

  function applyBold() {
    editorRef.current?.focus();
    document.execCommand('bold');
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applyBold();
    }
  }

  /** 붙여넣기는 서식을 버리고 글자만 넣는다. */
  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  }

  return (
    <div className="insight-editor">
      <div className="insight-toolbar">
        <button
          className="insight-bold-btn"
          type="button"
          title="굵게 (Ctrl+B / ⌘B)"
          onMouseDown={event => event.preventDefault()}
          onClick={applyBold}
        >
          B
        </button>
        <span className="muted">굵게: Ctrl+B / ⌘B</span>
      </div>
      <div
        className="insight-input"
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        style={minHeight ? { minHeight } : undefined}
        data-placeholder={placeholder}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      <div className="modal-actions">
        <button className="btn outline" disabled={Boolean(busy)} onClick={onCancel}>취소</button>
        <button className="btn brand" disabled={Boolean(busy)} onClick={() => onSave(serializeEditor(editorRef.current))}>저장</button>
      </div>
    </div>
  );
}

/** `<b>...</b>`만 굵게 살리고 나머지는 그대로 글자로 보여준다. */
function renderLine(line: string): React.ReactNode {
  if (!line) return <br />;
  const nodes: React.ReactNode[] = [];
  const pattern = /<b>([\s\S]*?)<\/b>/g;
  let cursor = 0;
  let match = pattern.exec(line);
  while (match) {
    if (match.index > cursor) nodes.push(decode(line.slice(cursor, match.index)));
    nodes.push(<b key={match.index}>{decode(match[1])}</b>);
    cursor = match.index + match[0].length;
    match = pattern.exec(line);
  }
  if (cursor < line.length) nodes.push(decode(line.slice(cursor)));
  return nodes;
}

/* ------------------------------------------------------------------ 저장 형식 */

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** `<b>` 외의 태그는 버린다. 예전에 저장한 순수 텍스트도 그대로 통과한다. */
function sanitizeStored(text: string): string {
  return text.replace(/<(?!\/?b>)[^>]*>/g, '');
}

function toEditorHtml(text: string): string {
  return sanitizeStored(text).replace(/\r\n/g, '\n').split('\n').join('<br>');
}

/** contenteditable 안의 DOM을 `<b>`와 줄바꿈만 남긴 문자열로 바꾼다. */
function serializeEditor(root: HTMLElement | null): string {
  if (!root) return '';
  return serializeNodes(Array.from(root.childNodes), false)
    .replace(/\u00a0/g, ' ')
    // 브라우저가 글자마다 태그를 쪼개기도 해서 이어 붙인다.
    .replace(/<\/b><b>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function serializeNodes(nodes: Node[], bold: boolean): string {
  let out = '';
  for (const node of nodes) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as HTMLElement).tagName);
    // 앞에 감싸이지 않은 글자가 있으면 블록이 시작될 때 줄을 넘긴다. (크롬이 첫 줄만 div로 감싸지 않는다)
    if (isBlock && out && !out.endsWith('\n')) out += '\n';
    out += serializeNode(node, bold);
  }
  return out;
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function serializeNode(node: Node, bold: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = escapeText(node.nodeValue || '');
    return value && bold ? `<b>${value}</b>` : value;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  if (element.tagName === 'BR') return '\n';

  const isBold = bold || isBoldElement(element);
  const inner = serializeNodes(Array.from(element.childNodes), isBold);
  // 브라우저가 줄마다 감싸는 div/p는 줄바꿈으로 되돌린다.
  if (BLOCK_TAGS.has(element.tagName)) return inner.endsWith('\n') ? inner : `${inner}\n`;
  return inner;
}

function isBoldElement(element: HTMLElement): boolean {
  if (element.tagName === 'B' || element.tagName === 'STRONG') return true;
  const weight = element.style?.fontWeight || '';
  if (weight === 'bold' || weight === 'bolder') return true;
  return Number(weight) >= 600;
}
