import CryptoJS from 'crypto-js';

// Key is derived from a static app seed + the browser's origin.
// This prevents simple copy-paste of encrypted values across origins.
const _key = `wqm_enc_${window.location.origin}_2026`;
const PREFIX = 'wqm:v2:';
const KEY_PREFIX = 'wqm:k2:';

const getStorageKey = (key) => `${KEY_PREFIX}${CryptoJS.SHA256(`wqm-key:${window.location.origin}:${key}`).toString()}`;

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

const createEncryptedStorage = (storage) => {
  const cache = new Map();

  return {
    setItem(key, value) {
      const storageKey = getStorageKey(key);
      storage.setItem(storageKey, encryptValue(value));
      if (storageKey !== key) storage.removeItem(key);
      cache.set(key, value);
    },

    getItem(key) {
      if (cache.has(key)) return cache.get(key);

      try {
        const storageKey = getStorageKey(key);
        const encryptedRaw = storage.getItem(storageKey);
        const legacyRaw = encryptedRaw ? null : storage.getItem(key);
        const raw = encryptedRaw || legacyRaw;
        if (!raw) {
          cache.delete(key);
          return null;
        }

        const decrypted = decryptValue(raw);
        if (decrypted !== null) {
          if (!raw.startsWith(PREFIX)) this.setItem(key, decrypted);
          if (legacyRaw) {
            storage.setItem(storageKey, encryptValue(decrypted));
            storage.removeItem(key);
          }
          cache.set(key, decrypted);
          return decrypted;
        }

        const parsed = parsePlainValue(raw);
        this.setItem(key, parsed);
        return parsed;
      } catch {
        cache.delete(key);
        return null;
      }
    },

    removeItem(key) {
      storage.removeItem(getStorageKey(key));
      storage.removeItem(key);
      cache.delete(key);
    },

    clear() {
      storage.clear();
      cache.clear();
    },

    clearCache(key = null) {
      if (key) {
        cache.delete(key);
      } else {
        cache.clear();
      }
    },

    encryptAllExisting() {
      Object.keys(storage).forEach((key) => {
        if (key.startsWith(KEY_PREFIX)) return;

        const raw = storage.getItem(key);
        if (!raw) {
          cache.delete(key);
          return;
        }
        const storageKey = getStorageKey(key);

        try {
          const decrypted = decryptValue(raw);
          if (decrypted !== null) {
            storage.setItem(storageKey, encryptValue(decrypted));
            storage.removeItem(key);
            cache.set(key, decrypted);
            return;
          }
        } catch {
          // Continue to plaintext migration.
        }

        const parsed = parsePlainValue(raw);
        storage.setItem(storageKey, encryptValue(parsed));
        storage.removeItem(key);
        cache.set(key, parsed);
      });
    },
  };
};

const localEncryptedStorage = createEncryptedStorage(localStorage);
const sessionEncryptedStorage = createEncryptedStorage(sessionStorage);

window.addEventListener('storage', (event) => {
  if (event.storageArea === localStorage) localEncryptedStorage.clearCache();
  if (event.storageArea === sessionStorage) sessionEncryptedStorage.clearCache();
});

const encryptedStorage = {
  ...localEncryptedStorage,
  local: localEncryptedStorage,
  session: sessionEncryptedStorage,
  encryptAllExisting() {
    localEncryptedStorage.encryptAllExisting();
    sessionEncryptedStorage.encryptAllExisting();
  },
  clearAll() {
    localEncryptedStorage.clear();
    sessionEncryptedStorage.clear();
  },
};

export default encryptedStorage;
