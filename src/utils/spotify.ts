import axios from 'axios';
import CryptoJS from 'crypto-js';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const BACKEND_URL = 'http://localhost:3000';

export const generateCodeVerifier = () => {
  const codeVerifier = CryptoJS.lib.WordArray.random(32).toString();
  localStorage.setItem('code_verifier', codeVerifier);
  return codeVerifier;
};

export const generateCodeChallenge = (codeVerifier: string) => {
  return CryptoJS.SHA256(codeVerifier)
    .toString(CryptoJS.enc.Base64)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const getSpotifyAuthUrl = () => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: import.meta.env.VITE_SPOTIFY_CLIENT_ID,
    scope: 'user-read-currently-playing',
    redirect_uri: import.meta.env.VITE_SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
};

export const exchangeCodeForToken = async (code: string) => {
  const codeVerifier = localStorage.getItem('code_verifier');
  
  if (!codeVerifier) {
    throw new Error('No code verifier found. Please try logging in again.');
  }

  try {
    const response = await axios.post(`${BACKEND_URL}/api/spotify/token`, {
      code,
      code_verifier: codeVerifier,
    });

    const { access_token, refresh_token, expires_in } = response.data;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('token_expiry', String(Date.now() + expires_in * 1000));
    
    return { access_token, refresh_token };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Token exchange error:', error.response?.data);
      throw new Error(error.response?.data?.error || 'Failed to exchange code for token');
    }
    throw error;
  }
};

export const refreshAccessToken = async () => {
  const refresh_token = localStorage.getItem('refresh_token');
  
  if (!refresh_token) {
    throw new Error('No refresh token available');
  }

  try {
    const response = await axios.post(`${BACKEND_URL}/api/spotify/token`, {
      grant_type: 'refresh_token',
      refresh_token,
    });

    const { access_token, expires_in } = response.data;
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('token_expiry', String(Date.now() + expires_in * 1000));
    
    return access_token;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Token refresh error:', error.response?.data);
      throw new Error(error.response?.data?.error || 'Failed to refresh token');
    }
    throw error;
  }
};

export const getCurrentlyPlaying = async () => {
  const access_token = localStorage.getItem('access_token');
  const token_expiry = localStorage.getItem('token_expiry');
  
  if (!access_token) {
    throw new Error('No access token available');
  }

  // Check if token needs refresh
  if (token_expiry && Date.now() > parseInt(token_expiry)) {
    try {
      await refreshAccessToken();
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }

  try {
    const response = await axios.get(`${SPOTIFY_API_URL}/me/player/currently-playing`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
    
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      // Token expired, try to refresh
      try {
        const newToken = await refreshAccessToken();
        const response = await axios.get(`${SPOTIFY_API_URL}/me/player/currently-playing`, {
          headers: {
            Authorization: `Bearer ${newToken}`,
          },
        });
        return response.data;
      } catch (refreshError) {
        console.error('Error after token refresh:', refreshError);
        throw refreshError;
      }
    }
    console.error('Error fetching currently playing track:', error);
    return null;
  }
}; 