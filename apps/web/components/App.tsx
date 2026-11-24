'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Metric, SessionUser } from '@relay/types';
import { fetchSession, logout } from '../lib/auth';
import Dashboard from './Dashboard';
import LoginForm from './LoginForm';

interface Props {
  metric: Metric;
  apiUrl: string;
}

type Session =
  | { status: 'loading' }
  | { status: 'signed-out'; notice: string | null }
  | { status: 'signed-in'; user: SessionUser };

/** Decides between the sign-in form and the dashboard, and handles signing out. */
export default function App({ metric, apiUrl }: Props) {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  // Ask the API whether the browser already has a valid session (the cookie is HttpOnly, so
  // the page can't look for it itself).
  useEffect(() => {
    const controller = new AbortController();
    fetchSession(apiUrl, { signal: controller.signal })
      .then((user) =>
        setSession(user ? { status: 'signed-in', user } : { status: 'signed-out', notice: null }),
      )
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSession({
          status: 'signed-out',
          notice: `${err instanceof Error ? err.message : 'Cannot reach the API'}. You can try signing in again.`,
        });
      });
    return () => controller.abort();
  }, [apiUrl]);

  const signOut = useCallback(() => {
    void logout(apiUrl);
    setSession({ status: 'signed-out', notice: null });
  }, [apiUrl]);

  const expired = useCallback(() => {
    setSession({ status: 'signed-out', notice: 'Your session ended. Please sign in again.' });
  }, []);

  if (session.status === 'loading') {
    return (
      <main className="page">
        <div className="sub">Loading…</div>
      </main>
    );
  }

  if (session.status === 'signed-out') {
    return (
      <LoginForm
        apiUrl={apiUrl}
        notice={session.notice}
        onSignedIn={(user) => setSession({ status: 'signed-in', user })}
      />
    );
  }

  return (
    <Dashboard
      metric={metric}
      apiUrl={apiUrl}
      user={session.user}
      onSignOut={signOut}
      onSessionExpired={expired}
    />
  );
}
