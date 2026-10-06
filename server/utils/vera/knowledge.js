// VERA knowledge base for the EMB Region III Water Quality Monitoring System.
// Describes what the app does and how to use it. Live figures never come from
// here — they come from tools.js. Keep entries in step with the UI: a wrong page
// or button name here is a wrong answer from VERA.

const { PARAM_LIMITS, describeLimit } = require('./wqm');

const ASSISTANT_NAME = 'VERA';
const ASSISTANT_FULL_NAME = 'Virtual Environmental Response Assistant';
const SUPPORT_NOTE = 'an EMB Region III administrator';

const standardsText = Object.keys(PARAM_LIMITS).map((p) => `${p}: ${describeLimit(p)}`).join('; ');

const KNOWLEDGE_BASE = [
  {
    id: 'about', category: 'general',
    question: 'What is this system and what can VERA do?',
    answer: 'The EMB Region III Water Quality Monitoring System (WQMS) holds the ambient water quality monitoring results for Region III waterbodies — rivers, bays, coasts and bathing beaches — for 2024, 2025 and the live 2026 year. VERA can look up readings, rank and summarise stations, list guideline exceedances, compare years, and forecast a parameter for the coming months. Administrators and developers can also ask VERA to change data (edit a reading, set a sampling date, add, rename or delete a station); VERA shows the change for confirmation and applies it only after you click Confirm.',
    keywords: ['wqms', 'system', 'vera', 'what can', 'about', 'help', 'features'],
  },
  {
    id: 'standards', category: 'standards',
    question: 'What water quality guidelines does the app use?',
    answer: `The dashboards, tables and VERA all judge readings against the same guideline values: ${standardsText}. A reading outside its value is shown as failing / exceeding. The source workbooks also carry a per-class WQG column (Class C rivers vs Class SB coastal waters can differ, e.g. DO 5 vs 6 mg/L); the app currently applies the single set above.`,
    keywords: ['standard', 'guideline', 'wqg', 'limit', 'threshold', 'exceed', 'pass', 'fail', 'class', 'dao'],
  },
  {
    id: 'parameters', category: 'standards',
    question: 'What parameters are monitored?',
    answer: 'Dissolved oxygen (DO), BOD, total suspended solids (TSS), pH, temperature, color, fecal coliform, nitrate (NO3-N), phosphate (PO4-P), chloride (Cl-) and, for some rivers, oil & grease, plus field observations. Coastal (Class SB) stations do not measure BOD or chloride. Values such as "<0.1" are below the laboratory detection limit and are counted at the limit value; "*" or "**" mean no sample was taken.',
    keywords: ['parameter', 'do', 'bod', 'tss', 'ph', 'temperature', 'fecal', 'coliform', 'nitrate', 'phosphate', 'chloride', 'detection', 'observation'],
  },
  {
    id: 'years', category: 'data',
    question: 'Which years are available and where does the data come from?',
    answer: 'Three years are stored in MongoDB: 2024 and 2025 (archives) and 2026 (the live year being encoded). They were imported from the EMB WQM workbooks; some waterbodies are sampled monthly and others quarterly (Q1–Q4). Every edit made in the Tabular Results editor or through VERA is saved to MongoDB, so the public dashboard and every signed-in device see it.',
    keywords: ['year', '2024', '2025', '2026', 'source', 'workbook', 'excel', 'mongodb', 'import', 'quarterly', 'monthly'],
  },
  {
    id: 'published-year', category: 'settings',
    question: 'How do I choose which year the dashboards show?',
    answer: 'Go to Developer Manager → Backup, Data & Email → Published WQM Dataset and pick 2024, 2025 or 2026. The Dashboard, Visual Analytics, Waterbody Profiles and the public dashboard all switch to that year.',
    keywords: ['publish', 'published', 'visualization year', 'which year', 'dashboard year', 'switch year'],
  },
  {
    id: 'tabular', category: 'data entry',
    question: 'How do I add or edit readings?',
    answer: 'Open Tabular Results → the year (e.g. 2026). Pick a waterbody in the left list, then use Edit on a station row (or Add Station). Type each monthly value, set the Date of Sampling row, and Save — the change is stored in MongoDB immediately. "Reload from Server" discards changes that only exist in your browser. Administrators can also just ask VERA, e.g. "set DO at Meycauayan station 2 for September to 1.7".',
    keywords: ['add', 'edit', 'encode', 'reading', 'tabular', 'station', 'save', 'update', 'data entry', 'sampling date', 'reload'],
  },
  {
    id: 'forecast', category: 'forecast',
    question: 'How does forecasting work?',
    answer: 'Forecasts project the next months of a parameter at one station from its own readings. The default engine is a Prophet-style additive model (linear trend + seasonal harmonic, with an uncertainty range that widens further out); "Fast trend (OLS)" is a straight-line alternative. The number of months is the Forecast Horizon set in Settings → AI Forecast (1–3 months) and applies to the public dashboard, Visual Analytics and VERA. Forecasts are screening aids: treat the range, not the single value, as the expectation, and they need at least 2 readings.',
    keywords: ['forecast', 'predict', 'projection', 'horizon', 'prophet', 'ols', 'trend', 'next month', 'future'],
  },
  {
    id: 'dashboard', category: 'navigation',
    question: 'What does the Dashboard show?',
    answer: 'The Dashboard summarises the published year: waterbody and station counts, parameter gauges against the guidelines, latest readings, exceedance highlights and the station map. Waterbody Profiles (left menu) give one waterbody\'s stations, trends and observations.',
    keywords: ['dashboard', 'overview', 'gauge', 'summary', 'home', 'waterbody profile', 'profile'],
  },
  {
    id: 'visual-analytics', category: 'navigation',
    question: 'What charts are in Visual Analytics?',
    answer: 'Visual Analytics has: Heatmap Matrix (normalised parameter × station), Fecal Risk & Trophic State (fecal coliform map and nutrient indicators), Seasonal Decomposition, Radar chart, Scatter (relationship between two parameters) and Forecast / Predictive charts. The 3D Waterbody Map shows stations in 3D.',
    keywords: ['visual', 'analytics', 'chart', 'heatmap', 'trophic', 'seasonal', 'radar', 'scatter', 'map', '3d'],
  },
  {
    id: 'line-charts', category: 'settings',
    question: 'How do I show several years on the line charts?',
    answer: 'Settings → Line Chart Data: select 2024 and/or 2025, check the preview, and save. Every line chart then joins those years with 2026 for the same station.',
    keywords: ['line chart', 'multi year', 'merge', 'historical', 'trend', 'previous year'],
  },
  {
    id: 'waterbody-settings', category: 'settings',
    question: 'How do I rename a waterbody or set station coordinates?',
    answer: 'Settings → Waterbody Profiles & Station Locations. Choose the year, select a waterbody, then edit the profile name/class or a station\'s address and coordinates. Use "Push edits to server" to save them to MongoDB, or "Re-fetch from server" to discard local edits.',
    keywords: ['rename', 'waterbody name', 'coordinate', 'latitude', 'longitude', 'location', 'station location', 'push', 'profile'],
  },
  {
    id: 'accounts', category: 'accounts',
    question: 'How are user accounts approved and what can each role do?',
    answer: 'New registrations stay pending until an administrator approves them in Developer Manager → Account Management. Roles: user (view dashboards and data), admin (also edit data, manage accounts and settings), developer (everything, including runtime diagnostics and VERA settings). Which sections each role (or an individual user) can open is set under Account Management → Global Access Settings and Role Access Settings.',
    keywords: ['account', 'user', 'approve', 'approval', 'pending', 'role', 'admin', 'developer', 'access', 'permission', 'register'],
  },
  {
    id: 'public', category: 'navigation',
    question: 'What does the public see?',
    answer: 'The public dashboard (no sign-in) shows the published year\'s waterbodies, readings, guideline status and forecasts using the admin Forecast Horizon. It is read-only.',
    keywords: ['public', 'visitor', 'anonymous', 'public dashboard', 'citizen'],
  },
  {
    id: 'logs-backup', category: 'settings',
    question: 'Where are activity logs and backups?',
    answer: 'Developer Manager → App Logs records data edits, exports, account changes and navigation. Developer Manager → Backup, Data & Email exports or restores local data and tests the Gmail SMTP email integration. Changes made through VERA are logged as "VERA applied change".',
    keywords: ['log', 'audit', 'activity', 'backup', 'export', 'restore', 'email', 'smtp', 'history'],
  },
  {
    id: 'export', category: 'data entry',
    question: 'How do I export data?',
    answer: 'In Tabular Results, open a waterbody and click Export CSV — it exports every station and parameter for that waterbody with the annual average.',
    keywords: ['export', 'csv', 'download', 'excel'],
  },
];

