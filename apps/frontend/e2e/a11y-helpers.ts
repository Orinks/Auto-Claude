/**
 * Helper utilities for accessibility E2E tests
 * Provides utilities for allowlist management, violation filtering, and report generation
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

/**
 * Represents a single node/element affected by a violation
 */
export interface ViolationNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

/**
 * Represents an axe-core violation result
 */
export interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: ViolationNode[];
}

/**
 * Represents the full axe-core results structure
 */
export interface AxeResults {
  violations: AxeViolation[];
  passes: unknown[];
  incomplete: unknown[];
  inapplicable: unknown[];
  timestamp: string;
  url: string;
}

/**
 * Represents a single entry in the allowlist
 */
export interface AllowlistEntry {
  ruleId: string;
  selector: string;
  reason: string;
  addedDate: string;
  ticketRef?: string;
}

/**
 * Represents the allowlist file structure
 */
export interface Allowlist {
  $schema?: string;
  description?: string;
  knownViolations: AllowlistEntry[];
}

/**
 * Represents a violation with its allowlist status
 */
export interface ClassifiedViolation extends AxeViolation {
  isAllowlisted: boolean;
  matchedAllowlistEntry?: AllowlistEntry;
}

/**
 * Report summary for a scan result
 */
export interface ScanReport {
  timestamp: string;
  url: string;
  totalViolations: number;
  newViolations: number;
  allowlistedViolations: number;
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
  violations: ClassifiedViolation[];
  staleAllowlistEntries: AllowlistEntry[];
}

/**
 * High severity impacts that should fail the build
 */
const HIGH_SEVERITY_IMPACTS: ReadonlyArray<string> = ['critical', 'serious'];

/**
 * Load and parse the allowlist JSON file
 * @param allowlistPath - Path to the allowlist JSON file
 * @returns Parsed allowlist object
 */
export function loadAllowlist(allowlistPath: string): Allowlist {
  try {
    const content = readFileSync(allowlistPath, 'utf-8');
    const parsed = JSON.parse(content) as Allowlist;

    // Validate basic structure
    if (!Array.isArray(parsed.knownViolations)) {
      return { knownViolations: [] };
    }

    return parsed;
  } catch (error) {
    // Return empty allowlist if file doesn't exist or is invalid
    return { knownViolations: [] };
  }
}

/**
 * Check if a violation node matches an allowlist entry
 * Matches by both ruleId AND selector for precision
 * @param ruleId - The axe-core rule ID
 * @param target - The CSS selector(s) for the element
 * @param entry - The allowlist entry to compare against
 * @returns True if the violation matches the allowlist entry
 */
export function matchesAllowlistEntry(
  ruleId: string,
  target: string[],
  entry: AllowlistEntry
): boolean {
  // Rule ID must match exactly
  if (ruleId !== entry.ruleId) {
    return false;
  }

  // Check if any of the target selectors match the allowlist selector
  // Support both exact match and contains match for flexibility
  const targetString = target.join(' ');
  return (
    targetString === entry.selector ||
    targetString.includes(entry.selector) ||
    target.some((t) => t === entry.selector || t.includes(entry.selector))
  );
}

/**
 * Check if a specific violation is in the allowlist
 * @param violation - The axe-core violation
 * @param allowlist - The loaded allowlist
 * @returns Object with isAllowlisted flag and matched entry if found
 */
export function isViolationAllowlisted(
  violation: AxeViolation,
  allowlist: Allowlist
): { isAllowlisted: boolean; matchedEntry?: AllowlistEntry } {
  for (const entry of allowlist.knownViolations) {
    // Check if any node in the violation matches this allowlist entry
    const hasMatchingNode = violation.nodes.some((node) =>
      matchesAllowlistEntry(violation.id, node.target, entry)
    );

    if (hasMatchingNode) {
      return { isAllowlisted: true, matchedEntry: entry };
    }
  }

  return { isAllowlisted: false };
}

/**
 * Classify all violations as new or allowlisted
 * @param violations - Array of axe-core violations
 * @param allowlist - The loaded allowlist
 * @returns Array of classified violations with allowlist status
 */
export function classifyViolations(
  violations: AxeViolation[],
  allowlist: Allowlist
): ClassifiedViolation[] {
  return violations.map((violation) => {
    const { isAllowlisted, matchedEntry } = isViolationAllowlisted(violation, allowlist);
    return {
      ...violation,
      isAllowlisted,
      matchedAllowlistEntry: matchedEntry
    };
  });
}

/**
 * Filter violations to get only new (non-allowlisted) ones
 * @param violations - Array of axe-core violations
 * @param allowlist - The loaded allowlist
 * @returns Array of violations not in the allowlist
 */
export function filterNewViolations(
  violations: AxeViolation[],
  allowlist: Allowlist
): AxeViolation[] {
  return violations.filter((violation) => {
    const { isAllowlisted } = isViolationAllowlisted(violation, allowlist);
    return !isAllowlisted;
  });
}

