import CryptoJS from 'crypto-js';

// Key is derived from a static app seed + the browser's origin.
// This prevents simple copy-paste of encrypted values across origins.
const _key = `wqm_enc_${window.location.origin}_2026`;

const encryptedStorage = {
  setItem(key, value) {
    try {
      const serialized = JSON.stringify(value);
      const encrypted = CryptoJS.AES.encrypt(serialized, _key).toString();
      localStorage.setItem(key, encrypted);
    } catch {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },

  getItem(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const bytes = CryptoJS.AES.decrypt(raw, _key);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) return null;
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  },

  removeItem(key) {
    localStorage.removeItem(key);
  },
};

export default encryptedStorage;
