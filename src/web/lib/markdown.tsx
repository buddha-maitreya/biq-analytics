/**
 * Shared markdown renderer for chat UI and reports page.
 *
 * Supports: h1/h2/h3, bold (**text**), bullet lists, pipe tables, hr, paragraphs.
 * Output is wrapped in <div className="report-markdown"> which is styled by global.css.
 */

import React from "react";

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|/.test(line.trim());
}

export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let keyCounter = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const key = keyCounter++;

    if (line.startsWith("### ")) {
      elements.push(<h3 key={key}>{renderInline(line.slice(4))}</h3>);
      i++;
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={key}>{renderInline(line.slice(3))}</h2>);
      i++;
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={key}>{renderInline(line.slice(2))}</h1>);
      i++;
    } else if (/^---+\s*$/.test(trimmed)) {
      elements.push(<hr key={key} />);
      i++;
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      // Collect all consecutive bullet lines into one <ul>
      const items: React.ReactNode[] = [];
      const startKey = key;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith("- ") || t.startsWith("* ")) {
          items.push(<li key={i}>{renderInline(t.slice(2))}</li>);
          i++;
          keyCounter++;
        } else {
          break;
        }
      }
      elements.push(<ul key={startKey}>{items}</ul>);
    } else if (trimmed.startsWith("|")) {
      // Collect all consecutive table lines into one <table>
      const tableLines: string[] = [];
      const startKey = key;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
        keyCounter++;
      }
      let headers: string[] = [];
      const bodyRows: string[][] = [];
      let pastHeader = false;
      for (const tl of tableLines) {
        if (isTableSeparator(tl)) {
          pastHeader = true;
          continue;
        }
        const cells = parseTableRow(tl);
        if (!pastHeader) {
          headers = cells;
        } else {
          bodyRows.push(cells);
        }
      }
      if (headers.length > 0) {
        elements.push(
          <table key={startKey}>
            <thead>
              <tr>
                {headers.map((h, ci) => <th key={ci}>{renderInline(h)}</th>)}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci}>{renderInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
    } else if (trimmed === "") {
      elements.push(<br key={key} />);
      i++;
    } else {
      elements.push(<p key={key}>{renderInline(line)}</p>);
      i++;
    }
  }

  return <div className="report-markdown">{elements}</div>;
}
