import { createContext, useContext, useEffect, useState } from 'react';
import {
  getAuthState,
  subscribeAuth,
  bootstrapSession,
  login as loginRequest,
  verifyTwoFactor as verifyTwoFactorRequest,
  logout as logoutRequest,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState(getAuthState());

  useEffect(() => {
    const unsubscribe = subscribeAuth(setState);
    bootstrapSession();
    return unsubscribe;
  }, []);

  const value = {
    ...state,
    login: loginRequest,
    verifyTwoFactor: verifyTwoFactorRequest,
    logout: logoutRequest,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
