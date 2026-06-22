import { emit } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

import { commands } from '../bindings';
import { type StoredDiscordAuth } from '../types/discordAuth';

export type DiscordLoginState = 'idle' | 'opening' | 'waiting' | 'success' | 'error';

export function useDiscordLogin(onSuccess?: (auth: StoredDiscordAuth) => void) {
  const [loginState, setLoginState] = useState<DiscordLoginState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  const startLogin = useCallback(async () => {
    // start the oauth flow and wait for the user to approve in their browser
    if (loginState === 'opening' || loginState === 'waiting') return;
    setLoginState('opening');
    setErrorMessage(null);
    abortRef.current = false;

    try {
      const result = await commands.startDiscordLogin(false);
      if (result.status === 'error') {
        throw new Error(result.error);
      }

      const payload = result.data as unknown as {
        sessionId: string;
        authorizationUrl: string;
      };
      if (!payload?.sessionId || !payload?.authorizationUrl) {
        throw new Error('Invalid response from login server');
      }

      setLoginState('waiting');

      let attempts = 0;
      const maxAttempts = 120;

      // poll the server to see if they finished logging in
      pollRef.current = setInterval(async () => {
        if (abortRef.current) {
          stopPolling();
          setLoginState('idle');
          return;
        }

        attempts++;
        if (attempts > maxAttempts) {
          stopPolling();
          setLoginState('idle');
          setErrorMessage('Login timed out — click the button to try again.');
          return;
        }

        try {
          const pollResult = await commands.pollDiscordLogin(payload.sessionId);
          if (pollResult.status === 'error') return;

          const pollData = pollResult.data as unknown as {
            pending?: boolean;
            loginToken?: string;
          };

          if (pollData?.pending) return;

          if (pollData?.loginToken) {
            stopPolling();

            let userId = 'unknown';
            let userName = 'Unknown User';
            let userAvatarUrl: string | null = null;
            try {
              // crack open the JWT to extract user info (just basic decode, real validation happens server-side)
              const payloadBase64Url = pollData.loginToken.split('.')[1];
              if (payloadBase64Url) {
                // Convert Base64URL to standard Base64
                let base64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
                // Pad with '=' until length is a multiple of 4
                while (base64.length % 4) {
                  base64 += '=';
                }
                const payloadJson = atob(base64);
                const payload = JSON.parse(payloadJson);
                userId = payload.sub || payload.id || 'unknown';
                userName = payload.name || 'Unknown User';
                userAvatarUrl = payload.image || null;
              }
            } catch (e) {
              console.error('Failed to decode JWT payload:', e);
            }

            const authPayload = {
              loginToken: pollData.loginToken,
              user: {
                id: userId,
                username: userName,
                globalName: userName,
                avatarUrl: userAvatarUrl,
              },
            };
            // Pass the object directly so Rust receives a Value::Object, not a Value::String
            await commands.saveDiscordReportAuth(authPayload as any);

            await emit('discord-login-success', {}).catch(() => {});
            setLoginState('success');
            onSuccess?.(authPayload);
          }
        } catch {}
      }, 3000);
    } catch (err) {
      setLoginState('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [loginState, onSuccess]);

  const cancelLogin = useCallback(() => {
    abortRef.current = true;
    stopPolling();
    setLoginState('idle');
    setErrorMessage(null);
  }, []);

  return { loginState, errorMessage, startLogin, cancelLogin };
}
