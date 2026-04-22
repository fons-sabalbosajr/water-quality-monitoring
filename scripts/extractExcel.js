const XLSX = require('D:/EMBR3 WATER QUALITY MONITORING/water-quality-monitoring/front-end/node_modules/xlsx');
const fs = require('fs');
const path = require('path');

const SKIP = ['PLANNING (BUDGET HEARING)', 'SUMMARY'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const wb = XLSX.readFile('D:/EMBR3 WATER QUALITY MONITORING/water-quality-monitoring/front-end/docs/wqm2026.xlsx');
const result = {};

for (const sn of wb.SheetNames) {
  if (SKIP.includes(sn)) continue;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' });
  const wbName = String(rows[3][0] || sn).replace(/_/g, ' ');
  const classInfo = String(rows[4][0] || '');
  const header = rows[5] || [];
  if (header[0] !== 'Region') continue;

  const mIdx = MONTHS.map(m => header.indexOf(m));
  const avgIdx = header.indexOf('Average/Geomean');
  const stationMap = {};
  let curParam = '';

  for (let i = 6; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c === '')) continue;
    if (r[1] !== '') curParam = String(r[1]).trim();
    const sNo = r[2];
    const sId = String(r[3]).trim();
    const addr = String(r[4]).trim();
    if (sNo === '' || sNo === undefined || !sId || !curParam) continue;
    const key = String(sNo);
    if (!stationMap[key]) {
      stationMap[key] = { stnNo: sNo, stnId: sId, address: addr, params: {} };
    }
    const monthly = mIdx.map(idx =>
      (idx >= 0 && r[idx] !== '' && r[idx] !== '-')
        ? (typeof r[idx] === 'number' ? +r[idx].toFixed(4) : r[idx])
        : null
    );
    const avg =
      avgIdx >= 0 && r[avgIdx] !== '' && r[avgIdx] !== '-'
        ? typeof r[avgIdx] === 'number' ? +r[avgIdx].toFixed(4) : r[avgIdx]
        : null;
    stationMap[key].params[curParam] = { monthly, avg };
  }

  result[sn] = { name: wbName, classInfo, stations: Object.values(stationMap) };
}

const outDir = 'D:/EMBR3 WATER QUALITY MONITORING/water-quality-monitoring/front-end/src/data';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'wqm2026.json'), JSON.stringify(result));
console.log('Done. Sheets:', Object.keys(result).length);
Object.entries(result).slice(0, 3).forEach(([k, v]) => {
  const params = v.stations[0] ? Object.keys(v.stations[0].params) : [];
  console.log(k, ':', v.stations.length, 'stations, params:', params.join(' | '));
});
