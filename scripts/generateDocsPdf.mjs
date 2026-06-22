// Generates docs/WQMS_Documentation.pdf — a detailed, illustrated reference for
// the EMBR3 Water Quality Monitoring System.
//
// Usage (from repo root):  node scripts/generateDocsPdf.mjs
// Requires: pdfkit (installed in front-end/node_modules).

import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "front-end", "src", "assets");
const OUT = path.join(ROOT, "docs", "WQMS_Documentation.pdf");

// ── Palette & layout ───────────────────────────────────────────────────────
const PRIMARY = "#2F4A8C";
const PRIMARY_LT = "#446ACB";
const ACCENT = "#7CB675";
const WARN = "#E07B54";
const FORECAST = "#F59E0B";
const INK = "#1F2937";
const MUTED = "#6B7280";
const LINE = "#D7DEEA";
const BG_SOFT = "#F3F6FC";

const BODY = 11; // 11px body text, as requested
const H1 = 17;
const H2 = 13;
const SMALL = 9.5;

const MARGIN = 52;

const doc = new PDFDocument({
  size: "A4",
  margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  bufferPages: true,
  info: {
    Title: "EMBR3 Water Quality Monitoring System — Documentation",
    Author: "Environmental Management Bureau Region III",
    Subject: "Application reference: features, functions, and modules",
  },
});

const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

const PAGE_W = doc.page.width;
const PAGE_H = doc.page.height;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN - 18;

// ── Page tracking for the table of contents ────────────────────────────────
let pageNumber = 1;
doc.on("pageAdded", () => {
  pageNumber += 1;
});
const toc = [];

const ensureSpace = (needed) => {
  if (doc.y + needed > CONTENT_BOTTOM) doc.addPage();
};

const resetText = () => {
  doc.font("Helvetica").fontSize(BODY).fillColor(INK);
};

// ── Reusable content blocks ────────────────────────────────────────────────
const sectionHeading = (title) => {
  if (doc.y + 40 > CONTENT_BOTTOM) doc.addPage();
  toc.push({ title, page: pageNumber });
  doc.moveDown(0.4);
  const y = doc.y;
  doc
    .save()
    .rect(MARGIN, y - 2, 4, 18)
    .fill(PRIMARY_LT)
    .restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(H1)
    .fillColor(PRIMARY)
    .text(title, MARGIN + 12, y - 4);
  doc
    .save()
    .moveTo(MARGIN, doc.y + 4)
    .lineTo(MARGIN + CONTENT_W, doc.y + 4)
    .lineWidth(0.8)
    .strokeColor(LINE)
    .stroke()
    .restore();
  doc.moveDown(0.9);
  resetText();
};

const subHeading = (title) => {
  ensureSpace(34);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(H2).fillColor(PRIMARY_LT).text(title);
  doc.moveDown(0.35);
  resetText();
};

const paragraph = (text) => {
  ensureSpace(28);
  doc
    .font("Helvetica")
    .fontSize(BODY)
    .fillColor(INK)
    .text(text, { align: "justify", lineGap: 3.5, width: CONTENT_W });
  doc.moveDown(0.6);
};

const bullets = (items) => {
  items.forEach((item) => {
    ensureSpace(22);
    const startY = doc.y;
    doc
      .save()
      .circle(MARGIN + 4, startY + 6.5, 1.9)
      .fill(ACCENT)
      .restore();
    const [lead, rest] = Array.isArray(item) ? item : [null, item];
    if (lead) {
      doc
        .font("Helvetica-Bold")
        .fontSize(BODY)
        .fillColor(INK)
        .text(`${lead}: `, MARGIN + 14, startY, { continued: true, lineGap: 3 });
      doc.font("Helvetica").fillColor(INK).text(rest, { lineGap: 3, width: CONTENT_W - 14 });
    } else {
      doc
        .font("Helvetica")
        .fontSize(BODY)
        .fillColor(INK)
        .text(rest, MARGIN + 14, startY, { lineGap: 3, width: CONTENT_W - 14 });
    }
    doc.moveDown(0.35);
  });
  doc.moveDown(0.3);
};

