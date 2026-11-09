#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportPath = process.argv[2] || 'db-test-results.json';
const absoluteReportPath = path.resolve(process.cwd(), reportPath);

if (!fs.existsSync(absoluteReportPath)) {
  console.error(`::error::Vitest JSON report not found at ${absoluteReportPath}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(absoluteReportPath, 'utf8'));
} catch (err) {
  console.error(`::error::Failed to parse Vitest JSON report: ${err.message}`);
  process.exit(1);
}

if (!report.success) {
  console.error('::error::Vitest test run failed!');
  process.exit(1);
}

const passedCount = report.numPassedTests ?? 0;
const pendingCount = report.numPendingTests ?? 0;
const failedCount = report.numFailedTests ?? 0;

if (passedCount === 0) {
  console.error('::error::Zero database tests passed! Expected at least 1 passing test.');
  process.exit(1);
}

if (failedCount > 0) {
  console.error(`::error::Detected ${failedCount} failed database tests!`);
  process.exit(1);
}

if (pendingCount > 0) {
  console.error(`::error::Detected ${pendingCount} skipped/pending database tests! All tests in target files must execute.`);
  process.exit(1);
}

const expectedSuites = [
  'auction-rpc-concurrency.integration.test.ts',
  'auction-rpc-security.integration.test.ts',
];

const results = report.testResults || [];

for (const expected of expectedSuites) {
  const suite = results.find((r) => r.name.replace(/\\/g, '/').includes(expected));
  if (!suite) {
    console.error(`::error::Required database test suite "${expected}" was not found in test report!`);
    process.exit(1);
  }

  const assertions = suite.assertionResults || [];
  const passedInSuite = assertions.filter((a) => a.status === 'passed').length;
  const skippedInSuite = assertions.filter((a) => a.status === 'skipped').length;
  const failedInSuite = assertions.filter((a) => a.status === 'failed').length;

  if (failedInSuite > 0) {
    console.error(`::error::Suite "${expected}" had ${failedInSuite} failed assertions!`);
    process.exit(1);
  }

  if (skippedInSuite > 0) {
    console.error(`::error::Suite "${expected}" had ${skippedInSuite} skipped assertions! (Likely skipped by disposable database guard)`);
    process.exit(1);
  }

  if (passedInSuite === 0) {
    console.error(`::error::Suite "${expected}" had 0 passed assertions!`);
    process.exit(1);
  }

  console.log(`✓ Suite "${expected}": ${passedInSuite} passed, 0 skipped, 0 failed.`);
}

console.log(`✓ Database verification passed: Total ${passedCount} tests passed across ${results.length} suites with 0 skips.`);
