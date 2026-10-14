import type { ReactNode } from "react";

// A deliberately small Markdown reader for the person's own notes and job files.
// It builds React elements, never HTML strings, so nothing in a file can run.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)<>|]+|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      out.push(<a key={k} href={m[2]} target="_blank" rel="noreferrer">{label}</a>);
    } else if (tok.startsWith("http")) out.push(<a key={k} href={tok} target="_blank" rel="noreferrer">{tok.replace(/^https?:\/\/(www\.)?/, "")}</a>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function cells(row: string): string[] {
  return row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(4, h[1]!.length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(<Tag key={key}>{inline(h[2]!, key)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      // Document content, not an application dataset. Leave the rows in source order.
      // Application tables go through rowsInTableOrder("application", ...). "markdown" does not sort.
      blocks.push(
        <div className="md-table" key={key}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}r${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key}>{quote.filter(Boolean).map((q, j) => <p key={j}>{inline(q, `${key}q${j}`)}</p>)}</blockquote>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key}>{items.map((t, j) => <li key={j}>{inline(t, `${key}l${j}`)}</li>)}</List>);
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*>|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i]!)) para.push(lines[i++]!.trim());
    if (!para.length) {
      blocks.push(<p key={key}>{inline(line, key)}</p>);
      i++;
      continue;
    }
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
