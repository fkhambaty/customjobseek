export interface ResumeTextItem {
  str: string;
  x: number;
  y: number;
}

export interface ResumeTextPage {
  width: number;
  items: ResumeTextItem[];
}

interface Line {
  x: number;
  y: number;
  text: string;
}

const MAIN_HEADING = /^(?:professional |work )?experience$/i;
const SIDE_HEADING = /^(?:education|skills|technical skills|core strengths|interests|software|certifications?|accomplishments?|achievements?|languages)$/i;

function lines(items: ResumeTextItem[]): Line[] {
  const rows: ResumeTextItem[][] = [];
  for (const item of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs((r[0]?.y ?? 0) - item.y) <= 2.5);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows
    .map((row) => {
      const ordered = row.sort((a, b) => a.x - b.x);
      return {
        x: ordered[0]?.x ?? 0,
        y: ordered[0]?.y ?? 0,
        text: ordered.map((i) => i.str.trim()).filter(Boolean).join(" ").replace(/\s+([,.;:])/g, "$1"),
      };
    })
    .filter((line) => line.text);
}

function oneColumn(pageLines: Line[]): string {
  return pageLines.sort((a, b) => b.y - a.y || a.x - b.x).map((line) => line.text).join("\n");
}

function joinWrapped(linesToJoin: Line[]): string[] {
  const out: { y: number; text: string }[] = [];
  for (const line of linesToJoin) {
    const previous = out[out.length - 1];
    const continuesPhrase = previous && /(?:&|\/|,|\b(?:and|or|of|for|with|the))$/i.test(previous.text);
    if (previous && (previous.y - line.y <= 8.5 || continuesPhrase) && !MAIN_HEADING.test(previous.text) && !MAIN_HEADING.test(line.text)) {
      previous.text = `${previous.text} ${line.text}`;
      previous.y = line.y;
    } else {
      out.push({ y: line.y, text: line.text });
    }
  }
  return out.map((line) => line.text);
}

/** Restores reading order for the common sidebar + main-column resume layout. */
export function resumeTextInReadingOrder(pages: ResumeTextPage[]): string {
  return pages.map((page) => {
    const split = page.width * 0.37;
    const left = lines(page.items.filter((item) => item.x < split));
    const right = lines(page.items.filter((item) => item.x >= split));
    const work = right.find((line) => MAIN_HEADING.test(line.text));
    const firstSideHeading = left.filter((line) => SIDE_HEADING.test(line.text)).sort((a, b) => b.y - a.y)[0];
    if (!work || !firstSideHeading) return oneColumn(lines(page.items));

    const mainHeader = right.filter((line) => line.y > work.y).sort((a, b) => b.y - a.y);
    const contact = left.filter((line) => line.y > firstSideHeading.y).sort((a, b) => b.y - a.y);
    const mainBody = right.filter((line) => line.y <= work.y).sort((a, b) => b.y - a.y);
    const sideBody = left.filter((line) => line.y <= firstSideHeading.y).sort((a, b) => b.y - a.y);

    const name = mainHeader[0];
    const summary = mainHeader.slice(1);
    return [
      name?.text,
      ...contact.map((line) => line.text),
      summary.length ? "SUMMARY" : "",
      summary.map((line) => line.text).join(" "),
      ...joinWrapped(mainBody),
      ...sideBody.map((line) => line.text),
    ].filter(Boolean).join("\n");
  }).join("\n");
}
