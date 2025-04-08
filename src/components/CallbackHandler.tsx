import { useEffect } from 'react';
import axios from 'axios';

export function CallbackHandler() {
  useEffect(() => {
    const handleCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');

      if (code) {
        try {
          const response = await axios.get(`http://localhost:3000/callback?code=${code}`);
          localStorage.setItem('access_token', response.data.access_token);
          window.location.href = '/';
        } catch (error) {
          console.error('Error exchanging code for token:', error);
          window.location.href = '/';
        }
      }
    };

    handleCallback();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Processing login...</h2>
      </div>
    </div>
  );
} 