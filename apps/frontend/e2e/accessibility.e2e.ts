/**
 * Accessibility End-to-End tests using axe-core
 * Tests the Electron app for WCAG 2.1 AA compliance
 *
 * NOTE: These tests require the Electron app to be built first.
 * Run `npm run build` before running accessibility tests.
 *
 * To run: npm run test:a11y
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'path';
import {
  loadAllowlist,
  generateReports,
  filterNewViolations,
  hasHighSeverityViolations,
  formatViolationsForConsole,
  shouldFailBuild,
  findStaleAllowlistEntries,
  type Allowlist,
  type AxeResults
} from './a11y-helpers';

// Configure test suite with accessibility tag for filtering
test.describe.configure({ mode: 'serial' });

// Paths
const ALLOWLIST_PATH = path.join(__dirname, 'a11y-allowlist.json');
const REPORTS_DIR = path.join(__dirname, 'a11y-reports');

// WCAG 2.1 AA tags for axe-core
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Run an axe-core accessibility scan on the current page
 * @param page - Playwright page object
 * @returns axe-core results
 */
async function runAccessibilityScan(page: Page): Promise<AxeResults> {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();

  return results as AxeResults;
}

/**
 * Wait for the page to be in a stable, scannable state
 * @param page - Playwright page object
 */
async function waitForStableState(page: Page): Promise<void> {
  // Wait for DOM content to be loaded
  await page.waitForLoadState('domcontentloaded');

  // Wait for any loading indicators to disappear
  await page.waitForFunction(() => {
    const loadingElements = document.querySelectorAll(
      '[data-loading="true"], .loading, .spinner, [aria-busy="true"]'
    );
    return loadingElements.length === 0;
  }, { timeout: 10000 }).catch(() => {
    // Ignore timeout - page may not have loading indicators
  });

  // Small delay for any animations to settle
  await page.waitForTimeout(500);
}

