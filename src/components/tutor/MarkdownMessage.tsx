import React from 'react';

interface MarkdownMessageProps {
  content: string;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      tokenPattern.lastIndex += 1;
      continue;
    }
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    keyCounter += 1;

    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={keyCounter} className="font-semibold text-zinc-950 dark:text-zinc-200">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={keyCounter}
          className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[12px] text-zinc-900 dark:text-zinc-200"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(
        <em key={keyCounter} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:-]+\|[\s|:-]+$/.test(line.trim());
}

function isHorizontalRule(trimmed: string): boolean {
  return /^([-*_])\1{2,}$/.test(trimmed);
}

function isHeadingLine(trimmed: string): boolean {
  return /^#{1,6}\s+.+$/.test(trimmed);
}

function isBlockBoundary(line: string, nextLine?: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('```')) return true;
  if (isHeadingLine(trimmed)) return true;
  if (isHorizontalRule(trimmed)) return true;
  if (trimmed.startsWith('>')) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+\.\s+/.test(trimmed)) return true;
  if (trimmed.includes('|') && nextLine !== undefined && isTableSeparator(nextLine)) return true;
  return false;
}

const MarkdownMessageInner: React.FC<MarkdownMessageProps> = ({ content }) => {
  const safeContent = typeof content === 'string' ? content : '';
  const lines = safeContent.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const startIndex = i;
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    blockKey += 1;

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1; // skip closing fence
      }
      blocks.push(
        <pre
          key={blockKey}
          className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-zinc-900 dark:text-zinc-200"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Horizontal rule
    if (isHorizontalRule(trimmed)) {
      blocks.push(<hr key={blockKey} className="my-2 border-zinc-200 dark:border-zinc-800" />);
      i += 1;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = parseTableRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={blockKey} className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-md">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                {headers.map((h, idx) => (
                  <th key={idx} className="px-3 py-2 font-semibold text-zinc-900 dark:text-zinc-200">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-zinc-700 dark:text-zinc-300 align-top">
                      {renderInline(row[cIdx] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings (H1 - H6)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const cls =
        level === 1
          ? 'font-display text-base font-semibold text-zinc-950 dark:text-zinc-200 pt-2'
          : level === 2
          ? 'font-display text-sm font-semibold text-zinc-950 dark:text-zinc-200 pt-1.5'
          : level === 3
          ? 'text-sm font-semibold text-zinc-900 dark:text-zinc-200 pt-1'
          : 'text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-400 pt-1';
      blocks.push(
        <div key={blockKey} className={cls}>
          {renderInline(headingText)}
        </div>
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={blockKey}
          className="border-l border-zinc-300 dark:border-zinc-700 pl-3.5 text-sm italic text-zinc-600 dark:text-zinc-400 space-y-1"
        >
          {quoteLines.map((q, idx) => (
            <p key={idx}>{renderInline(q)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={blockKey} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={blockKey} className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-800 dark:text-zinc-300">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Standard paragraph (always consumes at least the current line to guarantee forward progress)
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length && !isBlockBoundary(lines[i], lines[i + 1])) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={blockKey} className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-300">
        {renderInline(paraLines.join(' '))}
      </p>
    );

    // Defensive monotonic-progress invariant so parsing can never infinite-loop
    if (i <= startIndex) {
      i = startIndex + 1;
    }
  }

  return <div className="space-y-3">{blocks}</div>;
};

export const MarkdownMessage = React.memo(MarkdownMessageInner);