// Developer-only knowledge (architecture, not secrets).
const DEVELOPER_KNOWLEDGE_BASE = [
  {
    id: 'dev-architecture', category: 'developer',
    question: 'How is the app built?',
    answer: 'Express 5 + Mongoose API (server/) and a React 19 + Vite + antd SPA (front-end/). WQM years live in the wqmdatasets collection (one document per year: sheets → stations → params → monthly[12] + avg). Browsers keep an encrypted local copy stamped with importedAt and revalidate it via GET /api/water/public/wqm/:year/meta. App-wide settings (published year, forecast horizon, VERA) are AppSetting documents. Workbooks are imported with `node scripts/importWqmYear.js <year>` in server/.',
    keywords: ['architecture', 'stack', 'express', 'mongoose', 'react', 'api', 'collection', 'schema', 'import script', 'how built'],
  },
  {
    id: 'dev-vera', category: 'developer',
    question: 'How does VERA work internally?',
    answer: 'VERA (server/utils/vera) answers from tools that compute figures from MongoDB; the model (Gemini, configured in Developer Manager → VERA Assistant) only selects tools and phrases results. Without a model VERA uses a rule-based intent router over the same tools. Write tools only return proposals; POST /api/vera/actions/confirm applies them after re-checking the current value.',
    keywords: ['vera internal', 'tool', 'gemini', 'model', 'function calling', 'fallback', 'how vera'],
  },
];