// Simple two/three column table with header row.
const table = (headers, rows, widths) => {
  const colW = widths.map((w) => w * CONTENT_W);
  const rowPad = 6;
  const drawRow = (cells, isHeader) => {
    const font = isHeader ? "Helvetica-Bold" : "Helvetica";
    const size = isHeader ? SMALL + 0.5 : SMALL + 1;
    // measure height
    let maxH = 0;
    cells.forEach((cell, i) => {
      const h = doc.font(font).fontSize(size).heightOfString(String(cell), {
        width: colW[i] - rowPad * 2,
      });
      maxH = Math.max(maxH, h);
    });
    const rowH = maxH + rowPad * 2;
    if (doc.y + rowH > CONTENT_BOTTOM) doc.addPage();
    const y = doc.y;
    let x = MARGIN;
    if (isHeader) {
      doc.save().rect(MARGIN, y, CONTENT_W, rowH).fill(PRIMARY).restore();
    } else {
      doc.save().rect(MARGIN, y, CONTENT_W, rowH).fill(BG_SOFT).restore();
    }
    cells.forEach((cell, i) => {
      doc
        .font(font)
        .fontSize(size)
        .fillColor(isHeader ? "#FFFFFF" : INK)
        .text(String(cell), x + rowPad, y + rowPad, {
          width: colW[i] - rowPad * 2,
          lineGap: 2,
        });
      x += colW[i];
    });
    // borders
    doc.save().lineWidth(0.5).strokeColor(LINE);
    doc.rect(MARGIN, y, CONTENT_W, rowH).stroke();
    let bx = MARGIN;
    colW.slice(0, -1).forEach((w) => {
      bx += w;
      doc.moveTo(bx, y).lineTo(bx, y + rowH).stroke();
    });
    doc.restore();
    doc.y = y + rowH;
  };
  drawRow(headers, true);
  rows.forEach((r) => drawRow(r, false));
  doc.moveDown(0.8);
  resetText();
};

const calloutNote = (label, text) => {
  ensureSpace(50);
  const y = doc.y;
  const h =
    doc.font("Helvetica").fontSize(SMALL + 1).heightOfString(text, {
      width: CONTENT_W - 70,
    }) + 18;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, h, 6).fill(BG_SOFT).restore();
  doc.save().roundedRect(MARGIN, y, 6, h, 3).fill(FORECAST).restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(SMALL)
    .fillColor(WARN)
    .text(label.toUpperCase(), MARGIN + 16, y + 9);
  doc
    .font("Helvetica")
    .fontSize(SMALL + 1)
    .fillColor(INK)
    .text(text, MARGIN + 16, doc.y + 1, { width: CONTENT_W - 70, lineGap: 2.5 });
  doc.y = y + h;
  doc.moveDown(0.8);
  resetText();
};

