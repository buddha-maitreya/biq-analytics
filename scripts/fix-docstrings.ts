/**
 * Fix agent docstrings — one-time script.
 * Removes identity confusion and self-referential "Vs. other agents" blocks.
 */

const INSIGHTS_FILE = "src/agent/insights-analyzer/index.ts";

async function fixInsightsAnalyzer() {
  let content = await Bun.file(INSIGHTS_FILE).text();

  // Find the docstring boundaries
  const startMarker = "/**\n * Insights Analyzer Agent";
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) {
    console.log("ERROR: Could not find start of insights-analyzer docstring");
    return false;
  }

  // Find the closing */ after the docstring
  const searchFrom = startIdx + startMarker.length;
  const endMarker = "\n */";
  // We need the FIRST closing */ that ends this docstring block
  // Look for "not a template runner" or "any business context" to find the right one
  let endIdx = content.indexOf("any business context.", searchFrom);
  if (endIdx === -1) {
    console.log("ERROR: Could not find end anchor in insights-analyzer docstring");
    return false;
  }
  // Now find the closing */ after that
  endIdx = content.indexOf("\n */", endIdx);
  if (endIdx === -1) {
    console.log("ERROR: Could not find closing */ in insights-analyzer docstring");
    return false;
  }
  const fullEnd = endIdx + "\n */".length;

  const newDoc = `/**
 * Insights Analyzer Agent — "The Analyst"
 *
 * Unique specialty: COMPUTATIONAL INTELLIGENCE.
 *
 * This agent is the platform's statistical analyst. It uses the Agentuity
 * sandbox to execute dynamically-generated JavaScript code for
 * statistical analysis that goes BEYOND what SQL can express:
 * z-scores, moving averages, trend projections, anomaly scoring,
 * demand forecasting, pareto analysis, cohort comparisons, etc.
 *
 * How it differs from the other agents:
 *   - The Brain (data-science) orchestrates conversation and routes to specialists
 *   - The Writer (report-generator) narrates data into polished reports (no sandbox)
 *   - The Librarian (knowledge-base) retrieves answers from uploaded documents
 *   - THIS agent (The Analyst) runs code in a sandboxed runtime for real computation
 *
 * All runtime parameters (model, maxSteps, temperature, timeout, etc.)
 * are read from the agent_configs DB table so they can be tuned per-deployment
 * via the Admin Console without code changes.
 *
 * Architecture (fully dynamic, LLM-generated code):
 *   1. The LLM receives the analysis request and database schema
 *   2. The LLM WRITES its own SQL query to fetch relevant data
 *   3. The LLM WRITES JavaScript code to perform statistical analysis
 *   4. The sandbox executes the LLM-generated code in isolated bun:1
 *   5. The LLM interprets the computed results into business insights
 *
 * The code is generated ON THE FLY — not from templates. This means the
 * agent can adapt its analysis approach to any data shape, any question,
 * and any business context.
 */`;

  content = content.slice(0, startIdx) + newDoc + content.slice(fullEnd);
  await Bun.write(INSIGHTS_FILE, content);
  console.log("Fixed: insights-analyzer docstring");
  return true;
}

const ok = await fixInsightsAnalyzer();
if (!ok) process.exit(1);
console.log("Done!");
