'use client';

import React, { useEffect, useRef } from 'react';

/**
 * 대시보드 인사이트 / 보고서 Comment가 함께 쓰는 최소 서식 편집기.
 *
 * 굵게는 Ctrl+B(맥은 ⌘B)나 B 버튼으로 지정한 부분에만 적용된다.
 * 문장 모양(하이픈, 대괄호 등)을 보고 굵게 하거나 제목으로 만드는 자동 서식은 없다.
 * 저장 형식은 `<b>`와 줄바꿈만 남긴 문자열이라, 다른 태그는 저장·표시 양쪽에서 버려진다.
 * 엑셀·구글 시트 등에서 붙여넣은 표만 예외로, 한 줄짜리 `<table><tr><td>`로 저장된다.
 */
export function RichText({ text, className, lineClassName = 'insight-line' }: {
  text: string;
  className: string;
  lineClassName?: string;
}) {
  const lines = sanitizeStored(text).replace(/\r\n/g, '\n').split('\n');
  return (
    <div className={className}>
      {lines.map((line, index) => TABLE_LINE.test(line)
        ? <RichTable key={index} line={line} />
        : (
          <div className={lineClassName} key={index}>
            {renderLine(line)}
          </div>
        ))}
    </div>
  );
}

const TABLE_LINE = /^<table>[\s\S]*<\/table>$/;

function RichTable({ line }: { line: string }) {
  const rows = Array.from(line.matchAll(/<tr>([\s\S]*?)<\/tr>/g), row => Array.from(row[1].matchAll(/<td>([\s\S]*?)<\/td>/g), cell => cell[1]));
  return (
    <div className="rich-table-wrap">
      <table className="rich-table">
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => <td key={cellIndex}>{cell ? renderLine(cell) : null}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
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

  /** 붙여넣기는 서식을 버리고 글자만 넣는다. 표가 들어 있으면 표만 살린다. */
  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    const tables = html.includes('<table')
      ? Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll<HTMLTableElement>('table:not(table table)'))
      : [];
    // shortcut: 표와 함께 복사된 표 밖의 글자는 버린다. 문서 통째 붙여넣기가 필요해지면 그때 살린다.
    const stored = tables.map(serializeTable).filter(Boolean).join('\n');
    if (stored) document.execCommand('insertHTML', false, toEditorHtml(stored));
    else document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
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

/** `<b>`와 표 태그 외에는 버린다. 예전에 저장한 순수 텍스트도 그대로 통과한다. */
function sanitizeStored(text: string): string {
  return text.replace(/<(?!\/?(?:b|table|tr|td)>)[^>]*>/g, '');
}

function toEditorHtml(text: string): string {
  return sanitizeStored(text).replace(/\r\n/g, '\n').split('\n').join('<br>')
    // 표는 이미 블록이라 바로 뒤의 줄바꿈까지 넣으면 저장할 때마다 빈 줄이 늘어난다.
    .replace(/(<\/table>)<br>/g, '$1');
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

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'TR', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
// 구글 시트 등은 붙여넣는 HTML 안에 스타일 글자를 함께 넣는다.
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE']);

function serializeNode(node: Node, bold: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = escapeText(node.nodeValue || '');
    return value && bold ? `<b>${value}</b>` : value;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  if (element.tagName === 'BR') return '\n';
  if (SKIP_TAGS.has(element.tagName)) return '';
  if (element.tagName === 'TABLE') {
    const table = serializeTable(element as HTMLTableElement);
    return table ? `${table}\n` : '';
  }

  const isBold = bold || isBoldElement(element);
  const inner = serializeNodes(Array.from(element.childNodes), isBold);
  // 브라우저가 줄마다 감싸는 div/p는 줄바꿈으로 되돌린다.
  if (BLOCK_TAGS.has(element.tagName)) return inner.endsWith('\n') ? inner : `${inner}\n`;
  return inner;
}

/** 표는 셀 글자(굵게 포함)만 남겨 한 줄로 저장한다. 병합 셀은 풀린 채로 들어간다. */
function serializeTable(table: HTMLTableElement): string {
  const rows = Array.from(table.rows)
    .map(row => Array.from(row.cells)
      .map(cell => `<td>${serializeNodes(Array.from(cell.childNodes), isBoldElement(cell)).replace(/\s+/g, ' ').trim()}</td>`)
      .join(''))
    .filter(Boolean);
  return rows.length ? `<table>${rows.map(row => `<tr>${row}</tr>`).join('')}</table>` : '';
}

function isBoldElement(element: HTMLElement): boolean {
  if (element.tagName === 'B' || element.tagName === 'STRONG') return true;
  const weight = element.style?.fontWeight || '';
  if (weight === 'bold' || weight === 'bolder') return true;
  return Number(weight) >= 600;
}