// ── Vector illustration: a sample forecast line chart ──────────────────────
const drawForecastChart = (caption) => {
  const w = CONTENT_W;
  const h = 220;
  if (doc.y + h + 40 > CONTENT_BOTTOM) doc.addPage();
  const x0 = MARGIN;
  const y0 = doc.y;
  // frame
  doc.save().roundedRect(x0, y0, w, h, 8).fill("#FFFFFF").restore();
  doc.save().roundedRect(x0, y0, w, h, 8).lineWidth(0.8).strokeColor(LINE).stroke().restore();

  const padL = 42;
  const padR = 16;
  const padT = 22;
  const padB = 34;
  const plotX = x0 + padL;
  const plotY = y0 + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const observed = [6.2, 6.0, 5.7, 5.9, 6.4, 6.1, 5.8, 5.5];
  const forecast = [5.4, 5.3, 5.2];
  const upper = forecast.map((v, i) => v + 0.4 + i * 0.18);
  const lower = forecast.map((v, i) => Math.max(0, v - 0.4 - i * 0.18));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
  const all = [...observed, ...upper];
  const vMax = Math.max(...all) + 0.4;
  const vMin = Math.max(0, Math.min(...observed, ...lower) - 0.4);
  const n = observed.length + forecast.length;
  const sx = (i) => plotX + (plotW * i) / (n - 1);
  const sy = (v) => plotY + plotH - (plotH * (v - vMin)) / (vMax - vMin);

  // y gridlines + labels
  doc.save();
  for (let g = 0; g <= 4; g += 1) {
    const v = vMin + ((vMax - vMin) * g) / 4;
    const gy = sy(v);
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(0.4).strokeColor("#EAEFF7").stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(v.toFixed(1), x0 + 8, gy - 4, { width: padL - 14, align: "right" });
  }
  doc.restore();

  // x labels
  doc.save();
  for (let i = 0; i < n; i += 1) {
    doc.font("Helvetica").fontSize(7).fillColor(i < observed.length ? MUTED : FORECAST).text(months[i], sx(i) - 10, plotY + plotH + 8, { width: 20, align: "center" });
  }
  doc.restore();

  // observed line
  doc.save().lineWidth(2).strokeColor(PRIMARY_LT);
  observed.forEach((v, i) => {
    const X = sx(i);
    const Y = sy(v);
    if (i === 0) doc.moveTo(X, Y);
    else doc.lineTo(X, Y);
  });
  doc.stroke();
  doc.restore();
  observed.forEach((v, i) => {
    doc.save().circle(sx(i), sy(v), 2.4).fill(PRIMARY_LT).restore();
  });

  // forecast line (dashed) bridged from last observed
  doc.save().lineWidth(2).strokeColor(FORECAST).dash(5, { space: 4 });
  const bridgeX = sx(observed.length - 1);
  const bridgeY = sy(observed.at(-1));
  doc.moveTo(bridgeX, bridgeY);
  forecast.forEach((v, i) => {
    doc.lineTo(sx(observed.length + i), sy(v));
  });
  doc.stroke();
  doc.undash();
  doc.restore();
  forecast.forEach((v, i) => {
    const X = sx(observed.length + i);
    const Y = sy(v);
    doc.save().circle(X, Y, 4).fillOpacity(0.25).fill(FORECAST).restore();
    doc.save().circle(X, Y, 2.4).fill(FORECAST).restore();
  });

  // legend
  const lgY = y0 + 8;
  doc.save();
  doc.rect(plotX, lgY, 14, 3).fill(PRIMARY_LT);
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Observed", plotX + 18, lgY - 2);
  doc.rect(plotX + 70, lgY, 14, 3).fill(FORECAST);
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("Forecast (next months)", plotX + 90, lgY - 2);
  doc.restore();

  doc.y = y0 + h + 6;
  doc.font("Helvetica-Oblique").fontSize(SMALL).fillColor(MUTED).text(caption, MARGIN, doc.y, { width: CONTENT_W, align: "center" });
  doc.moveDown(0.8);
  resetText();
};

// ── Vector illustration: a row of UI icons ─────────────────────────────────
const drawIconRow = () => {
  const items = ["dashboard", "water", "table", "forecast", "map", "settings"];
  const labels = ["Dashboard", "Waterbody", "Tabular", "Forecast", "3D Map", "Settings"];
  const box = (CONTENT_W - 10 * 5) / 6;
  const h = box + 22;
  if (doc.y + h + 10 > CONTENT_BOTTOM) doc.addPage();
  const y0 = doc.y;
  items.forEach((type, i) => {
    const x = MARGIN + i * (box + 10);
    doc.save().roundedRect(x, y0, box, box, 10).fill(BG_SOFT).restore();
    doc.save().roundedRect(x, y0, box, box, 10).lineWidth(0.8).strokeColor(LINE).stroke().restore();
    const cx = x + box / 2;
    const cy = y0 + box / 2;
    const s = box * 0.3;
    doc.save().lineWidth(2).strokeColor(PRIMARY_LT).fillColor(PRIMARY_LT);
    if (type === "dashboard") {
      doc.rect(cx - s, cy - s, s * 0.85, s * 0.85).stroke();
      doc.rect(cx + s * 0.1, cy - s, s * 0.85, s * 1.4).stroke();
      doc.rect(cx - s, cy - s * 0.1 + s * 0.85, s * 0.85, s * 0.95).stroke();
    } else if (type === "water") {
      doc.moveTo(cx, cy - s).bezierCurveTo(cx + s, cy, cx + s * 0.7, cy + s, cx, cy + s).bezierCurveTo(cx - s * 0.7, cy + s, cx - s, cy, cx, cy - s).stroke();
    } else if (type === "table") {
      doc.rect(cx - s, cy - s, s * 2, s * 2).stroke();
      doc.moveTo(cx - s, cy - s * 0.33).lineTo(cx + s, cy - s * 0.33).stroke();
      doc.moveTo(cx - s, cy + s * 0.33).lineTo(cx + s, cy + s * 0.33).stroke();
      doc.moveTo(cx, cy - s).lineTo(cx, cy + s).stroke();
    } else if (type === "forecast") {
      doc.moveTo(cx - s, cy + s * 0.6).lineTo(cx - s * 0.2, cy - s * 0.2).lineTo(cx + s * 0.3, cy + s * 0.2).lineTo(cx + s, cy - s * 0.7).stroke();
      doc.save().fillColor(FORECAST).circle(cx + s, cy - s * 0.7, 2.6).fill().restore();
    } else if (type === "map") {
      doc.moveTo(cx, cy - s).bezierCurveTo(cx + s, cy - s, cx + s, cy + s * 0.2, cx, cy + s).bezierCurveTo(cx - s, cy + s * 0.2, cx - s, cy - s, cx, cy - s).stroke();
      doc.save().fillColor(WARN).circle(cx, cy - s * 0.15, 2.4).fill().restore();
    } else if (type === "settings") {
      doc.circle(cx, cy, s * 0.55).stroke();
      for (let k = 0; k < 8; k += 1) {
        const a = (Math.PI / 4) * k;
        doc.moveTo(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55)
          .lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s)
          .stroke();
      }
    }
    doc.restore();
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(labels[i], x, y0 + box + 5, { width: box, align: "center" });
  });
  doc.y = y0 + h + 4;
  doc.moveDown(0.4);
  resetText();
};

