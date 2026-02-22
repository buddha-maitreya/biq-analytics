# Reports Feature Roadmap — Business IQ Enterprise

Enterprise-grade report generation with AI-powered content, configurable formatting, and professional export quality.

---

## Phase 1: Foundation ✅ (Complete)

### 1.1 Core Report Pipeline
- [x] Report Generator Agent (LLM writes professional reports from SQL data)
- [x] Fast path (pre-computed data) and SQL path (dynamic queries)
- [x] Multi-format export: PDF, XLSX, DOCX, PPTX
- [x] S3 storage with presigned download URLs
- [x] Temp cache fallback when S3 is unavailable
- [x] Report caching (KV cache with TTL)
- [x] Report persistence (saved to database with versioning)

### 1.2 PDF Template
- [x] Branded title page (company logo, name, tagline, report title)
- [x] Table of Contents page
- [x] Section headings with brand color accent lines
- [x] Elegant table rendering (alternating stripes, word wrap, column auto-sizing)
- [x] Vertical column separators and outer frame borders
- [x] Multi-page table support with header re-draw
- [x] Per-page border segment tracking (correct multi-page rendering)
- [x] Page footers (company name, page numbers)

### 1.3 LLM Prompt Engineering
- [x] Structured report format (Executive Summary → Key Metrics → Analysis → Rankings → Conclusion → References)
- [x] No-placeholder enforcement (company name, dates injected directly)
- [x] PII masking on output
- [x] Custom instructions from admin console
- [x] Read-only SQL guardrails

---

## Phase 2: Visual Intelligence & Configuration ✅ (Complete)

