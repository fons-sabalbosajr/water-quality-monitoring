// Pure decision helpers for keeping a browser's copy of a MongoDB year in sync
// (see revalidateYear in wqmSheets.js). Kept free of React, axios and storage
// so they are reachable from `npm test`.

/** Canonical form of a server importedAt stamp, or null when missing/invalid. */
export const toVersion = (importedAt) => {
  const time = importedAt ? new Date(importedAt).getTime() : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/**
 * Whether the full year must be downloaded. A local copy is kept only when it
 * exists and is stamped with exactly the server's current version — a copy
 * with no stamp (e.g. a pre-sync 2026 draft) is treated as out of date.
 */
export const needsDownload = ({ hasLocal, serverVersion, localVersion }) => {
  if (!hasLocal) return true;
  const server = toVersion(serverVersion);
  if (!server) return true;
  return server !== toVersion(localVersion);
};

const toTitle = (str) => String(str || '')
  .replace(/_/g, ' ')
  .toLowerCase()
  .replace(/\b\w/g, (c) => c.toUpperCase())
  .trim();

/**
 * Server names are raw workbook titles ("MEYCAUAYAN RIVER"); the live year has
 * always been shown title-cased. Only all-caps names are changed, so a name an
 * admin typed in mixed case is left alone.
 */
export const titleCaseSheetNames = (sheets) => sheets.map((sheet) => {
  const name = String(sheet?.name || '');
  return name && name === name.toUpperCase() ? { ...sheet, name: toTitle(name) } : sheet;
});
