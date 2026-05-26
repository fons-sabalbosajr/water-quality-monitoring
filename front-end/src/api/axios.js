import axios from 'axios';
import encryptedStorage from '../utils/encryptedStorage';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/water-quality-monitoring/api' : '/api'),
});

// Attach JWT token automatically
api.interceptors.request.use((config) => {
  const user = encryptedStorage.getItem('wqm_user');
  if (user?.token) {
    config.headers.Authorization = `Bearer ${user.token}`;
  }
  return config;
});

export default api;
