import CryptoJS from 'crypto-js';

// Key is derived from a static app seed + the browser's origin.
// This prevents simple copy-paste of encrypted values across origins.
const _key = `wqm_enc_${window.location.origin}_2026`;
const PREFIX = 'wqm:v2:';

const encryptValue = (value) => {
  const serialized = JSON.stringify(value);
  return `${PREFIX}${CryptoJS.AES.encrypt(serialized, _key).toString()}`;
};

const decryptValue = (raw) => {
  if (!raw) return null;
  const cipherText = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
  const bytes = CryptoJS.AES.decrypt(cipherText, _key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  if (!decrypted) return null;
  return JSON.parse(decrypted);
};

const parsePlainValue = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const encryptedStorage = {
  setItem(key, value) {
    localStorage.setItem(key, encryptValue(value));
  },

  getItem(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;

      const decrypted = decryptValue(raw);
      if (decrypted !== null) {
        if (!raw.startsWith(PREFIX)) this.setItem(key, decrypted);
        return decrypted;
      }

      const parsed = parsePlainValue(raw);
      this.setItem(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  },

  removeItem(key) {
    localStorage.removeItem(key);
  },

  encryptAllExisting() {
    Object.keys(localStorage).forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw || raw.startsWith(PREFIX)) return;

      try {
        const decrypted = decryptValue(raw);
        if (decrypted !== null) {
          localStorage.setItem(key, encryptValue(decrypted));
          return;
        }
      } catch {
        // Continue to plaintext migration.
      }

      localStorage.setItem(key, encryptValue(parsePlainValue(raw)));
    });
  },
};

export default encryptedStorage;
