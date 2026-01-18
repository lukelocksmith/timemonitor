import { useState, useEffect, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || '';

interface AppUser {
  id: number;
  username: string;
  role: 'admin' | 'pm' | 'user';
  display_name: string | null;
  clickup_user_id: string | null;
  is_active: number;
  created_at: string;
  last_login: string | null;
}

interface ClickUpUser {
  id: string;
  username: string;
  email?: string;
}

export function AdminPanel() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [clickupUsers, setClickupUsers] = useState<ClickUpUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<AppUser | null>(null);

  // Form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'pm' | 'user'>('user');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newClickupUserId, setNewClickupUserId] = useState('');

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (err) {
      setError('Błąd pobierania użytkowników');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchClickupUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setClickupUsers(data);
      }
    } catch {
      // brak dodatkowej obsługi
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchClickupUsers();
  }, [token]);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
          display_name: newDisplayName || undefined,
          clickup_user_id: newRole === 'admin' ? null : (newClickupUserId || null),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Błąd tworzenia użytkownika');
      }

      setShowCreateForm(false);
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setNewDisplayName('');
      setNewClickupUserId('');
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd tworzenia użytkownika');
    }
  };

  const handleUpdateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError('');

    try {
      const response = await fetch(`${API_URL}/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          display_name: newDisplayName,
          role: newRole,
          clickup_user_id: newRole === 'admin' ? null : (newClickupUserId || null),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Błąd aktualizacji użytkownika');
      }

      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd aktualizacji');
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetPasswordUser) return;
    setError('');

    try {
      const response = await fetch(`${API_URL}/admin/users/${resetPasswordUser.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPassword }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Błąd resetowania hasła');
      }

      setResetPasswordUser(null);
      setNewPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd resetowania hasła');
    }
  };

  const handleToggleActive = async (user: AppUser) => {
    try {
      const response = await fetch(`${API_URL}/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_active: !user.is_active }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Błąd zmiany statusu');
      }

      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd zmiany statusu');
    }
  };

  const startEditing = (user: AppUser) => {
    setEditingUser(user);
    setNewDisplayName(user.display_name || '');
    setNewRole(user.role);
    setNewClickupUserId(user.clickup_user_id || '');
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-muted-foreground">Ładowanie użytkowników...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto text-foreground">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">Panel Administratora</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg transition-colors hover:bg-primary/90"
        >
          + Nowy użytkownik
        </button>
      </div>

      {error && (
        <div className="bg-destructive/15 border border-destructive/30 text-destructive px-4 py-3 rounded-lg mb-4">
          {error}
          <button onClick={() => setError('')} className="ml-4 text-destructive hover:text-destructive/80">✕</button>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-2xl border border-border w-full max-w-md">
            <h2 className="text-xl font-bold text-foreground mb-4">Nowy użytkownik</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Hasło</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Nazwa wyświetlana</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Rola</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'admin' | 'pm' | 'user')}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="user">User</option>
                  <option value="pm">PM</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Powiązany pracownik (ClickUp)</label>
                <select
                  value={newClickupUserId}
                  onChange={(e) => setNewClickupUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={newRole === 'admin'}
                >
                  <option value="">Brak</option>
                  {clickupUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username}{user.email ? ` (${user.email})` : ''}
                    </option>
                  ))}
                </select>
                {newRole !== 'admin' && !newClickupUserId && (
                  <p className="text-xs text-destructive mt-1">Dla user/pm wymagane powiązanie</p>
                )}
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary text-primary-foreground rounded transition-colors hover:bg-primary/90"
                >
                  Utwórz
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 py-2 bg-background border border-border text-foreground rounded transition-colors hover:bg-accent"
                >
                  Anuluj
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-2xl border border-border w-full max-w-md">
            <h2 className="text-xl font-bold text-foreground mb-4">Edytuj: {editingUser.username}</h2>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Nazwa wyświetlana</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Rola</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'admin' | 'pm' | 'user')}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={editingUser.id === currentUser?.id}
                >
                  <option value="user">User</option>
                  <option value="pm">PM</option>
                  <option value="admin">Admin</option>
                </select>
                {editingUser.id === currentUser?.id && (
                  <p className="text-xs text-muted-foreground mt-1">Nie możesz zmienić własnej roli</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Powiązany pracownik (ClickUp)</label>
                <select
                  value={newClickupUserId}
                  onChange={(e) => setNewClickupUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={newRole === 'admin'}
                >
                  <option value="">Brak</option>
                  {clickupUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username}{user.email ? ` (${user.email})` : ''}
                    </option>
                  ))}
                </select>
                {newRole !== 'admin' && !newClickupUserId && (
                  <p className="text-xs text-destructive mt-1">Dla user/pm wymagane powiązanie</p>
                )}
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary text-primary-foreground rounded transition-colors hover:bg-primary/90"
                >
                  Zapisz
                </button>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-2 bg-background border border-border text-foreground rounded transition-colors hover:bg-accent"
                >
                  Anuluj
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPasswordUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded-2xl border border-border w-full max-w-md">
            <h2 className="text-xl font-bold text-foreground mb-4">Reset hasła: {resetPasswordUser.username}</h2>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Nowe hasło</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                  minLength={6}
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary text-primary-foreground rounded transition-colors hover:bg-primary/90"
                >
                  Zmień hasło
                </button>
                <button
                  type="button"
                  onClick={() => { setResetPasswordUser(null); setNewPassword(''); }}
                  className="flex-1 py-2 bg-background border border-border text-foreground rounded transition-colors hover:bg-accent"
                >
                  Anuluj
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Username</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Nazwa</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Rola</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Powiązanie</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Ostatnie logowanie</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => (
              <tr key={user.id} className={!user.is_active ? 'opacity-50' : ''}>
                <td className="px-4 py-3 text-foreground font-medium">{user.username}</td>
                <td className="px-4 py-3 text-muted-foreground">{user.display_name || '-'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    user.role === 'admin'
                      ? 'bg-purple-500/20 text-purple-200'
                      : user.role === 'pm'
                        ? 'bg-orange-500/20 text-orange-200'
                        : 'bg-blue-500/20 text-blue-200'
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.clickup_user_id || '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    user.is_active ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'
                  }`}>
                    {user.is_active ? 'Aktywny' : 'Nieaktywny'}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-sm">
                  {user.last_login ? new Date(user.last_login).toLocaleString('pl-PL') : 'Nigdy'}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => startEditing(user)}
                    className="px-2 py-1 text-foreground/80 hover:text-foreground text-sm"
                  >
                    Edytuj
                  </button>
                  <button
                    onClick={() => setResetPasswordUser(user)}
                    className="px-2 py-1 text-muted-foreground hover:text-foreground text-sm"
                  >
                    Hasło
                  </button>
                  {user.id !== currentUser?.id && (
                    <button
                      onClick={() => handleToggleActive(user)}
                      className={`px-2 py-1 text-sm ${
                        user.is_active ? 'text-destructive hover:text-destructive/80' : 'text-emerald-400 hover:text-emerald-300'
                      }`}
                    >
                      {user.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
