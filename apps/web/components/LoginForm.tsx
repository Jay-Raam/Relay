'use client';

import { useState, type FormEvent } from 'react';
import type { SessionUser } from '@relay/types';
import { login } from '../lib/auth';

interface Props {
  apiUrl: string;
  onSignedIn: (user: SessionUser) => void;
  /** Shown above the form, e.g. "Your session expired". */
  notice?: string | null;
}

export default function LoginForm({ apiUrl, onSignedIn, notice }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await login(apiUrl, email, password);
      setPassword('');
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <main className="page login-page">
      <form className="card login" onSubmit={(e) => void submit(e)}>
        <div className="brand">Relay</div>
        <div className="sub">Sign in to continue</div>

        {notice ? <div className="banner">{notice}</div> : null}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error ? (
          <div className="command-error" role="alert">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