const imageCaption = (file, caption, maxH = 220) => {
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) return;
  if (doc.y + maxH + 30 > CONTENT_BOTTOM) doc.addPage();
  const y0 = doc.y;
  doc.save().roundedRect(MARGIN, y0, CONTENT_W, maxH + 16, 8).fill(BG_SOFT).restore();
  doc.image(p, MARGIN + 8, y0 + 8, { fit: [CONTENT_W - 16, maxH], align: "center", valign: "center" });
  doc.y = y0 + maxH + 16;
  doc.moveDown(0.3);
  doc.font("Helvetica-Oblique").fontSize(SMALL).fillColor(MUTED).text(caption, { width: CONTENT_W, align: "center" });
  doc.moveDown(0.8);
  resetText();
};

// ════════════════════════════════════════════════════════════════════════
// COVER PAGE
// ════════════════════════════════════════════════════════════════════════
doc.save().rect(0, 0, PAGE_W, PAGE_H).fill("#FFFFFF").restore();
doc.save().rect(0, 0, PAGE_W, 250).fill(PRIMARY).restore();
doc.save().rect(0, 250, PAGE_W, 8).fill(ACCENT).restore();

const logoP = path.join(ASSETS, "bagongpilipinaslogo.png");
if (fs.existsSync(logoP)) {
  doc.image(logoP, PAGE_W / 2 - 38, 56, { fit: [76, 76], align: "center" });
}
doc
  .font("Helvetica-Bold")
  .fontSize(26)
  .fillColor("#FFFFFF")
  .text("Water Quality Monitoring System", MARGIN, 152, { width: CONTENT_W, align: "center" });
doc
  .font("Helvetica")
  .fontSize(12.5)
  .fillColor("#D7E1F6")
  .text("Environmental Management Bureau — Region III (EMBR3-WQMS)", MARGIN, 188, {
    width: CONTENT_W,
    align: "center",
  });

doc
  .font("Helvetica")
  .fontSize(BODY)
  .fillColor(INK)
  .text(
    "A full-stack platform for managing, visualizing, and analyzing water quality monitoring data across Region III waterbodies — featuring editable datasets, interactive analytics, in-browser forecasting, and a Cesium-powered 3D waterbody map.",
    MARGIN + 20,
    320,
    { width: CONTENT_W - 40, align: "center", lineGap: 4 },
  );

drawForecastChart("Figure 1 — Sample in-app forecast chart: observed monthly readings with a projected next-months trend and uncertainty.");