/**
 * Check if there are any high-severity (critical/serious) violations
 * @param violations - Array of violations to check
 * @returns True if any violations have critical or serious impact
 */
export function hasHighSeverityViolations(violations: AxeViolation[]): boolean {
  return violations.some((v) => HIGH_SEVERITY_IMPACTS.includes(v.impact));
}

/**
 * Get violations filtered by severity level
 * @param violations - Array of violations to filter
 * @param impact - The impact level to filter by
 * @returns Array of violations matching the specified impact
 */
export function getViolationsByImpact(
  violations: AxeViolation[],
  impact: 'critical' | 'serious' | 'moderate' | 'minor'
): AxeViolation[] {
  return violations.filter((v) => v.impact === impact);
}

/**
 * Count violations by severity level
 * @param violations - Array of violations to count
 * @returns Object with counts for each severity level
 */
export function countViolationsBySeverity(violations: AxeViolation[]): {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
} {
  return {
    critical: violations.filter((v) => v.impact === 'critical').length,
    serious: violations.filter((v) => v.impact === 'serious').length,
    moderate: violations.filter((v) => v.impact === 'moderate').length,
    minor: violations.filter((v) => v.impact === 'minor').length
  };
}

/**
 * Find stale allowlist entries that no longer match any violations
 * @param violations - Current violations from scan
 * @param allowlist - The loaded allowlist
 * @returns Array of allowlist entries that didn't match any violation
 */
export function findStaleAllowlistEntries(
  violations: AxeViolation[],
  allowlist: Allowlist
): AllowlistEntry[] {
  return allowlist.knownViolations.filter((entry) => {
    // Check if this entry matches any current violation
    const matchesAnyViolation = violations.some(
      (violation) =>
        violation.id === entry.ruleId &&
        violation.nodes.some((node) => matchesAllowlistEntry(violation.id, node.target, entry))
    );
    return !matchesAnyViolation;
  });
}

/**
 * Generate a comprehensive scan report
 * @param results - The axe-core results
 * @param allowlist - The loaded allowlist
 * @returns Structured report with violation classifications
 */
export function generateScanReport(results: AxeResults, allowlist: Allowlist): ScanReport {
  const classifiedViolations = classifyViolations(results.violations, allowlist);
  const newViolations = classifiedViolations.filter((v) => !v.isAllowlisted);
  const allowlistedViolations = classifiedViolations.filter((v) => v.isAllowlisted);
  const staleEntries = findStaleAllowlistEntries(results.violations, allowlist);
  const counts = countViolationsBySeverity(newViolations);

  return {
    timestamp: results.timestamp || new Date().toISOString(),
    url: results.url || 'unknown',
    totalViolations: results.violations.length,
    newViolations: newViolations.length,
    allowlistedViolations: allowlistedViolations.length,
    criticalCount: counts.critical,
    seriousCount: counts.serious,
    moderateCount: counts.moderate,
    minorCount: counts.minor,
    violations: classifiedViolations,
    staleAllowlistEntries: staleEntries
  };
}

/**
 * Save report as JSON file
 * @param report - The scan report
 * @param outputPath - Path to save the JSON file
 */
