import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path'; // Needed if using relative path for dotenv

// Load .env file relative to the src directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('Environment loaded:', {
  clientId: process.env.SPOTIFY_CLIENT_ID ? 'Set' : 'Not set',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ? 'Set' : 'Not set',
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5176', // Add Frontend URL to .env or use default
});

const app = express();
// Configure CORS carefully
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5176' })); // Allow requests only from your frontend
app.use(express.json()); // Middleware to parse JSON bodies

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const FRONTEND_CALLBACK_URL = process.env.FRONTEND_URL || 'http://localhost:5176'; // Use variable

// Redirect to Spotify login, now including PKCE parameters
app.get('/login', (req: Request, res: Response) => {
  const { code_challenge, code_challenge_method } = req.query; // Get PKCE params from frontend

  if (!code_challenge || !code_challenge_method) {
      return res.status(400).json({ error: 'Missing PKCE parameters (code_challenge or code_challenge_method)' });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    scope: 'user-read-currently-playing user-read-playback-state', // Keep scope minimal
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    code_challenge: code_challenge as string, // Add challenge
    code_challenge_method: code_challenge_method as string, // Add method (S256)
  });

  const authUrl = `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  console.log('Redirecting to Spotify Auth URL:', authUrl); // Log the full URL
  res.redirect(authUrl);
});

// Handle Spotify callback - Now just redirects code back to frontend
app.get('/callback', (req: Request, res: Response) => {
  const { code, error, state } = req.query; // Check for code or error

  if (error) {
    console.error('Error received from Spotify callback:', error);
    // Redirect back to frontend with error information
    res.redirect(`${FRONTEND_CALLBACK_URL}?error=${encodeURIComponent(error as string)}`);
    return;
  }

  if (!code) {
    console.error('No code received from Spotify callback');
    // Redirect back to frontend with a generic error
    res.redirect(`${FRONTEND_CALLBACK_URL}?error=missing_code`);
    return;
  }

  console.log('Received code from Spotify, redirecting back to frontend.');
  // Redirect back to frontend, passing the code in the query string
  res.redirect(`${FRONTEND_CALLBACK_URL}?code=${code}`);
});

// New endpoint for frontend to exchange code + verifier for token
app.post('/exchange-token', async (req: Request, res: Response) => {
   const { code, code_verifier } = req.body; // Get code and verifier from POST body

   if (!code || !code_verifier) {
       return res.status(400).json({ error: 'Missing code or code_verifier in request body' });
   }

   console.log('Backend: Received request to exchange code for token.');

   try {
       const params = new URLSearchParams({
           grant_type: 'authorization_code',
           code: code as string,
           redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
           client_id: process.env.SPOTIFY_CLIENT_ID!, // Client ID is needed here for PKCE
           code_verifier: code_verifier as string, // THE CRUCIAL PKCE PARAMETER
       });

       console.log('Backend: Posting to Spotify token URL with verifier.');
       const response = await axios.post(SPOTIFY_TOKEN_URL, params.toString(), {
           headers: {
               'Content-Type': 'application/x-www-form-urlencoded',
               // For PKCE, Basic Auth (Client Secret) is often still required for web apps
               // Depending on your Spotify app setup, it might not be needed. Test both ways.
                Authorization: `Basic ${Buffer.from(
                 `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
                 ).toString('base64')}`,
           },
       });

       console.log('Backend: Token exchange successful.');
       // Send back the relevant token data (access token, expires_in, refresh_token if needed)
       res.json({
           access_token: response.data.access_token,
           expires_in: response.data.expires_in,
           refresh_token: response.data.refresh_token, // You might want to handle refresh tokens later
       });

   } catch (error: any) {
       console.error('Backend: Error exchanging code for token:', error.response?.data || error.message);
        // Send back a more specific error if available
       res.status(error.response?.status || 500).json({
            error: 'Failed to exchange code for token',
            details: error.response?.data || error.message
       });
   }
});

// Get currently playing track (remains mostly the same)
app.get('/current-track', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  console.log("Backend: Received request for /current-track");

  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Important: Handle 204 No Content status from Spotify
    if (response.status === 204 || !response.data || !response.data.item) {
        console.log("Backend: No track currently playing (204 or empty response).");
        return res.status(204).send(); // Send 204 back to frontend
    }

    const { item, is_playing } = response.data;
    console.log("Backend: Successfully fetched track data.");

    res.json({
      name: item.name,
      artist: item.artists[0].name,
      album: item.album.name,
      albumArt: item.album.images[0].url,
      isPlaying: is_playing,
    });
  } catch (err: any) {
    console.error('Backend: Track fetch error:', err.response?.data || err.message);
    // Send back Spotify's error status if available, otherwise 500
    res.status(err.response?.status || 500).json({ error: 'Spotify API error during track fetch', details: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`Frontend URL configured for CORS/Redirects: ${FRONTEND_CALLBACK_URL}`);
});
