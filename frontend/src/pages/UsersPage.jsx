import { useEffect, useState } from 'react';
import { listUsers, createUser, updateUser, disableUser } from '../api/users';
import { listRoles } from '../api/roles';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';

const EMPTY_FORM = { email: '', name: '', odoo_connection_id: '', odoo_partner_id: '', role_ids: [] };
const STATUS_OPTIONS = ['active', 'disabled', 'pending_verification'];

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [activationToken, setActivationToken] = useState(null);

  const [editingUserId, setEditingUserId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const [userPage, roleList] = await Promise.all([listUsers(), listRoles()]);
      setUsers(userPage.data);
      setRoles(roleList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggleRole(roleId) {
    setForm((f) => ({
      ...f,
      role_ids: f.role_ids.includes(roleId) ? f.role_ids.filter((id) => id !== roleId) : [...f.role_ids, roleId],
    }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setActivationToken(null);
    try {
      const created = await createUser({
        email: form.email,
        name: form.name,
        odoo_connection_id: form.odoo_connection_id,
        odoo_partner_id: Number(form.odoo_partner_id),
        role_ids: form.role_ids,
      });
      setActivationToken(created.activation_token);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable(id) {
    if (!window.confirm('Disable this user?')) return;
    await disableUser(id);
    await refresh();
  }

  function startEdit(user) {
    setActivationToken(null);
    setEditError(null);
    setEditingUserId(user.id);
    setEditForm({
      name: user.name,
      status: user.status,
      // The list endpoint returns role names, not ids -- map back to ids via the roles catalog
      // already loaded for the create form's checkboxes.
      role_ids: roles.filter((r) => user.roles.includes(r.name)).map((r) => r.id),
    });
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditForm(null);
    setEditError(null);
  }

  function toggleEditRole(roleId) {
    setEditForm((f) => ({
      ...f,
      role_ids: f.role_ids.includes(roleId) ? f.role_ids.filter((id) => id !== roleId) : [...f.role_ids, roleId],
    }));
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateUser(editingUserId, {
        name: editForm.name,
        status: editForm.status,
        role_ids: editForm.role_ids,
      });
      cancelEdit();
      await refresh();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="users-page">
      <h1>User Management</h1>

      <section className="card">
        <h2>Create user</h2>
        <p className="muted">
          Odoo Connection ID and Partner ID are entered manually for now -- a picker that
          resolves them from a customer&apos;s own Odoo contact is a Phase 2 follow-up (see
          PortalUserCreate in api/openapi.yaml).
        </p>
        <form onSubmit={handleCreate} className="form-grid">
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Odoo Connection ID
            <input
              required
              value={form.odoo_connection_id}
              onChange={(e) => setForm({ ...form, odoo_connection_id: e.target.value })}
            />
          </label>
          <label>
            Odoo Partner ID
            <input
              required
              type="number"
              value={form.odoo_partner_id}
              onChange={(e) => setForm({ ...form, odoo_partner_id: e.target.value })}
            />
          </label>
          <fieldset>
            <legend>Roles</legend>
            {roles.map((role) => (
              <label key={role.id} className="checkbox-label">
                <input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={() => toggleRole(role.id)} />
                {role.name}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create user'}
          </button>
        </form>
        {activationToken && (
          <p className="activation-token">
            User created. Activation token (until the Notification service can email this):
            <br />
            <code>{activationToken}</code>
          </p>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      {editForm && (
        <section className="card">
          <h2>Edit user</h2>
          <form onSubmit={handleEditSubmit} className="form-grid">
            <label>
              Name
              <input
                required
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </label>
            <label>
              Status
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Roles</legend>
              {roles.map((role) => (
                <label key={role.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editForm.role_ids.includes(role.id)}
                    onChange={() => toggleEditRole(role.id)}
                  />
                  {role.name}
                </label>
              ))}
            </fieldset>
            <div className="button-row">
              <button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Saving...' : 'Save changes'}
              </button>
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </form>
          {editError && <p className="error">{editError}</p>}
        </section>
      )}

      <section className="card">
        <h2>Users</h2>
        {loading ? (
          <TableSkeleton cols={5} />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Roles</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name">{u.name}</td>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Status"><StatusBadge status={u.status} /></td>
                  <td data-label="Roles">{u.roles.join(', ')}</td>
                  <td className="button-row">
                    <button type="button" onClick={() => startEdit(u)}>
                      Edit
                    </button>
                    {u.status !== 'disabled' && <button onClick={() => handleDisable(u.id)}>Disable</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
