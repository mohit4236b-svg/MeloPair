/**
 * Universal Self-Bootstrapping E2E Test Runner for EchoPlayerDesktop
 * 
 * Auto-detects runtime environment:
 * - When run with standard Node.js (`node tests/e2e/runner.js` or `npm test`),
 *   transparently spawns the bundled `electron.exe` with headless audio/GPU switches.
 * - When run inside Electron, executes Node 24 native test runner (`node:test`)
 *   across all 4 test tiers (69 total test cases) and emits a structured report.
 */

const path = require('path');

// 1. Self-bootstrapping runtime check
if (!process.versions.electron) {
  const electronPath = require('electron');
  const { spawn } = require('child_process');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env
  });

  child.on('exit', (code) => {
    process.exit(code !== null ? code : 1);
  });
  return;
}

// 2. Headless Electron runtime setup
const { app } = require('electron');
const { describe, afterEach, after } = require('node:test');
const { harness } = require('./harness/electron-harness');

app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gpu');

// Prevent premature Electron quit between test suite windows
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// 3. Parse CLI arguments
const args = process.argv.slice(2);
let tierFilter = null;
let testFilter = null;
let verbose = false;

for (const arg of args) {
  if (arg.startsWith('--tier=')) {
    tierFilter = arg.split('=')[1].trim();
  } else if (arg.startsWith('--test=')) {
    testFilter = arg.split('=')[1].trim();
  } else if (arg === '--verbose' || arg === '-v') {
    verbose = true;
  }
}

const shouldRunTier = (tierNum) => {
  if (!tierFilter) return true;
  const tiers = tierFilter.split(',').map(s => s.trim());
  return tiers.includes(String(tierNum));
};

console.log('\n======================================================================');
console.log('EchoPlayerDesktop E2E Test Suite Initializing');
console.log(`Runtime: Electron ${process.versions.electron} / Node ${process.versions.node}`);
console.log(`Active Filters: Tier = ${tierFilter || 'ALL (1-4)'}${testFilter ? `, Test = ${testFilter}` : ''}`);
console.log('======================================================================\n');

// 4. Track test statistics
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  tiers: {
    1: { name: 'Tier 1 (Feature Coverage)', passed: 0, failed: 0, expected: 27 },
    2: { name: 'Tier 2 (Boundary & Corner Cases)', passed: 0, failed: 0, expected: 25 },
    3: { name: 'Tier 3 (Cross-Feature Pairwise)', passed: 0, failed: 0, expected: 12 },
    4: { name: 'Tier 4 (Application Scenarios)', passed: 0, failed: 0, expected: 6 }
  },
  failures: []
};

// 5. Execute Top-Level Test Suite
describe('EchoPlayerDesktop E2E Master Suite', () => {
  afterEach((t) => {
    const testName = t.name || '';
    // Only capture actual test cases (with TC- prefix or it blocks)
    if (!testName.startsWith('TC-')) {
      return;
    }

    stats.total++;
    const hasError = Boolean(t.error);

    let detectedTier = 1;
    if (testName.includes('TC-T2-')) detectedTier = 2;
    else if (testName.includes('TC-T3-')) detectedTier = 3;
    else if (testName.includes('TC-T4-')) detectedTier = 4;

    if (hasError) {
      stats.failed++;
      stats.tiers[detectedTier].failed++;
      stats.failures.push({
        tier: detectedTier,
        name: testName,
        error: t.error ? (t.error.message || String(t.error)) : 'Assertion error'
      });
    } else {
      stats.passed++;
      stats.tiers[detectedTier].passed++;
    }
  });

  if (shouldRunTier(1)) {
    require('./suites/tier1-feature-coverage.test');
  }
  if (shouldRunTier(2)) {
    require('./suites/tier2-boundary-corner.test');
  }
  if (shouldRunTier(3)) {
    require('./suites/tier3-cross-feature.test');
  }
  if (shouldRunTier(4)) {
    require('./suites/tier4-application-scenarios.test');
  }

  after(async () => {
    await harness.closeAllWindows();

    console.log('\n======================================================================');
    console.log('EchoPlayerDesktop E2E Test Suite Execution Summary');
    console.log('======================================================================');
    for (let t = 1; t <= 4; t++) {
      if (shouldRunTier(t)) {
        const d = stats.tiers[t];
        const actual = d.passed + d.failed;
        const icon = d.failed === 0 ? 'PASS' : 'FAIL';
        console.log(`[${icon.padEnd(4)}] ${d.name.padEnd(35)}: ${String(d.passed).padStart(2)} / ${String(actual).padStart(2)} passed (${d.failed} failed, expected ${d.expected})`);
      }
    }
    console.log('----------------------------------------------------------------------');
    console.log(`TOTAL TESTS EXECUTED: ${stats.total}`);
    console.log(`TOTAL PASSED:         ${stats.passed}`);
    console.log(`TOTAL FAILED:         ${stats.failed}`);
    console.log(`SUCCESS RATE:         ${stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : 0}%`);
    console.log('======================================================================');

    if (stats.failures.length > 0) {
      console.log('\nFailed Test Cases Breakdown:');
      stats.failures.forEach((f, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. [Tier ${f.tier}] ${f.name}`);
        console.log(`      Error: ${f.error}`);
      });
      console.log('======================================================================\n');
    }

    const exitCode = stats.failed > 0 ? 1 : 0;
    setTimeout(() => {
      app.exit(exitCode);
    }, 150);
  });
});
