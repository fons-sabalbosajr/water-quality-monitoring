#!/usr/bin/env node
/**
 * Import a WQM workbook (front-end/docs/wqm{year}.xlsx) into MongoDB and,
 * optionally, regenerate the bundled offline fallback (front-end/src/data).
 *
 *   node scripts/importWqmYear.js 2026 --dry-run          # parse + report only
 *   node scripts/importWqmYear.js 2026 --write-bundle     # also refresh wqm2026.json
 *   node scripts/importWqmYear.js 2026 --force            # overwrite an existing year
 *
 * An existing year document is backed up to server/backups/ before it is
 * replaced. Without --force an existing year is left untouched, because admin
 * edits saved from the app live only in MongoDB and a re-import discards them.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const WqmDataset = require('../models/WqmDataset');
const { parseWorkbook } = require('../utils/wqmWorkbook');
const { validateSheets } = require('../utils/validateSheets');

const LIVE_WQM_YEAR = 2026;
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const year = Number(args.find((arg) => /^\d{4}$/.test(arg)));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const writeBundle = args.includes('--write-bundle');

const summarize = (sheets) => sheets.map((sheet) => {
  let readings = 0;
  sheet.stations.forEach((station) => Object.values(station.params).forEach((param) => {
    readings += param.monthly.filter((value) => value !== null).length;
  }));
  return { key: sheet.key, name: sheet.name, stations: sheet.stations.length, readings };
});

// Values like "4..74" are typing errors in the source workbook. They are kept
// verbatim (never guessed at) but reported so they can be corrected at source.
const findSuspectValues = (sheets) => {
  const suspects = [];
  sheets.forEach((sheet) => sheet.stations.forEach((station) => {
    Object.entries(station.params).forEach(([param, data]) => {
      if (/observ|obserb/i.test(param)) return;
      data.monthly.forEach((value, index) => {
        if (typeof value !== 'string') return;
        if (/^[<>]\s*\d+(\.\d+)?$/.test(value) || /^[*.]+$/.test(value)) return;
        suspects.push(`${sheet.key} / stn ${station.stnNo} / ${param} / ${sheet.periodLabels[index] || index + 1}: "${value}"`);
      });
    });
  }));
  return suspects;
};

const toBundle = (sheets) => Object.fromEntries(sheets.map(({ key, name, classInfo, periodLabels, stations }) => [
  key,
  { name, classInfo, periodLabels, stations },
]));

const main = async () => {
  if (!Number.isInteger(year)) {
    console.error('Usage: node scripts/importWqmYear.js <year> [--dry-run] [--force] [--write-bundle]');
    process.exit(1);
  }

  const sourceFile = path.join(REPO_ROOT, 'front-end', 'docs', `wqm${year}.xlsx`);
  if (!fs.existsSync(sourceFile)) throw new Error(`Workbook not found: ${sourceFile}`);

  const options = year === LIVE_WQM_YEAR ? { preserveSheetNames: true, keepEmptyParams: true } : {};
  const sheets = await parseWorkbook(sourceFile, year, options);
  const validationError = validateSheets(sheets);
  if (validationError) throw new Error(`Parsed workbook failed validation: ${validationError}`);

  console.table(summarize(sheets));
  const suspects = findSuspectValues(sheets);
  if (suspects.length) {
    console.warn(`\n${suspects.length} non-numeric value(s) in numeric parameters (kept as-is):`);
    suspects.forEach((line) => console.warn(`  - ${line}`));
  }

  if (writeBundle) {
    const bundlePath = path.join(REPO_ROOT, 'front-end', 'src', 'data', `wqm${year}.json`);
    fs.writeFileSync(bundlePath, JSON.stringify(toBundle(sheets)));
    console.log(`\nWrote bundled fallback: ${path.relative(REPO_ROOT, bundlePath)}`);
  }

  if (dryRun) {
    console.log('\nDry run: MongoDB not modified.');
    return;
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    const existing = await WqmDataset.findOne({ year }).lean();
    if (existing && !force) {
      console.log(`\nWQM ${year} already exists in MongoDB (importedAt ${existing.importedAt?.toISOString()}). `
        + 'Re-run with --force to replace it; a backup is written first.');
      return;
    }
    if (existing) {
      const backupDir = path.join(__dirname, '..', 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupDir, `wqm${year}-${stamp}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(existing));
      console.log(`\nBacked up existing WQM ${year} to ${path.relative(REPO_ROOT, backupFile)}`);
    }

    const saved = await WqmDataset.findOneAndUpdate(
      { year },
      { year, sheets, sourceFile: `front-end/docs/wqm${year}.xlsx`, importedAt: new Date() },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    ).select('importedAt sheets').lean();
    console.log(`\nWQM ${year} saved to MongoDB: ${saved.sheets.length} sheets, importedAt ${saved.importedAt.toISOString()}`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