const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
doc
  .font("Helvetica")
  .fontSize(SMALL + 1)
  .fillColor(MUTED)
  .text(`Application Reference Document  ·  Generated ${today}`, MARGIN, PAGE_H - 92, {
    width: CONTENT_W,
    align: "center",
  });
doc
  .font("Helvetica-Bold")
  .fontSize(SMALL + 1)
  .fillColor(PRIMARY)
  .text("Internal operational use — Environmental Management Bureau Region III", MARGIN, PAGE_H - 74, {
    width: CONTENT_W,
    align: "center",
  });

// ════════════════════════════════════════════════════════════════════════
// TABLE OF CONTENTS (placeholder page — filled after content)
// ════════════════════════════════════════════════════════════════════════
doc.addPage();
const tocPageIndex = pageNumber - 1; // 0-based buffered index

// ════════════════════════════════════════════════════════════════════════
// CONTENT
// ════════════════════════════════════════════════════════════════════════
doc.addPage();

sectionHeading("1. Introduction & Overview");
paragraph(
  "The EMBR3 Water Quality Monitoring System (EMBR3-WQMS) is a web application built for the Environmental Management Bureau Region III to manage and interpret water quality data gathered from rivers, bays, and other waterbodies across the region. It brings field readings, compliance checks, visual analytics, and short-term forecasting into a single, role-secured workspace.",
);
paragraph(
  "The system is designed for everyday operational use: staff can encode monthly station readings, publish a working year, explore trends through interactive charts, and present results on an interactive 3D map. Plain-language narratives accompany the analytics so that both technical reviewers and non-technical readers can understand what the data is saying.",
);
subHeading("Who uses it");
bullets([
  ["Encoders / Users", "view dashboards, tabular results, profiles, and visual analytics for the published year."],
  ["Developers", "access system diagnostics, logs, and configuration in addition to user features."],
  ["Administrators", "manage accounts and access, publish datasets, and control app-wide settings such as line-chart data merging and the forecast horizon."],
]);

sectionHeading("2. Key Features at a Glance");
table(
  ["Module", "What it does"],
  [
    ["Dashboard", "Summary cards, parameter gauges, monthly trend chart, parameter correlation grid, observation panel, and a station location map for the active waterbody."],
    ["Visual Analytics", "Heatmap matrix, fecal risk & trophic state, seasonal decomposition, radar profile, scatter relationships, and forecast charts — each with a plain-language narrative."],
    ["Waterbody Profiles", "Per-waterbody monthly trend, station gauge metrics, and an annual compliance summary against water quality guidelines."],
    ["Tabular Results", "Editable station data table per monitoring year with add/edit station, per-month values, sampling dates, and class information."],
    ["3D Waterbody Map", "Cesium-powered globe with station pins, waterbody labels, and hybrid imagery."],
    ["Settings", "Account access control, waterbody & station configuration, line-chart data merge, and AI forecast horizon."],
  ],
  [0.26, 0.74],
);

sectionHeading("3. Application Modules & Functions");
subHeading("3.1 Dashboard");
paragraph(
  "The dashboard opens on the first waterbody in the list and presents a consolidated picture of the selected waterbody: headline statistics, gauge readings against guideline limits, and a monthly trend chart. A parameter correlation grid shows how pairs of measures move together, accompanied by a detailed, plain-language interpretation. An observation panel surfaces field notes by month.",
);
bullets([
  ["Monthly trend", "one line per station, or a single merged waterbody line when the admin enables data merging."],
  ["Parameter correlation", "a colour-coded grid from -1 to +1 with an interpretation that highlights the strongest positive and inverse relationships."],
  ["Station map", "an embedded map of monitoring stations for quick geographic context."],
]);

subHeading("3.2 Visual Analytics");
paragraph(
  "The visualizations menu offers several complementary views. Every card carries a short, non-technical narrative explaining what the reader is looking at and why it matters. The radar chart additionally provides a result-and-observation analysis specific to the selected waterbody.",
);
bullets([
  ["Heatmap matrix", "a colour-coded grid of stations against parameters; warmer cells flag higher normalized readings."],
  ["Fecal risk & trophic state", "contamination timeline and nutrient indicators for screening pollution pressure."],
  ["Seasonal decomposition", "wet- vs dry-season grouping to separate natural seasonal swings from real changes."],
  ["Radar / spider chart", "a normalized 0–100 station profile for quick side-by-side comparison."],
  ["Scatter analysis", "pairwise parameter plots with a regression line to reveal possible relationships."],
  ["Forecast charts", "short-horizon projections computed in-browser for each parameter."],
]);