const SCOPE_TERMS = [
  'water', 'quality', 'river', 'bay', 'coast', 'beach', 'station', 'waterbody', 'reading', 'sample', 'sampling',
  'parameter', 'do', 'bod', 'tss', 'ph', 'temp', 'color', 'fecal', 'coliform', 'nitrate', 'phosphate', 'chloride',
  'oil', 'grease', 'forecast', 'predict', 'trend', 'exceed', 'fail', 'pass', 'standard', 'guideline', 'wqg', 'class',
  'dashboard', 'chart', 'map', 'tabular', 'export', 'year', '2024', '2025', '2026', 'month', 'quarter', 'average',
  'highest', 'lowest', 'worst', 'best', 'pollut', 'monitor', 'emb', 'denr', 'account', 'user', 'setting', 'log',
  'add', 'edit', 'update', 'delete', 'change', 'set', 'vera', 'help',
];

const PAGE_LABELS = {
  dashboard: 'Dashboard',
  visualization: 'Visual Analytics',
  waterbody: 'Waterbody Profile',
  'developer-manager': 'Developer Manager',
  settings: 'Settings',
  'public-dashboard': 'Public Dashboard',
};

const GREETING = {
  admin: "Hi! I'm VERA. Ask me about readings, exceedances, trends and forecasts — or tell me what to change (a reading, a sampling date, a station) and I'll prepare it for your confirmation.",
  user: "Hi! I'm VERA. Ask me about readings, exceedances, trends and forecasts for any monitored waterbody, or how to use this system.",
};

const STARTERS = {
  admin: [
    'Which stations failed the DO guideline in the latest month?',
    'Forecast BOD at Meycauayan River station 1',
    'Summarise fecal coliform across all waterbodies',
    'How do I add a new station?',
  ],
  user: [
    'Which waterbodies have the most exceedances?',
    'What is the latest DO at Marilao River?',
    'Forecast pH at Subic Bay station 1',
    'What guideline values does the app use?',
  ],
};

const OUT_OF_SCOPE_REPLY = 'I can only help with the EMB Region III Water Quality Monitoring System — monitoring data, guideline exceedances, forecasts, and how to use the app.';
const CANNOT_VERIFY_REPLY = `I couldn't find that in the monitoring data or the help library. Try naming the waterbody, station and parameter (e.g. "DO at Meycauayan River station 2"), or contact ${SUPPORT_NOTE}.`;

module.exports = {
  ASSISTANT_NAME,
  ASSISTANT_FULL_NAME,
  KNOWLEDGE_BASE,
  DEVELOPER_KNOWLEDGE_BASE,
  SCOPE_TERMS,
  PAGE_LABELS,
  GREETING,
  STARTERS,
  OUT_OF_SCOPE_REPLY,
  CANNOT_VERIFY_REPLY,
};
