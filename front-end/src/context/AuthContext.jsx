/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from 'react';
import api from '../api/axios';
import encryptedStorage from '../utils/encryptedStorage';

const STORAGE_KEY = 'wqm_user';
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    encryptedStorage.encryptAllExisting();
    return encryptedStorage.getItem(STORAGE_KEY);
  });

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    encryptedStorage.setItem(STORAGE_KEY, data);
    setUser(data);
    return data;
  };

  const register = async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    if (data.token) {
      encryptedStorage.setItem(STORAGE_KEY, data);
      setUser(data);
    }
    return data;
  };

  const logout = () => {
    encryptedStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