subHeading("3.3 Forecast Charts");
paragraph(
  "Forecast charts project each parameter a few months ahead using the station's monthly history. Two engines are available: a fast ordinary-least-squares trend and a Prophet-style additive model (linear trend plus seasonality with a widening uncertainty band). Projected values are kept physically sensible for each parameter (no negative concentrations or counts; pH bounded), rounded to two decimals, and labelled with the real succeeding month names. Each parameter card is clickable to open a full-detail view with an enlarged chart and a table of observed and forecasted readings, and the forecast line uses an animated dot to draw attention to projected points.",
);
drawForecastChart("Figure 2 — Forecast detail: solid line is observed history; dashed line and pulsing dots are the projected next months.");

subHeading("3.4 Waterbody Profiles");
paragraph(
  "Each waterbody profile combines a monthly trend chart, station parameter gauge metrics, and an annual summary that grades every parameter against its water quality guideline (within limit, near limit, or exceeds). Parameters that report only an annual average are still shown so no station with data appears empty.",
);

subHeading("3.5 Tabular Results & Station Editing");
paragraph(
  "Administrators and developers can encode data per monitoring year. The station editor exposes all twelve months for each parameter so previously blank months can be filled in. Censored readings written with a less-than sign (for example, \"<5\") are counted in the annual average using their numeric value. A Class field at the top of the editor records the waterbody station's classification, and a Date of Sampling row captures the sampling date for each month.",
);

subHeading("3.6 3D Waterbody Map");
paragraph(
  "A CesiumJS globe renders monitoring stations as pins with waterbody labels over hybrid imagery, giving reviewers an intuitive geographic view of the monitoring network.",
);

sectionHeading("4. Interface Icons");
paragraph("The navigation uses a consistent icon set across the main modules:");
drawIconRow();

sectionHeading("5. Settings & Administration");
paragraph(
  "The Settings menu groups the administrative configuration. Account management controls roles and per-feature access. The Waterbody Profiles & Station Locations panel manages profile labels and station assignment. Two data-shaping controls are particularly important for charts:",
);
bullets([
  ["Line Chart Data", "lets an administrator merge station readings into a single consolidated waterbody line on every line chart. A live before/after preview is shown before saving, and once applied it takes effect across the Dashboard and Waterbody Profile trends."],
  ["AI Forecast", "configures the forecast horizon (number of months projected) used by the forecast charts."],
]);
calloutNote(
  "Note",
  "Forecasts are indicative projections for review support only — not official predictions. Reviewer judgment and current field conditions always take priority.",
);

sectionHeading("6. User Roles & Access");
table(
  ["Role", "Typical access"],
  [
    ["User", "Dashboard, Visual Analytics, Waterbody Profiles, Tabular Results (read)."],
    ["Developer", "All user features plus runtime diagnostics, application logs, and configuration sections."],
    ["Administrator", "Full access: account & access management, dataset publishing, and app-wide settings."],
  ],
  [0.22, 0.78],
);
paragraph(
  "Access is enforced both in the navigation and at the rendered view, so changes to a role's permissions take effect immediately. A minimum-role rule plus optional per-user overrides determine what each account can open.",
);

sectionHeading("7. Technology Stack");
subHeading("Frontend");
table(
  ["Package", "Purpose"],
  [
    ["React 19 + Vite 8", "UI framework and build tooling"],
    ["React Router 7", "Client-side routing"],
    ["Ant Design 6", "UI component library"],
    ["Recharts 3", "Chart rendering"],
    ["CesiumJS", "3D globe and geospatial map"],
    ["Axios", "HTTP client"],
    ["crypto-js", "Encrypted local storage"],
  ],
  [0.34, 0.66],
);
subHeading("Backend");
table(
  ["Package", "Purpose"],
  [
    ["Node.js + Express 5", "REST API runtime and framework"],
    ["MongoDB / Mongoose", "Database and object modelling"],
    ["bcryptjs", "Password hashing"],
    ["jsonwebtoken", "JWT authentication"],
    ["Nodemailer", "Email delivery for password flows"],
  ],
  [0.34, 0.66],
);

