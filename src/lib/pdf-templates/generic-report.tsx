/**
 * Generic Report Template — Handles all report types via parsed markdown.
 *
 * This template renders any AI-generated report (sales, inventory, customer,
 * financial) into a polished PDF with:
 *   - Branded title page
 *   - Table of contents
 *   - Sections with headings, tables, charts, bullet points
 *   - Professional headers/footers with page numbers
 *   - Flexbox-based layout with automatic page breaks
 */

import React from "react";
import { Document } from "@react-pdf/renderer";
import {
  createStyles,
  TitlePage,
  TocPage,
  PageShell,
  Section,
  ChartFigure,
  type Branding,
  type ReportMeta,
  type ParsedSection,
  type ChartImage,
} from "./shared";

export interface GenericReportProps {
  branding: Branding;
  meta: ReportMeta;
  sections: ParsedSection[];
  /** Charts that don't belong to a specific section */
  orphanCharts?: ChartImage[];
  /** Show title page */
  showTitlePage?: boolean;
  /** Show table of contents */
  showToc?: boolean;
}

export function GenericReport({
  branding,
  meta,
  sections,
  orphanCharts = [],
  showTitlePage = true,
  showToc = true,
}: GenericReportProps) {
  const s = createStyles(branding.primaryColor);

  // Calculate running indices for table/chart numbering across sections
  let runningTableIdx = 0;
  let runningChartIdx = 0;
  const sectionMeta = sections.map((sec) => {
    const tStart = runningTableIdx;
    const cStart = runningChartIdx;
    runningTableIdx += sec.tables.length;
    runningChartIdx += sec.charts.length;
    return { tableStart: tStart, chartStart: cStart };
  });

  return (
    <Document
      title={meta.title}
      author={branding.companyName}
      subject={meta.subtitle ?? ""}
      creator="Business IQ Enterprise"
    >
      {/* Title page */}
      {showTitlePage ? (
        <TitlePage branding={branding} meta={meta} styles={s} />
      ) : null}

      {/* Table of Contents */}
      {showToc ? (
        <TocPage branding={branding} meta={meta} sections={sections} styles={s} />
      ) : null}

      {/* Content pages */}
      <PageShell branding={branding} meta={meta} styles={s}>
        {sections.map((section, i) => (
          <Section
            key={i}
            section={section}
            branding={branding}
            styles={s}
            tableStartIndex={sectionMeta[i].tableStart}
            chartStartIndex={sectionMeta[i].chartStart}
          />
        ))}

        {/* Orphan charts (not associated with any section) */}
        {orphanCharts.length > 0
          ? orphanCharts.map((chart, i) => (
              <ChartFigure
                key={`orphan-${i}`}
                chart={chart}
                figureIndex={runningChartIdx + i + 1}
                styles={s}
              />
            ))
          : null}
      </PageShell>
    </Document>
  );
}

export default GenericReport;
