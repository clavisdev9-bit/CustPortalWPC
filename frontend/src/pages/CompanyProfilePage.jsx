import { useEffect, useState } from 'react';
import { getProfile } from '../api/profile';

const m2o = (v) => (Array.isArray(v) ? v[1] : v) || null;

export default function CompanyProfilePage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getProfile()
      .then(setProfile)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const addressLine = profile
    ? [profile.street, profile.street2].filter(Boolean).join(', ')
    : null;
  const cityLine = profile
    ? [profile.city, m2o(profile.state_id), profile.zip].filter(Boolean).join(' ')
    : null;

  return (
    <div className="company-profile-page">
      <h1>Company Profile</h1>
      {error && <p className="error">{error}</p>}
      <section className="card">
        {loading ? (
          <p>Loading...</p>
        ) : !profile ? (
          <p className="muted">No company profile found.</p>
        ) : (
          <>
            <h2>{profile.name}</h2>
            <div className="info-grid">
              <div className="info-field">
                <dt>Tax ID</dt>
                <dd>{profile.vat || '-'}</dd>
              </div>
              <div className="info-field">
                <dt>Email</dt>
                <dd>{profile.email || '-'}</dd>
              </div>
              <div className="info-field">
                <dt>Phone</dt>
                <dd>{profile.phone || '-'}</dd>
              </div>
              <div className="info-field">
                <dt>Mobile</dt>
                <dd>{profile.mobile || '-'}</dd>
              </div>
              <div className="info-field">
                <dt>Website</dt>
                <dd>{profile.website || '-'}</dd>
              </div>
              <div className="info-field">
                <dt>Industry</dt>
                <dd>{m2o(profile.industry_id) || '-'}</dd>
              </div>
              <div className="info-field info-field--wide">
                <dt>Registered Address</dt>
                <dd>
                  {addressLine || cityLine ? (
                    <>
                      {addressLine && <div>{addressLine}</div>}
                      {cityLine && <div>{cityLine}</div>}
                      {m2o(profile.country_id) && <div>{m2o(profile.country_id)}</div>}
                    </>
                  ) : (
                    '-'
                  )}
                </dd>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