sectionHeading("8. System Architecture");
paragraph(
  "The application is a single-page React client served behind a reverse proxy that also forwards API traffic to an Express service backed by MongoDB. The client handles routing, authentication context, and WebGL map rendering; the API handles authentication, dataset storage, settings, and password flows.",
);
bullets([
  ["Client", "React 19 SPA — pages, auth context, and the Cesium 3D map; talks to the API via Axios."],
  ["Reverse proxy", "serves static files and proxies /api requests to the Express service."],
  ["API", "Express endpoints for auth, water-quality datasets, and admin/app settings."],
  ["Database", "MongoDB collections for users, WQM datasets, and application settings."],
]);

sectionHeading("9. Sample Screen");
imageCaption("hero.png", "Figure 3 — Representative application visual.", 230);

sectionHeading("10. Getting Started (Developers)");
bullets([
  ["Prerequisites", "Node.js 22 LTS, MongoDB, and Git."],
  ["Install", "run npm install in both front-end and server."],
  ["Configure", "create server/.env with the Mongo connection, JWT secret, and optional MapTiler/Gemini/email keys."],
  ["Run", "start the API (npm start in server) and the client (npm run dev in front-end)."],
]);
paragraph(
  "The published 2026 dataset is stored in encrypted local storage and can be edited live, while archived years are backed by workbook imports. See the docs folder's README, ARCHITECTURE, and DEPLOYMENT guides for full setup and hosting details.",
);

// ════════════════════════════════════════════════════════════════════════
// FILL TABLE OF CONTENTS
// ════════════════════════════════════════════════════════════════════════
doc.switchToPage(tocPageIndex);
doc.x = MARGIN;
doc.y = MARGIN;
doc.save().rect(MARGIN, MARGIN, 4, 22).fill(PRIMARY_LT).restore();
doc.font("Helvetica-Bold").fontSize(H1 + 2).fillColor(PRIMARY).text("Table of Contents", MARGIN + 12, MARGIN - 2);
doc.moveDown(1.2);
doc.save().moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).lineWidth(0.8).strokeColor(LINE).stroke().restore();
doc.moveDown(0.8);

toc.forEach((entry) => {
  const y = doc.y;
  doc.font("Helvetica").fontSize(BODY + 0.5).fillColor(INK).text(entry.title, MARGIN, y, { continued: false });
  // dotted leader
  const titleW = doc.widthOfString(entry.title);
  const pageStr = String(entry.page);
  const pageW = doc.widthOfString(pageStr);
  const leaderStart = MARGIN + titleW + 6;
  const leaderEnd = MARGIN + CONTENT_W - pageW - 6;
  if (leaderEnd > leaderStart) {
    doc.save().dash(1, { space: 2.5 }).moveTo(leaderStart, y + (BODY + 0.5) * 0.7).lineTo(leaderEnd, y + (BODY + 0.5) * 0.7).lineWidth(0.6).strokeColor(LINE).stroke().undash().restore();
  }
  doc.font("Helvetica-Bold").fontSize(BODY + 0.5).fillColor(PRIMARY_LT).text(pageStr, MARGIN + CONTENT_W - pageW, y);
  doc.moveDown(0.85);
});

// ════════════════════════════════════════════════════════════════════════
// FOOTERS (page numbers) on every content page
// ════════════════════════════════════════════════════════════════════════
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i += 1) {
  doc.switchToPage(i);
  if (i === range.start) continue; // skip cover
  const footY = PAGE_H - MARGIN + 6;
  doc.save();
  doc.moveTo(MARGIN, footY - 6).lineTo(MARGIN + CONTENT_W, footY - 6).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("EMBR3-WQMS — Application Reference", MARGIN, footY, { width: CONTENT_W / 2, align: "left" });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Page ${i + 1}`, MARGIN + CONTENT_W / 2, footY, { width: CONTENT_W / 2, align: "right" });
  doc.restore();
}

doc.end();
stream.on("finish", () => {
  // eslint-disable-next-line no-console
  console.log(`PDF written: ${OUT}`);
});
