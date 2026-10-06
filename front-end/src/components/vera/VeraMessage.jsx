// Renders a VERA reply. VERA answers with a small Markdown subset (bold, bullet
// lists, pipe tables). Everything is built as React elements — never
// innerHTML — so model or data text can't inject markup, the same guarantee the
// ESWMP VERA got by rendering plain text.

const renderInline = (text, keyPrefix) => String(text)
  .split(/(\*\*[^*]+\*\*)/g)
  .filter(Boolean)
  .map((part, index) => (part.startsWith('**') && part.endsWith('**')
    ? <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
    : <span key={`${keyPrefix}-${index}`}>{part.replace(/\*([^*]+)\*/g, '$1')}</span>));

const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
const isSeparator = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());

const parseBlocks = (content) => {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        if (!isSeparator(lines[index])) rows.push(splitRow(lines[index]));
        index += 1;
      }
      if (rows.length) blocks.push({ type: 'table', head: rows[0], body: rows.slice(1) });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*•]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*•]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    if (line.trim()) blocks.push({ type: 'p', text: line.replace(/^#{1,6}\s+/, '') , heading: /^#{1,6}\s+/.test(line) });
    index += 1;
  }
  return blocks;
};

export default function VeraMessage({ content }) {
  return (
    <div className="vera-md">
      {parseBlocks(content).map((block, i) => {
        if (block.type === 'table') {
          return (
            <div className="vera-table-wrap" key={i}>
              <table className="vera-table">
                <thead><tr>{block.head.map((cell, c) => <th key={c}>{renderInline(cell, `h${i}-${c}`)}</th>)}</tr></thead>
                <tbody>
                  {block.body.map((row, r) => (
                    <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell, `c${i}-${r}-${c}`)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === 'list') {
          return <ul key={i}>{block.items.map((item, k) => <li key={k}>{renderInline(item, `l${i}-${k}`)}</li>)}</ul>;
        }
        return <p key={i} className={block.heading ? 'vera-md-heading' : undefined}>{renderInline(block.text, `p${i}`)}</p>;
      })}
    </div>
  );
}