test.describe('Accessibility Tests', () => {
  let app: ElectronApplication;
  let page: Page;
  let allowlist: Allowlist;
  let allViolations: AxeResults['violations'] = [];

  test.beforeAll(async () => {
    // Load allowlist
    allowlist = loadAllowlist(ALLOWLIST_PATH);

    // Warn about stale entries if any exist (will check after all scans)
  });

  test.afterAll(async () => {
    if (app) {
      await app.close();
    }

    // Check for stale allowlist entries
    if (allViolations.length > 0 || allowlist.knownViolations.length > 0) {
      const staleEntries = findStaleAllowlistEntries(allViolations, allowlist);
      if (staleEntries.length > 0) {
        console.warn('\n⚠️  Stale allowlist entries detected:');
        staleEntries.forEach((entry) => {
          console.warn(`   - ${entry.ruleId}: ${entry.selector} (added: ${entry.addedDate})`);
        });
        console.warn('   Consider removing these entries from a11y-allowlist.json\n');
      }
    }
  });

  test('should launch Electron app for accessibility testing', async () => {
    // Skip test if not in proper environment
    const appPath = path.join(__dirname, '..');

    app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA_PATH: '/tmp/auto-claude-ui-e2e'
      }
    });

    page = await app.firstWindow();
    await waitForStableState(page);

    // Verify app launched
    expect(page).toBeDefined();
    const title = await page.title();
    expect(title).toBeDefined();
  });

  test('should pass accessibility scan on main window (initial state)', async () => {
    test.skip(!app, 'App not launched');

    await waitForStableState(page);

    // Run accessibility scan
    const results = await runAccessibilityScan(page);
    allViolations.push(...results.violations);

    // Filter out allowlisted violations
    const newViolations = filterNewViolations(results.violations, allowlist);

    // Log results
    if (results.violations.length > 0) {
      console.log(`\n📊 Main Window Scan Results:`);
      console.log(`   Total violations: ${results.violations.length}`);
      console.log(`   New violations: ${newViolations.length}`);
      console.log(`   Allowlisted: ${results.violations.length - newViolations.length}`);
    }

    // Log new violations for debugging
    if (newViolations.length > 0) {
      console.log('\n🚨 New Violations Found:');
      console.log(formatViolationsForConsole(newViolations));
    }

    // Fail on high-severity new violations
    if (shouldFailBuild(newViolations)) {
      const criticalOrSerious = newViolations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      expect.soft(
        criticalOrSerious,
        `Found ${criticalOrSerious.length} critical/serious accessibility violations that must be fixed`
      ).toHaveLength(0);
    }
  });

  test('should pass accessibility scan after navigation (if navigation possible)', async () => {
    test.skip(!app, 'App not launched');

    // Try to navigate to a different state if possible
    // Look for common navigation elements
    const navSelectors = [
      '[data-testid="sidebar"] button',
      'nav a',
      'nav button',
      '[role="navigation"] a',
      '[role="navigation"] button',
      '.sidebar a',
      '.sidebar button'
    ];

    let navigated = false;

    for (const selector of navSelectors) {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible().catch(() => false);

      if (isVisible) {
        try {
          await element.click();
          await waitForStableState(page);
          navigated = true;
          break;
        } catch {
          // Continue to next selector
        }
      }
    }

    if (!navigated) {
      console.log('ℹ️  No navigation elements found, scanning current state');
    }

    // Run accessibility scan on new state
    const results = await runAccessibilityScan(page);
    allViolations.push(...results.violations);

    const newViolations = filterNewViolations(results.violations, allowlist);

    if (results.violations.length > 0) {
      console.log(`\n📊 Navigation State Scan Results:`);
      console.log(`   Total violations: ${results.violations.length}`);
      console.log(`   New violations: ${newViolations.length}`);
      console.log(`   Allowlisted: ${results.violations.length - newViolations.length}`);
    }

    if (newViolations.length > 0) {
      console.log('\n🚨 New Violations Found:');
      console.log(formatViolationsForConsole(newViolations));
    }

    if (shouldFailBuild(newViolations)) {
      const criticalOrSerious = newViolations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      expect.soft(
        criticalOrSerious,
        `Found ${criticalOrSerious.length} critical/serious accessibility violations`
      ).toHaveLength(0);
    }
  });

  test('should pass accessibility scan on modal/dialog (if available)', async () => {
    test.skip(!app, 'App not launched');

    // Try to open a modal/dialog if possible
    const modalTriggers = [
      'button:has-text("Add")',
      'button:has-text("New")',
      'button:has-text("Create")',
      'button:has-text("Settings")',
      '[data-testid="add-project"]',
      '[data-testid="settings-button"]',
      '[data-testid="create-button"]',
      'button[aria-haspopup="dialog"]'
    ];

    let modalOpened = false;

    for (const selector of modalTriggers) {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible().catch(() => false);

      if (isVisible) {
        try {
          await element.click();
          // Wait for modal to appear
          await page.waitForSelector(
            '[role="dialog"], [role="alertdialog"], .modal, [data-testid="modal"], [aria-modal="true"]',
            { timeout: 3000 }
          );
          await waitForStableState(page);
          modalOpened = true;
          break;
        } catch {
          // Continue to next selector
        }
      }
    }

    if (!modalOpened) {
      console.log('ℹ️  No modal/dialog triggers found, scanning current state');
    }

    // Run accessibility scan
    const results = await runAccessibilityScan(page);
    allViolations.push(...results.violations);

    const newViolations = filterNewViolations(results.violations, allowlist);

    if (results.violations.length > 0) {
      console.log(`\n📊 Modal/Dialog State Scan Results:`);
      console.log(`   Total violations: ${results.violations.length}`);
      console.log(`   New violations: ${newViolations.length}`);
      console.log(`   Allowlisted: ${results.violations.length - newViolations.length}`);
    }

    if (newViolations.length > 0) {
      console.log('\n🚨 New Violations Found:');
      console.log(formatViolationsForConsole(newViolations));
    }

    // Close modal if opened (press Escape)
    if (modalOpened) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    if (shouldFailBuild(newViolations)) {
      const criticalOrSerious = newViolations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      expect.soft(
        criticalOrSerious,
        `Found ${criticalOrSerious.length} critical/serious accessibility violations`
      ).toHaveLength(0);
    }
  });

  test('should generate accessibility reports', async () => {
    test.skip(!app, 'App not launched');

    // Create combined results for report
    const combinedResults: AxeResults = {
      violations: allViolations,
      passes: [],
      incomplete: [],
      inapplicable: [],
      timestamp: new Date().toISOString(),
      url: 'electron://auto-claude'
    };

    // Generate reports
    const report = generateReports(combinedResults, allowlist, REPORTS_DIR, 'accessibility');

    console.log(`\n📄 Reports generated in: ${REPORTS_DIR}`);
    console.log(`   - accessibility-latest.json`);
    console.log(`   - accessibility-latest.html`);

    // Verify report was generated with correct structure
    expect(report).toBeDefined();
    expect(report.totalViolations).toBe(allViolations.length);
    expect(typeof report.newViolations).toBe('number');
    expect(typeof report.criticalCount).toBe('number');
    expect(typeof report.seriousCount).toBe('number');
  });
});

