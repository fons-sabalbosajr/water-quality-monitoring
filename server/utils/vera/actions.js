// Confirm-before-write for VERA data changes.
//
// A write tool returns a proposal; the proposal travels to the browser as a
// signed, expiring, single-use token and is applied only when the same admin
// clicks Confirm. The model can therefore never change data on its own, a token
// cannot be forged or replayed, and a proposal made against data that has since
// changed is rejected instead of silently overwriting the newer value.

const crypto = require('crypto');
const wqm = require('./wqm');

const TOKEN_TTL_MS = 15 * 60 * 1000;
const usedTokens = new Map(); // jti -> expiry (in-process; single API instance)

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required to sign VERA actions.');
  return `vera-action:${s}`;
};

const b64 = (value) => Buffer.from(value).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

const createActionToken = (action, userId) => {
  const body = b64(JSON.stringify({ action, uid: String(userId), exp: Date.now() + TOKEN_TTL_MS, jti: crypto.randomUUID() }));
  return `${body}.${sign(body)}`;
};

/** @returns {{ action: object, jti: string, exp: number }} or throws with a user-facing message */
const verifyActionToken = (token, userId) => {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) throw new Error('Invalid confirmation token.');
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid confirmation token.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.uid !== String(userId)) throw new Error('This change was proposed to a different user.');
  if (Date.now() > payload.exp) throw new Error('This proposal has expired. Ask VERA again.');
  if (usedTokens.has(payload.jti)) throw new Error('This change was already applied.');
  return payload;
};

const markUsed = (jti, exp) => {
  usedTokens.set(jti, exp);
  if (usedTokens.size > 2000) {
    const now = Date.now();
    for (const [key, expiry] of usedTokens) if (expiry < now) usedTokens.delete(key);
  }
};

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

/**
 * Apply an action to a copy of the year's sheets. Pure: returns the new sheets.
 * Throws (status 409) when the target no longer matches what was proposed.
 */
const applyAction = (sheets, action) => {
  const next = JSON.parse(JSON.stringify(sheets));
  const sheet = next.find((s) => s.key === action.sheetKey);
  if (!sheet) throw conflict('That waterbody no longer exists in this year.');
  const stationIndex = (sheet.stations || []).findIndex((s) => Number(s.stnNo) === Number(action.stnNo));

  switch (action.type) {
    case 'update_reading': {
      if (stationIndex < 0) throw conflict('That station no longer exists.');
      const station = sheet.stations[stationIndex];
      station.params = station.params || {};
      const block = station.params[action.paramKey] || { monthly: Array(12).fill(null), avg: null };
      const monthly = Array.from({ length: 12 }, (_, i) => block.monthly?.[i] ?? null);
      if (String(monthly[action.periodIndex] ?? '') !== String(action.before ?? '')) {
        throw conflict(`The reading was changed to ${monthly[action.periodIndex] ?? 'blank'} after VERA proposed this. Ask again to see the current value.`);
      }
      monthly[action.periodIndex] = action.after;
      const isObservation = wqm.normalizeParamName(action.paramKey) === wqm.OBSERVATION_PARAM;
      station.params[action.paramKey] = { ...block, monthly, avg: isObservation ? null : wqm.computeAnnualAverage(monthly) };
      return next;
    }
    case 'set_sampling_date': {
      const targets = action.stnNo === null ? sheet.stations : [sheet.stations[stationIndex]].filter(Boolean);
      if (!targets.length) throw conflict('That station no longer exists.');
      targets.forEach((station) => {
        const dates = Array.from({ length: 12 }, (_, i) => station.samplingDates?.[i] ?? null);
        dates[action.periodIndex] = action.after;
        station.samplingDates = dates;
      });
      return next;
    }
    case 'add_station': {
      if ((sheet.stations || []).some((s) => Number(s.stnNo) === Number(action.stnNo))) {
        throw conflict(`Station ${action.stnNo} was added by someone else in the meantime. Ask VERA again.`);
      }
      // Same parameter set as the waterbody's other stations, all blank.
      const paramKeys = [...new Set((sheet.stations || []).flatMap((s) => Object.keys(s.params || {})))];
      sheet.stations = [...(sheet.stations || []), {
        stnNo: action.stnNo,
        stnId: action.stnId,
        address: action.address || '',
        samplingDates: Array(12).fill(null),
        params: Object.fromEntries(paramKeys.map((key) => [key, { monthly: Array(12).fill(null), avg: null }])),
      }];
      return next;
    }
    case 'update_station': {
      if (stationIndex < 0) throw conflict('That station no longer exists.');
      const station = sheet.stations[stationIndex];
      if (station.stnId !== action.before.stnId) throw conflict('That station was renamed after VERA proposed this. Ask again.');
      Object.assign(station, action.after);
      return next;
    }
    case 'delete_station': {
      if (stationIndex < 0) throw conflict('That station was already removed.');
      if (sheet.stations[stationIndex].stnId !== action.before.stnId) throw conflict('That station changed after VERA proposed this. Ask again.');
      sheet.stations.splice(stationIndex, 1);
      return next;
    }
    default:
      throw Object.assign(new Error('Unknown action.'), { status: 400 });
  }
};

module.exports = { createActionToken, verifyActionToken, markUsed, applyAction, TOKEN_TTL_MS };
