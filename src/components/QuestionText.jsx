import { MathText } from './MathText.jsx';

const romanPattern = '[ivxlcdm]+';

function normalizeLabel(value = '') {
  return String(value || '').replace(/[().]/g, '').trim().toUpperCase();
}

function matchStatementLine(line = '') {
  const text = String(line || '').trim();
  return (
    text.match(new RegExp(`^statement\\s+(${romanPattern}|\\d+)\\s*[:.)-]\\s*(.+)$`, 'i')) ||
    text.match(new RegExp(`^\\(?(${romanPattern}|\\d+)\\)?[.)]\\s+(.+)$`, 'i'))
  );
}

function matchAssertionLine(line = '') {
  return String(line || '').trim().match(/^(assertion|reason)\s*(?:\([a-r]\))?\s*[:.)-]\s*(.+)$/i);
}

function parseQuestionContent(content = '') {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const assertionRows = [];
  const assertionIndices = [];
  lines.forEach((line, index) => {
    const match = matchAssertionLine(line);
    if (!match) return;
    assertionIndices.push(index);
    assertionRows.push({
      label: match[1].toLowerCase() === 'reason' ? 'Reason' : 'Assertion',
      text: match[2]
    });
  });

  const hasAssertion = assertionRows.some((row) => row.label === 'Assertion');
  const hasReason = assertionRows.some((row) => row.label === 'Reason');
  if (hasAssertion && hasReason) {
    const firstIndex = Math.min(...assertionIndices);
    const lastIndex = Math.max(...assertionIndices);
    return {
      type: 'assertion',
      direction: lines.slice(0, firstIndex).join('\n'),
      rows: assertionRows,
      prompt: lines.slice(lastIndex + 1).join('\n')
    };
  }

  const statementRows = [];
  const statementIndices = [];
  lines.forEach((line, index) => {
    const match = matchStatementLine(line);
    if (!match) return;
    statementIndices.push(index);
    statementRows.push({
      label: normalizeLabel(match[1]),
      text: match[2]
    });
  });

  if (statementRows.length >= 2) {
    const firstIndex = statementIndices[0];
    const lastIndex = statementIndices[statementIndices.length - 1];
    return {
      type: 'statement',
      direction: lines.slice(0, firstIndex).join('\n'),
      rows: statementRows,
      prompt: lines.slice(lastIndex + 1).join('\n')
    };
  }

  return { type: 'plain', text: content };
}

function PlainQuestionText({ content, variant }) {
  return (
    <MathText
      as={variant === 'quiz' ? 'h2' : 'div'}
      content={content}
      className={
        variant === 'quiz'
          ? 'text-lg sm:text-xl font-bold mb-8 devanagari leading-relaxed text-navy'
          : 'font-semibold devanagari text-gray-800 leading-relaxed'
      }
    />
  );
}

export function QuestionText({ content = '', variant = 'quiz' }) {
  const parsed = parseQuestionContent(content);
  if (parsed.type === 'plain') {
    return <PlainQuestionText content={content} variant={variant} />;
  }

  const compact = variant !== 'quiz';
  const label = parsed.type === 'assertion' ? 'Assertion Reason' : 'Statement Based';

  return (
    <div className={compact ? 'space-y-3 devanagari' : 'mb-8 space-y-4 devanagari'}>
      {parsed.direction && (
        <MathText
          as="div"
          content={parsed.direction}
          className={compact ? 'text-sm font-semibold leading-relaxed text-gray-800' : 'text-base font-bold leading-relaxed text-navy'}
        />
      )}

      <div className={compact ? 'rounded-xl border bg-white p-3' : 'rounded-2xl border bg-slate-50 p-4'} style={{borderColor:'#E2E8F0'}}>
        <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-orange-700">
          {label}
        </div>
        <div className="space-y-2">
          {parsed.rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="flex gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <span className="flex shrink-0 items-center justify-center rounded-full bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">
                {row.label}
              </span>
              <MathText
                as="div"
                content={row.text}
                className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-slate-800"
              />
            </div>
          ))}
        </div>
      </div>

      {parsed.prompt && (
        <MathText
          as={compact ? 'div' : 'h2'}
          content={parsed.prompt}
          className={compact ? 'text-sm font-bold leading-relaxed text-gray-800' : 'text-lg sm:text-xl font-bold leading-relaxed text-navy'}
        />
      )}
    </div>
  );
}
