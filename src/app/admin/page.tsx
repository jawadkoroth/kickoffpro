'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError('Login failed');
        setLoading(false);
        return;
      }

      // Verify admin role
      const { data: adminUser } = await supabase
        .from('admin_users')
        .select('id')
        .eq('id', data.user.id)
        .single();

      if (!adminUser) {
        await supabase.auth.signOut();
        setError('Not authorized as admin');
        setLoading(false);
        return;
      }

      // Cookies are now set by the SSR browser client. Force a server
      // re-evaluation so the protected admin layout (RSC) sees the new
      // session before navigation lands.
      router.refresh();
      router.replace('/admin/dashboard');
    } catch {
      setError('Something went wrong');
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          KICKOFF<span className={styles.logoHighlight}>PRO</span>
        </div>
        <h1 className={styles.heading}>Admin Dashboard Login</h1>
        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.inputWrapper}>
            <input
              className={styles.inputField}
              type="email"
              placeholder="Admin Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <div className={styles.inputWrapper}>
            <input
              className={styles.inputField}
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className={styles.errorText}>{error}</p>}
          <button
            className={`${styles.submitBtn} ${loading ? 'btn-loading' : ''}`}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In to Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
