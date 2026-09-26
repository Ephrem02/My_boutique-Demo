import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogIn, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Button from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Alert } from '../ui/display';
import { describeError } from '../ui/errors';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, user, loading: sessionLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!sessionLoading && user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  // Wrong credentials come back as a 401 with the API's own safe message
  const info = error && (error.status === 401
    ? { title: t('login.failedTitle'), message: t('login.failedMessage') }
    : describeError(error, t, { action: t('errors.actions.signIn') }));

  return (
    <main className="login-screen">
      <div className="login-panel">
        <div className="login-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><Store /></span>
            <span className="brand-name">{t('login.title')}</span>
          </div>
          <LanguageSwitcher />
        </div>
        <form className="login-card" onSubmit={handleSubmit}>
          <h1>{t('login.heading')}</h1>
          <p className="page-subtitle">{t('login.subtitle')}</p>
          {info && <Alert tone="danger" title={info.title}>{info.message}</Alert>}
          <Field label={t('login.email')} required>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </Field>
          <Field label={t('login.password')} required>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" size="lg" block icon={LogIn} loading={loading} loadingText={t('login.signingIn')}>{t('login.signIn')}</Button>
        </form>
        <p className="login-footnote">{t('login.footnote')}</p>
      </div>
    </main>
  );
}