### 2.1 Chart Generation Pipeline
- [x] Vega-Lite + Vega + Sharp (SVG → PNG at 2x resolution)
- [x] Support: bar, line, area, pie, donut, scatter, grouped_bar, stacked_bar, heatmap
- [x] Brand-aware color palette (primary color → complementary series)
- [x] LLM generates ```chart JSON blocks inline with report content
- [x] `extractChartBlocks()` parses and validates chart specs from markdown
- [x] Charts embedded in PDF with titles, accent underlines, bordered frames, figure captions
- [x] Charts embedded in XLSX (as PNG images), DOCX (ImageRun), PPTX (native charts + PNG fallback)
- [x] `toPptxChartData()` for native PowerPoint chart rendering

### 2.2 PDF Formatting Polish
- [x] Table titles (bold, brand color) above tables
- [x] Numbered "Table N:" captions (italic, centered) below tables
- [x] Chart titles with accent underline above charts
- [x] Numbered "Figure N:" captions (italic, centered) below charts
- [x] References section with special formatting (heading, accent line, numbered items, hanging indent)
- [x] Trailing empty page removal
- [x] Smart table space estimation (prevents orphaned titles)
- [x] LLM metadata stripping (removes duplicate title, "Prepared for:", "Date:", "---" from content pages)

### 2.3 Admin Console — Report Settings
- [x] "Reports" tab under Operations section in Admin Console
- [x] Toggle: Title Page on/off
- [x] Toggle: Table of Contents on/off
- [x] Toggle: References Section on/off
- [x] Toggle: Confidential Footer on/off
- [x] Toggle: Charts Enabled on/off
- [x] Number: Executive Summary word target (default: 200)
- [x] Number: Max page count (default: 20)
- [x] Number: Max word count (default: 5000)
- [x] Number: Max charts per report (default: 4)
- [x] Number: Max data points per chart (default: 15)
- [x] Settings persisted to DB, cached with 1-min TTL
- [x] Cache invalidation on save

### 2.4 Bug Fixes
- [x] Company name reads from DB `businessName` (not env var fallback)
- [x] Duplicate footer on title page removed (title page has its own "Confidential" footer)
- [x] Executive Summary continues on TOC page if room (>250px) instead of starting new page
- [x] Multi-table extraction (`extractTables` replaces `extractTable`)

---

## Phase 3: Advanced Formatting (Next)

### 3.1 Watermark & Security
- [ ] Configurable watermark text ("DRAFT", "CONFIDENTIAL", custom) — diagonal, semi-transparent
- [ ] Watermark on/off toggle in report settings
- [ ] Document password protection (PDF encryption)
- [ ] Digital signature embedding

### 3.2 Header & Footer Customization
- [ ] Configurable header content (logo position, company name, report title)
- [ ] Configurable footer template (company name, page numbers, date, custom text)
- [ ] Different first-page header/footer vs subsequent pages
- [ ] Section-specific headers (show current section name)

### 3.3 Typography & Styling
- [ ] Custom font support (embed TTF/OTF fonts)
- [ ] Font family selection in report settings (Serif, Sans-serif, Monospace)
- [ ] Custom brand color palette (primary, secondary, accent)
- [ ] Table style presets (minimal, bordered, striped, modern)
- [ ] Configurable page margins
- [ ] Line spacing control (single, 1.5, double)

### 3.4 Rich Content
- [ ] Callout boxes / highlighted insight panels ("Key Insight:", "Warning:", "Recommendation:")
- [ ] Key metric cards (large numbers with trend indicators ↑↓)
- [ ] Inline data sparklines (miniature charts in text)
- [ ] Footnotes with auto-numbering
- [ ] Cross-references between sections ("See Section 3.2")

---

## Phase 4: AI-Powered Visuals

### 4.1 AI Image Generation
- [ ] Integration with image generation API (DALL-E 3, Stable Diffusion, or Flux)
- [ ] Industry-relevant decorative images (e.g., product photos, business context imagery)
- [ ] Auto-generated section header illustrations
- [ ] Image placement settings (inline, sidebar, full-width)
- [ ] Image generation on/off toggle in report settings
- [ ] Image style presets (photorealistic, illustration, infographic)
- [ ] Cost control: max images per report setting

### 4.2 Advanced Charts
- [ ] Combination charts (bar + line overlay)
- [ ] Waterfall charts (period-over-period changes)
- [ ] Gauge charts (KPI vs target visualization)
- [ ] Funnel charts (sales pipeline, conversion rates)
- [ ] Treemap charts (hierarchical data — category > product revenue)
- [ ] Geographic/map charts (regional sales heatmap)
- [ ] Sparkline mini-charts embedded in table cells
- [ ] Interactive HTML chart export (for web/email reports)

### 4.3 Chart Intelligence
- [ ] Auto-chart selection (LLM picks optimal chart type for each dataset)
- [ ] Trend annotations (auto-add trend lines, highlight anomalies)
- [ ] Comparison periods (this month vs last month overlay)
- [ ] Statistical annotations (mean line, standard deviation band)
- [ ] Chart color legend improvements (inline labels instead of separate legend)

---

## Phase 5: Report Templates & Scheduling

### 5.1 Template Engine
- [ ] Pre-built report templates (Sales Summary, Inventory Health, Financial Overview, Customer Activity)
- [ ] Custom template builder (drag-and-drop sections)
- [ ] Template versioning (save iterations, rollback)
- [ ] Template sharing across deployments (export/import)
- [ ] Section library (reusable content blocks)
- [ ] Conditional sections (include/exclude based on data availability)

### 5.2 Scheduled Reports
- [ ] Recurring report generation (daily, weekly, monthly, quarterly, annual)
- [ ] Report calendar view in admin console
- [ ] Email delivery of generated reports (PDF attachment or download link)
- [ ] Distribution lists (send to multiple recipients)
- [ ] Report queue management (cancel, retry, priority)
- [ ] Notification on report completion (in-app + email)

### 5.3 Multi-Period Reports
- [ ] Comparison reports (this period vs last period, YoY)
- [ ] Rolling period reports (last 7 days, 30 days, 90 days, 12 months)
- [ ] Custom date range picker with presets
- [ ] Period-over-period trend analysis with % change
- [ ] Annual summary reports (fiscal year)

---

## Phase 6: Collaboration & Review

### 6.1 Report Workflow
- [ ] Draft/review/approved/published status workflow
- [ ] Report approval chain (manager must approve before distribution)
- [ ] Annotation/commenting on report sections
- [ ] Version history with diff view
- [ ] Report locking (prevent edits after approval)
- [ ] Audit trail (who generated, reviewed, approved, shared)

### 6.2 Report Sharing
- [ ] Shareable links with expiry and access control
- [ ] Role-based report access (which roles can view which report types)
- [ ] White-label PDF export (remove software branding)
- [ ] Custom cover page per report (upload custom background image)
- [ ] QR code on cover page linking to online version

### 6.3 Report Library
- [ ] Searchable report archive (by type, date, generator, status)
- [ ] Report tagging and categorization
- [ ] Favorites/bookmarks
- [ ] Bulk download (zip multiple reports)
- [ ] Storage quota management

---

## Phase 7: Smart Insights & Narrative Quality

### 7.1 Narrative Enhancement
- [ ] Executive tone calibration (formal, conversational, analytical)
- [ ] Audience-aware writing (C-suite summary vs operational detail)
- [ ] Multi-language report generation (translate to client's language)
- [ ] Industry-specific terminology injection (from config)
- [ ] Reading level adjustment (simple, standard, technical)

### 7.2 AI Analysis Depth
- [ ] Anomaly detection and auto-highlighting
- [ ] Root cause analysis for significant changes
- [ ] Predictive insights ("Based on trends, next month may see...")
- [ ] Competitive benchmarking (if external data available)
- [ ] Seasonality detection and commentary
- [ ] Actionable recommendations with priority scoring

### 7.3 Data Quality
- [ ] Data completeness scoring (% of period with records)
- [ ] Data confidence indicators (sample size, coverage notes)
- [ ] Missing data handling (explicit callouts vs imputation)
- [ ] Outlier detection and commentary

---

## Phase 8: Multi-Format Excellence

### 8.1 PDF Enhancements
- [ ] Clickable hyperlinks (TOC entries link to sections)
- [ ] PDF bookmarks (navigation panel)
- [ ] Accessibility (tagged PDF, alt text for images/charts)
- [ ] Print-optimized layout (CMYK color, bleed marks)
- [ ] PDF/A compliance (archival format)

### 8.2 DOCX Enhancements
- [ ] Table of Contents with page numbers (using DOCX field codes)
- [ ] Track Changes metadata
- [ ] Custom styles matching PDF design
- [ ] Chart native embedding (OOXML charts)
- [ ] Template DOCX with pre-designed styles

### 8.3 PPTX Enhancements
- [ ] Speaker notes auto-generated per slide
- [ ] Slide master templates (branded theme)
- [ ] Executive summary slide (single-slide overview)
- [ ] One chart per slide layout
- [ ] Animation presets (build slides progressively)

### 8.4 New Formats
- [ ] HTML report (interactive, responsive, sharable web page)
- [ ] Email-ready HTML (inline styles, email-client compatible)
- [ ] Dashboard embed (iframe-ready report view)
- [ ] CSV/JSON export of underlying data tables
- [ ] Markdown export (clean, no chart blocks)

---

## Phase 9: Enterprise Features

### 9.1 Compliance & Regulatory
- [ ] SOX compliance report templates
- [ ] GDPR data subject report generation
- [ ] Tax authority report formats (KRA, IRS, etc.)
- [ ] Custom regulatory template builder
- [ ] Automated compliance checklist in reports

### 9.2 Multi-Deployment Intelligence
- [ ] Cross-deployment analytics (aggregate across client deployments)
- [ ] Benchmark reports (compare client performance to anonymized averages)
- [ ] Industry benchmark data integration

### 9.3 Performance & Scale
- [ ] Background report generation (non-blocking)
- [ ] Report generation queue with priority levels
- [ ] Incremental report updates (append new data to existing report)
- [ ] Chart rendering cache (reuse identical charts across reports)
- [ ] CDN distribution for generated documents
- [ ] Report generation analytics (time, cost, tokens per report)

---

## AI Image Generation — Provider Options

When image generation is prioritized, evaluate these options:

| Provider | Model | Quality | Cost | Notes |
|----------|-------|---------|------|-------|
| OpenAI | DALL-E 3 | High | $0.04-0.08/img | Best prompt adherence, already in stack |
| Stability AI | SDXL/SD3 | High | $0.002-0.03/img | Self-hostable, lower cost |
| Black Forest Labs | FLUX.1 | Very High | API pricing varies | Newest, excellent quality |
| Replicate | Various | Varies | Pay-per-use | Multiple model options |

**Recommendation:** Start with OpenAI DALL-E 3 (already using OpenAI for LLM, simplest integration). Add a `reportImageProvider` setting in admin console to allow switching providers.

---

*This roadmap is implementation-ordered. Each phase builds on the previous. Priorities may shift based on user feedback and business requirements.*
