const ApiError = require('../../utils/ApiError');

const PROFILE_FIELDS = [
  'id',
  'name',
  'vat',
  'email',
  'phone',
  'mobile',
  'website',
  'street',
  'street2',
  'city',
  'state_id',
  'zip',
  'country_id',
  'industry_id',
  'category_id',
];

const ADDRESS_FIELDS = ['id', 'type', 'name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'phone', 'email'];

const CONTACT_FIELDS = ['id', 'name', 'function', 'email', 'phone', 'mobile'];

// Company Profile (CR section 10): the authorized partner record itself, id = authorized_partner_id.
async function getProfile(session, partnerId) {
  const [profile] = await session.searchRead('res.partner', [['id', '=', partnerId]], PROFILE_FIELDS);
  if (!profile) throw new ApiError(404, 'not_found', 'Company profile not found');
  return profile;
}

// Addresses (CR section 11): the partner's own address (labelled "office") plus any child
// billing/shipping/other addresses -- parent_id = authorized_partner_id, never a client-sent id.
async function listAddresses(session, partnerId) {
  const [own] = await session.searchRead('res.partner', [['id', '=', partnerId]], ADDRESS_FIELDS);
  const children = await session.searchRead(
    'res.partner',
    [
      ['parent_id', '=', partnerId],
      ['type', 'in', ['invoice', 'delivery', 'other']],
    ],
    ADDRESS_FIELDS,
    { order: 'type' }
  );
  const addresses = [];
  if (own) addresses.push({ ...own, type: 'office' });
  addresses.push(...children);
  return addresses;
}

// Contacts / PIC (CR section 12): child contacts of the authorized partner. Odoo's default
// res.partner.type for a person added under a company is 'contact' -- billing/shipping/other
// addresses use the other type values, so this filter is what keeps PICs out of the Addresses list.
function listContacts(session, partnerId) {
  return session.searchRead(
    'res.partner',
    [
      ['parent_id', '=', partnerId],
      ['type', '=', 'contact'],
    ],
    CONTACT_FIELDS,
    { order: 'name' }
  );
}

module.exports = { getProfile, listAddresses, listContacts };
