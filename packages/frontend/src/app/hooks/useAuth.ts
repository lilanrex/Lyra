// hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { checkAuthStatus, logout, AuthState, User } from '../utils/auth';

export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    token: null,
    autoSign: false
  });
  const [isLoading, setIsLoading] = useState(true);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        const state = await checkAuthStatus();
        setAuthState(state);
      } catch (error) {
        console.error('Error checking auth status:', error);
        setAuthState({
          isAuthenticated: false,
          user: null,
          token: null,
          autoSign: false
        });
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Login function (updates state after successful auth)
  const login = useCallback((token: string, user: User, autoSign: boolean = false) => {
    localStorage.setItem('lyra_token', token);
    setAuthState({
      isAuthenticated: true,
      user,
      token,
      autoSign
    });
  }, []);

  // Logout function
  const handleLogout = useCallback(async () => {
    try {
      await logout();
      setAuthState({
        isAuthenticated: false,
        user: null,
        token: null,
        autoSign: false
      });
    } catch (error) {
      console.error('Error during logout:', error);
    }
  }, []);

  // Update user info
  const updateUser = useCallback((updatedUser: User) => {
    setAuthState(prev => ({
      ...prev,
      user: updatedUser
    }));
  }, []);

  // Refresh auth state
  const refreshAuth = useCallback(async () => {
    const state = await checkAuthStatus();
    setAuthState(state);
    return state;
  }, []);

  return {
    ...authState,
    isLoading,
    login,
    logout: handleLogout,
    updateUser,
    refreshAuth
  };
};