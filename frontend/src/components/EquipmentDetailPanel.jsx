import { useEffect, useState } from 'react';
import { getEquipment, getEquipmentServiceHistory, createEquipmentCorrection } from '../api/equipment';
import { useAuth } from '../context/AuthContext';
import StatusBadge from './StatusBadge';

const CORRECTION_TYPES = ['location', 'status', 'runtime_hours', 'ownership', 'other'];
const EMPTY_CORRECTION_FORM = { correction_type: 'location', proposed_value: '', note: '' };

// Dropped inline under a unit's own row in EquipmentPage, same placement rule as
// OrderDetailPanel/TicketDetailPanel. `components` is the L2/L3 child tree (CR
// Docs/CR/customer_population_installed_base.md section 5) -- empty until data actually populates
// it (backfill only creates L1 units so far).
export default function EquipmentDetailPanel({ equipmentId }) {
  const { user } = useAuth();
  const [unit, setUnit] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  const [correctionForm, setCorrectionForm] = useState(EMPTY_CORRECTION_FORM);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState(null);
  const [correctionSubmitted, setCorrectionSubmitted] = useState(null);

  // Fase 1 role distribution (seed 0018): equipment.correct is Customer Admin-only, same reason
  // as rma.create/warranty.create -- it touches a record with commercial consequences. This is
  // cosmetic only (CLAUDE.md) -- the real gate is requirePermission('equipment.correct') server-side.
  const canCorrect = !!user?.is_platform_admin || (Array.isArray(user?.roles) && user.roles.includes('Customer Admin'));

  useEffect(() => {
    let cancelled = false;
    setUnit(null);
    setError(null);
    getEquipment(equipmentId)
      .then((data) => {
        if (!cancelled) setUnit(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [equipmentId]);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    getEquipmentServiceHistory(equipmentId)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [equipmentId]);

  async function handleCorrectionSubmit(e) {
    e.preventDefault();
    if (!correctionForm.proposed_value.trim()) return;
    setCorrectionSubmitting(true);
    setCorrectionError(null);
    try {
      const result = await createEquipmentCorrection({
        equipment_id: equipmentId,
        correction_type: correctionForm.correction_type,
        proposed_value: correctionForm.proposed_value,
        note: correctionForm.note || undefined,
      });
      setCorrectionSubmitted(result);
      setCorrectionForm(EMPTY_CORRECTION_FORM);
    } catch (err) {
      setCorrectionError(err.message);
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  if (error) return <p className="error">Could not load equipment: {error}</p>;
  if (!unit) return <p className="muted">Loading equipment detail...</p>;

  return (
    <div className="quotation-detail-panel">
      <div>
        <p className="muted">
          Model: {unit.model?.name || '-'} · Category: {unit.category?.name || '-'} · Status:{' '}
          <StatusBadge status={unit.status || 'Unknown'} />
        </p>
        <p className="muted">
          Installed: {unit.install_date ? new Date(unit.install_date).toLocaleDateString() : '-'} · Warranty
          until: {unit.warranty_end ? new Date(unit.warranty_end).toLocaleDateString() : '-'} · Location:{' '}
          {unit.location || '-'}
        </p>
        {unit.runtime_hours != null && <p className="muted">Runtime: {unit.runtime_hours.toLocaleString()} hours</p>}
      </div>

      <div>
        <h3>Components</h3>
        {unit.components.length === 0 ? (
          <p className="muted">No individually tracked components on this unit.</p>
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Name</th>
                <th>Serial</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {unit.components.map((c) => (
                <tr key={c.id}>
                  <td data-label="Name">{c.name}</td>
                  <td data-label="Serial">{c.serial_number || '-'}</td>
                  <td data-label="Status">
                    <StatusBadge status={c.status || 'Unknown'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3>Service history</h3>
        {historyError && <p className="error">Could not load service history: {historyError}</p>}
        {!historyError && !history && <p className="muted">Loading service history...</p>}
        {history && history.length === 0 && <p className="muted">No scheduled maintenance recorded for this unit yet.</p>}
        {history && history.length > 0 && (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Request</th>
                <th>Type</th>
                <th>Scheduled</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td data-label="Request">{h.name}</td>
                  <td data-label="Type">{h.maintenance_type || '-'}</td>
                  <td data-label="Scheduled">{h.schedule_date ? new Date(h.schedule_date).toLocaleDateString() : '-'}</td>
                  <td data-label="Stage">{h.stage || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canCorrect && (
        <div>
          <h3>Something wrong with this record?</h3>
          {correctionSubmitted ? (
            <p className="success">
              Correction request submitted (ticket ref #{correctionSubmitted.ticket_id}). Staff will review and
              update the record.
            </p>
          ) : correctionOpen ? (
            <form onSubmit={handleCorrectionSubmit} className="form-grid">
              <label>
                What's wrong
                <select
                  value={correctionForm.correction_type}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, correction_type: e.target.value })}
                >
                  {CORRECTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Correct value
                <input
                  required
                  value={correctionForm.proposed_value}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, proposed_value: e.target.value })}
                  placeholder="e.g. Plant C - New Warehouse"
                />
              </label>
              <label>
                Note (optional)
                <input
                  value={correctionForm.note}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, note: e.target.value })}
                />
              </label>
              {correctionError && <p className="error">{correctionError}</p>}
              <div className="button-row">
                <button type="submit" disabled={correctionSubmitting || !correctionForm.proposed_value.trim()}>
                  {correctionSubmitting ? 'Submitting...' : 'Submit correction request'}
                </button>
                <button type="button" onClick={() => setCorrectionOpen(false)} disabled={correctionSubmitting}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setCorrectionOpen(true)}>
              Request a correction
            </button>
          )}
        </div>
      )}
    </div>
  );
}
