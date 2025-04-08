import { useEffect, useState } from 'react';
import './App.css';
import CryptoJS from 'crypto-js';

interface Track {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  isPlaying: boolean;
}

function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function App() {
  const [track, setTrack] = useState<Track | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    const exchangeCodeForToken = async (authCode: string) => {
      const verifier = sessionStorage.getItem('spotify_code_verifier');
      if (!verifier) {
        console.error('Code verifier missing from session storage');
        clearAuth();
        setIsLoading(false);
        return;
      }

      try {
        console.log('Frontend: Exchanging code for token...');
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/exchange-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code: authCode, code_verifier: verifier }),
        });

        window.history.replaceState({}, document.title, '/'); 
        sessionStorage.removeItem('spotify_code_verifier');

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to exchange code for token');
        }

        const { access_token } = await response.json();
        console.log('Frontend: Token received successfully');
        localStorage.setItem('spotify_access_token', access_token);
        setAccessToken(access_token);
        setIsAuthenticated(true);
        await validateAndFetchTrack(access_token);

      } catch (error) {
        console.error('Frontend: Error during token exchange:', error);
        clearAuth();
      }
    };

    if (code) {
      exchangeCodeForToken(code);
    } else {
      const storedToken = localStorage.getItem('spotify_access_token');
      if (storedToken) {
        console.log('Frontend: Found stored token');
        setAccessToken(storedToken);
        setIsAuthenticated(true);
        validateAndFetchTrack(storedToken);
      } else {
        console.log('Frontend: No code or stored token found');
        setIsAuthenticated(false);
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    if (isAuthenticated && accessToken) {
      console.log("Starting track fetch interval");
      intervalId = setInterval(() => validateAndFetchTrack(accessToken), 30000);
    } else {
       console.log("Not authenticated or no access token, interval not started.");
    }

    return () => {
      if (intervalId) {
        console.log("Clearing track fetch interval");
        clearInterval(intervalId);
      }
    };
  }, [isAuthenticated, accessToken]);

  const validateAndFetchTrack = async (token: string | null) => {
     if (!token) {
        console.log('Validate/Fetch: No token provided.');
        clearAuth();
        setIsLoading(false);
        return;
      }
    
      try {
        console.log('Validate/Fetch: Requesting current track...');
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/current-track`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 401) {
          console.log('Validate/Fetch: Token validation failed (401), clearing auth state');
          clearAuth();
          return;
        }

        if (response.status === 204) {
           console.log('Validate/Fetch: No track currently playing (204)');
           setTrack(null);
           setIsAuthenticated(true);
           return;
        }

        if (!response.ok) {
          console.log('Validate/Fetch: Request failed with status:', response.status);
          try {
             const errorData = await response.json();
             console.error('Validate/Fetch: Server error response:', errorData);
           } catch (e) {
             console.error('Validate/Fetch: Could not parse error response.');
           }
          throw new Error('Failed to fetch track');
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            console.log('Validate/Fetch: Successfully fetched track data');
            
            if (data && data.name) {
                 setTrack(data);
                 setIsAuthenticated(true);
             } else {
                 console.log('Validate/Fetch: Received OK but no valid track data.');
                 setTrack(null);
                 setIsAuthenticated(true);
             }
        } else {
             console.log('Validate/Fetch: Received OK but non-JSON response.');
             setTrack(null);
             setIsAuthenticated(true);
        }

      } catch (err) {
        console.error('Validate/Fetch: Error during track fetch:', err);
        clearAuth();
      } finally {
        if (isLoading) setIsLoading(false);
      }
  };

  const clearAuth = () => {
    console.log('Clearing authentication state');
    localStorage.removeItem('spotify_access_token');
    sessionStorage.removeItem('spotify_code_verifier');
    setAccessToken(null);
    setIsAuthenticated(false);
    setTrack(null);
  };

  const handleLogin = async () => {
    console.log('Frontend: Initiating Spotify PKCE login...');
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);

    sessionStorage.setItem('spotify_code_verifier', verifier);

    const params = new URLSearchParams({
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    window.location.href = `${import.meta.env.VITE_BACKEND_URL}/login?${params.toString()}`;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-white bg-black">
      <h1 className="text-3xl font-light mb-6">Roundus</h1>

      {isLoading ? (
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white"></div>
          <p>Loading...</p>
        </div>
      ) : !isAuthenticated ? (
        <button
          onClick={handleLogin}
          className="bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          Login with Spotify
        </button>
      ) : !track ? (
        <div className="text-center">
          <p className="text-gray-300">No track currently playing</p>
          <button
            onClick={clearAuth}
            className="mt-4 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="bg-gray-800/70 p-6 rounded-2xl shadow-lg w-[90%] max-w-2xl flex flex-col items-center">
          <img
            src={track.albumArt}
            alt="Album"
            className="rounded-xl w-64 h-64 mb-4 shadow-md"
          />
          <h2 className="text-2xl font-medium">{track.name}</h2>
          <p className="text-lg text-gray-300">{track.artist}</p>
          <p className="text-sm text-gray-400">{track.album}</p>
          <p className="mt-3 text-sm">
            {track.isPlaying ? 'Now Playing' : 'Paused'}
          </p>
          <button
            onClick={clearAuth}
            className="mt-4 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