// Infrastructure tests that don't require Electron launch
test.describe('Accessibility Test Infrastructure', () => {
  test('should load allowlist correctly', () => {
    const allowlist = loadAllowlist(ALLOWLIST_PATH);
    expect(allowlist).toBeDefined();
    expect(Array.isArray(allowlist.knownViolations)).toBe(true);
  });

  test('should identify high-severity violations', () => {
    const violations = [
      { id: 'test-1', impact: 'critical' as const, description: '', help: '', helpUrl: '', tags: [], nodes: [] },
      { id: 'test-2', impact: 'minor' as const, description: '', help: '', helpUrl: '', tags: [], nodes: [] }
    ];

    expect(hasHighSeverityViolations(violations)).toBe(true);
    expect(hasHighSeverityViolations([violations[1]])).toBe(false);
  });

  test('should filter violations against allowlist', () => {
    const allowlist: Allowlist = {
      knownViolations: [
        {
          ruleId: 'color-contrast',
          selector: '.legacy-button',
          reason: 'Known legacy issue',
          addedDate: '2026-01-09'
        }
      ]
    };

    const violations = [
      {
        id: 'color-contrast',
        impact: 'serious' as const,
        description: 'Color contrast issue',
        help: 'Fix contrast',
        helpUrl: 'https://example.com',
        tags: ['wcag2aa'],
        nodes: [{ target: ['.legacy-button'], html: '<button class="legacy-button">Test</button>' }]
      },
      {
        id: 'button-name',
        impact: 'critical' as const,
        description: 'Button has no name',
        help: 'Add name',
        helpUrl: 'https://example.com',
        tags: ['wcag2a'],
        nodes: [{ target: ['.new-button'], html: '<button class="new-button"></button>' }]
      }
    ];

    const newViolations = filterNewViolations(violations, allowlist);
    expect(newViolations).toHaveLength(1);
    expect(newViolations[0].id).toBe('button-name');
  });

  test('should determine build failure correctly', () => {
    const criticalViolation = [
      { id: 'test', impact: 'critical' as const, description: '', help: '', helpUrl: '', tags: [], nodes: [] }
    ];
    const seriousViolation = [
      { id: 'test', impact: 'serious' as const, description: '', help: '', helpUrl: '', tags: [], nodes: [] }
    ];
    const moderateViolation = [
      { id: 'test', impact: 'moderate' as const, description: '', help: '', helpUrl: '', tags: [], nodes: [] }
    ];
    const minorViolation = [
      { id: 'test', impact: 'minor' as const, description: '', help: '', helpUrl: '', tags: [], nodes: [] }
    ];

    expect(shouldFailBuild(criticalViolation)).toBe(true);
    expect(shouldFailBuild(seriousViolation)).toBe(true);
    expect(shouldFailBuild(moderateViolation)).toBe(false);
    expect(shouldFailBuild(minorViolation)).toBe(false);
    expect(shouldFailBuild([])).toBe(false);
  });
});