export function saveJsonReport(report: ScanReport, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

/**
 * Generate HTML report content
 * @param report - The scan report
 * @returns HTML string
 */
export function generateHtmlReport(report: ScanReport): string {
  const newViolations = report.violations.filter((v) => !v.isAllowlisted);
  const allowlistedViolations = report.violations.filter((v) => v.isAllowlisted);

  const severityBadge = (impact: string): string => {
    const colors: Record<string, string> = {
      critical: '#d32f2f',
      serious: '#f57c00',
      moderate: '#fbc02d',
      minor: '#1976d2'
    };
    return `<span style="background:${colors[impact] || '#666'};color:white;padding:2px 8px;border-radius:4px;font-size:12px;">${impact}</span>`;
  };

  const violationCard = (v: ClassifiedViolation): string => `
    <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin:8px 0;${v.isAllowlisted ? 'background:#f5f5f5;' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>${v.id}</strong>
        ${severityBadge(v.impact)}
        ${v.isAllowlisted ? '<span style="background:#4caf50;color:white;padding:2px 8px;border-radius:4px;font-size:12px;">Allowlisted</span>' : ''}
      </div>
      <p style="margin:8px 0;color:#666;">${v.description}</p>
      <p style="margin:8px 0;"><strong>Help:</strong> ${v.help}</p>
      <p style="margin:8px 0;"><a href="${v.helpUrl}" target="_blank">Learn more</a></p>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;color:#1976d2;">Affected elements (${v.nodes.length})</summary>
        <ul style="margin-top:8px;">
          ${v.nodes.map((n) => `<li><code>${n.target.join(' ')}</code></li>`).join('')}
        </ul>
      </details>
      ${v.matchedAllowlistEntry ? `<p style="margin-top:8px;font-size:12px;color:#666;"><em>Allowlist reason: ${v.matchedAllowlistEntry.reason}</em></p>` : ''}
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessibility Report - ${report.timestamp}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 20px 0; }
    .stat { background: #f5f5f5; padding: 16px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 32px; font-weight: bold; }
    .stat-label { color: #666; font-size: 14px; }
    .critical { color: #d32f2f; }
    .serious { color: #f57c00; }
    .moderate { color: #fbc02d; }
    .minor { color: #1976d2; }
    .success { color: #4caf50; }
    section { margin: 32px 0; }
    .warning { background: #fff3e0; border-left: 4px solid #f57c00; padding: 12px; margin: 16px 0; }
  </style>
</head>
<body>
  <h1>♿ Accessibility Report</h1>
  <p>Generated: ${report.timestamp}</p>
  <p>URL: ${report.url}</p>

  <div class="summary">
    <div class="stat">
      <div class="stat-value">${report.totalViolations}</div>
      <div class="stat-label">Total Violations</div>
    </div>
    <div class="stat">
      <div class="stat-value ${report.newViolations > 0 ? 'critical' : 'success'}">${report.newViolations}</div>
      <div class="stat-label">New Violations</div>
    </div>
    <div class="stat">
      <div class="stat-value success">${report.allowlistedViolations}</div>
      <div class="stat-label">Allowlisted</div>
    </div>
    <div class="stat">
      <div class="stat-value critical">${report.criticalCount}</div>
      <div class="stat-label">Critical</div>
    </div>
    <div class="stat">
      <div class="stat-value serious">${report.seriousCount}</div>
      <div class="stat-label">Serious</div>
    </div>
    <div class="stat">
      <div class="stat-value moderate">${report.moderateCount}</div>
      <div class="stat-label">Moderate</div>
    </div>
    <div class="stat">
      <div class="stat-value minor">${report.minorCount}</div>
      <div class="stat-label">Minor</div>
    </div>
  </div>

  ${report.staleAllowlistEntries.length > 0 ? `
  <div class="warning">
    <strong>⚠️ Stale Allowlist Entries</strong>
    <p>The following allowlist entries no longer match any violations and can be removed:</p>
    <ul>
      ${report.staleAllowlistEntries.map((e) => `<li><code>${e.ruleId}</code> - ${e.selector}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  ${newViolations.length > 0 ? `
  <section>
    <h2>🚨 New Violations (${newViolations.length})</h2>
    <p>These violations are not in the allowlist and need to be fixed or added to the allowlist with justification.</p>
    ${newViolations.map(violationCard).join('')}
  </section>
  ` : '<section><h2>✅ No New Violations</h2><p>All detected violations are in the allowlist.</p></section>'}

  ${allowlistedViolations.length > 0 ? `
  <section>
    <h2>📋 Allowlisted Violations (${allowlistedViolations.length})</h2>
    <p>These violations are known and documented in the allowlist.</p>
    ${allowlistedViolations.map(violationCard).join('')}
  </section>
  ` : ''}

</body>
</html>`;
}

/**
 * Save report as HTML file
 * @param report - The scan report
 * @param outputPath - Path to save the HTML file
 */
export function saveHtmlReport(report: ScanReport, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const html = generateHtmlReport(report);
  writeFileSync(outputPath, html);
}

/**
 * Generate and save both JSON and HTML reports
 * @param results - The axe-core results
 * @param allowlist - The loaded allowlist
 * @param outputDir - Directory to save reports
 * @param filePrefix - Prefix for report filenames (default: 'a11y-report')
 * @returns The generated report
 */
export function generateReports(
  results: AxeResults,
  allowlist: Allowlist,
  outputDir: string,
  filePrefix = 'a11y-report'
): ScanReport {
  const report = generateScanReport(results, allowlist);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  saveJsonReport(report, path.join(outputDir, `${filePrefix}-${timestamp}.json`));
  saveHtmlReport(report, path.join(outputDir, `${filePrefix}-${timestamp}.html`));

  // Also save a "latest" version for easy CI artifact access
  saveJsonReport(report, path.join(outputDir, `${filePrefix}-latest.json`));
  saveHtmlReport(report, path.join(outputDir, `${filePrefix}-latest.html`));

  return report;
}

/**
 * Format violations for console output
 * @param violations - Array of violations to format
 * @returns Formatted string for console logging
 */
export function formatViolationsForConsole(violations: AxeViolation[]): string {
  if (violations.length === 0) {
    return 'No violations found.';
  }

  return violations
    .map((v) => {
      const elements = v.nodes.map((n) => `    - ${n.target.join(' ')}`).join('\n');
      return `[${v.impact.toUpperCase()}] ${v.id}\n  ${v.description}\n  Help: ${v.help}\n  Affected elements:\n${elements}`;
    })
    .join('\n\n');
}

/**
 * Determine if the test should fail based on violations
 * @param newViolations - Array of new (non-allowlisted) violations
 * @returns True if build should fail
 */
export function shouldFailBuild(newViolations: AxeViolation[]): boolean {
  return hasHighSeverityViolations(newViolations);
}
