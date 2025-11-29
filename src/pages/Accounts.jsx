import React, { useEffect, useState } from 'react';
import {
  Box,
  CircularProgress,
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Stack,
  Button,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/apiClient';
import { useNotifier } from '../context/NotificationProvider';

function Accounts() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { notify } = useNotifier();
  const token = typeof window !== 'undefined' ? localStorage.getItem('MERNEcommerceToken') : null;

  useEffect(() => {
    if (!token) return;
    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get('auth/users', {
          headers: { 'x-auth-token': token },
        });
        setUsers(res.data || []);
      } catch (err) {
        const message = err.response?.data?.msg || 'Unable to load accounts';
        setError(message);
        notify({ severity: 'error', message });
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [token, notify]);

  if (!token) {
    return (
      <Container maxWidth="md" sx={{ mt: 8 }}>
        <Paper sx={{ p: 4, borderRadius: 3 }}>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            Sign in required
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You need to be signed in to view the account list.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/login')}>
            Go to login
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 6, mb: 8 }}>
      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h5" fontWeight={700}>
            Accounts
          </Typography>
          {loading && <CircularProgress size={20} />}
        </Stack>

        {error && (
          <Typography variant="body2" color="error" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Verified</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map(user => (
                <TableRow key={user.id}>
                  <TableCell>{user.id}</TableCell>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.emailVerified ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{user.createdAt ? new Date(user.createdAt).toLocaleString() : '-'}</TableCell>
                </TableRow>
              ))}
              {!users.length && !loading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      No accounts found.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Container>
  );
}

export default Accounts;
