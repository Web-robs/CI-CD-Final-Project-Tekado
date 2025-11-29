import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Container, Paper, Stack, TextField, Typography, Alert } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '../services/apiClient';
import { useNotifier } from '../context/NotificationProvider';

function VerifyEmail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useNotifier();

  const initialEmail = useMemo(() => {
    return location.state?.email || localStorage.getItem('pendingEmailVerification') || '';
  }, [location.state]);

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState(location.state?.devVerificationCode || '');
  const [devCode, setDevCode] = useState(location.state?.devVerificationCode || '');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (location.state?.devVerificationCode) {
      setDevCode(location.state.devVerificationCode);
      setCode(location.state.devVerificationCode);
    }
  }, [location.state]);

  const handleRequestCode = async () => {
    setSending(true);
    setError(null);
    try {
      const response = await apiClient.post('auth/request-verification', { email });
      localStorage.setItem('pendingEmailVerification', email);
      setDevCode(response.data?.devVerificationCode || '');
      notify({ severity: 'success', message: 'Verification code sent. Check your email.' });
    } catch (err) {
      const message = err.response?.data?.msg || 'Unable to send verification code';
      setError(message);
      notify({ severity: 'error', message });
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async e => {
    e.preventDefault();
    setVerifying(true);
    setError(null);
    try {
      const response = await apiClient.post('auth/confirm-email', { email, code });
      const token = response.data?.token;
      if (token) {
        localStorage.setItem('MERNEcommerceToken', token);
      }
      localStorage.removeItem('pendingEmailVerification');
      notify({ severity: 'success', message: 'Email verified! Redirecting…' });
      setTimeout(() => navigate('/', { replace: true }), 500);
    } catch (err) {
      if (err.response?.data?.errors) {
        const message = err.response.data.errors.map(e => e.msg).join(', ');
        setError(message);
        notify({ severity: 'error', message });
      } else {
        const message = err.response?.data?.msg || 'Verification failed';
        setError(message);
        notify({ severity: 'error', message });
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 6, mb: 8 }}>
      <Paper elevation={3} sx={{ p: { xs: 4, md: 5 }, borderRadius: 3 }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" align="center" fontWeight={700}>
            Verify your email
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary">
            Enter the verification code we sent to your email to finish signing in.
          </Typography>
        </Stack>

        {devCode ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            Dev code: {devCode}
          </Alert>
        ) : null}

        {error && (
          <Typography variant="body2" color="error" sx={{ display: 'none' }}>
            {error}
          </Typography>
        )}

        <form onSubmit={handleVerify}>
          <TextField label="Email" variant="outlined" fullWidth margin="normal" value={email} onChange={e => setEmail(e.target.value)} required />
          <TextField label="Verification Code" variant="outlined" fullWidth margin="normal" value={code} onChange={e => setCode(e.target.value)} required />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
            <Button onClick={handleRequestCode} variant="outlined" fullWidth disabled={sending}>
              {sending ? <CircularProgress size={18} /> : 'Send Code'}
            </Button>
            <Button type="submit" variant="contained" fullWidth disabled={verifying}>
              {verifying ? <CircularProgress size={18} color="inherit" /> : 'Verify & Sign In'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}

export default VerifyEmail;
