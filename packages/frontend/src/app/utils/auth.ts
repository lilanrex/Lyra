// utils/auth.ts
export interface User {
  id: number;
  walletAddress: string;
  name: string | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  autoSign: boolean;
}

// Check if user is authenticated with valid token
export const checkAuthStatus = async (): Promise<AuthState> => {
  const token = localStorage.getItem('lyra_token');
  
  if (!token) {
    return {
      isAuthenticated: false,
      user: null,
      token: null,
      autoSign: false
    };
  }

  try {
    const response = await fetch('http://localhost:3001/api/auth/validate', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const { user, autoSign } = await response.json();
      return {
        isAuthenticated: true,
        user,
        token,
        autoSign: autoSign || false
      };
    } else {
      // Token is invalid, remove it
      localStorage.removeItem('lyra_token');
      return {
        isAuthenticated: false,
        user: null,
        token: null,
        autoSign: false
      };
    }
  } catch (error) {
    console.error('Error checking auth status:', error);
    localStorage.removeItem('lyra_token');
    return {
      isAuthenticated: false,
      user: null,
      token: null,
      autoSign: false
    };
  }
};

// Logout utility
export const logout = async (): Promise<void> => {
  const token = localStorage.getItem('lyra_token');
  
  if (token) {
    try {
      await fetch('http://localhost:3001/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (error) {
      console.error('Error during logout:', error);
    }
  }
  
  localStorage.removeItem('lyra_token');
};

// Create authenticated fetch wrapper
export const authenticatedFetch = async (
  url: string, 
  options: RequestInit = {}
): Promise<Response> => {
  const token = localStorage.getItem('lyra_token');
  
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  return fetch(url, {
    ...options,
    headers
  });
};

// Parse JWT token (client-side only, for reading payload)
export const parseJWT = (token: string): any => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error parsing JWT:', error);
    return null;
  }
};

// Check if JWT token is expired
export const isTokenExpired = (token: string): boolean => {
  const payload = parseJWT(token);
  if (!payload || !payload.exp) return true;
  
  const currentTime = Math.floor(Date.now() / 1000);
  return payload.exp < currentTime;
};