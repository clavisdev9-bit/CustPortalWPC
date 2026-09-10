# Data Dictionary — Customer Population (Installed Base)

Satu-satunya tempat yang memetakan istilah client → istilah industri → field Odoo → field API,
satu-satu. Sumber: [`Docs/CR/customer_population_installed_base.md`](../CR/customer_population_installed_base.md)
§2.2, §5, §6, disinkronkan dengan implementasi nyata (bukan lagi rancangan) per 2026-08-30.

> Kalau istilah di sini menyimpang dari kode, **kode yang benar** — perbarui dokumen ini, bukan
> sebaliknya. Field Odoo di bawah adalah field addon `installed_base`
> (`odoo18_1/ODOO_STAGING_PT_DIRA/installed_base`), bukan Odoo Studio — lihat
> [`Docs/ops/odoo_studio_installed_base.md`](../ops/odoo_studio_installed_base.md) untuk kenapa.

---

## 1. Istilah umum

| Istilah client | Istilah industri | Kode/URL | Catatan |
|---|---|---|---|
| Customer population | Installed base / population data / fleet | domain `equipment`; UI **"My Equipment"** | "Population" tidak dipakai di kode (D-6) — bertabrakan konseptual dengan `res.partner` |
| Mesin | Unit / asset | `maintenance.equipment` dengan `parent_equipment_id = false` | Level L1 |
| Detail sparepart | Component / serviceable part | `maintenance.equipment` anak, atau baris katalog servis (`product.template`) | Level L2/L3 |
| Satuan terkecil | Lowest serviceable item (LSI) | dibatasi D-3: harus punya SKU (`is_serviceable_part`) | Baut/seal tanpa SKU sendiri **tidak** masuk registry |
| Upgrade sparepart | Supersession / retrofit | `superseded_by_id` | Benefit #2 CR |
| Jatuh tempo servis | Due replacement | `equipmentService.getDueReplacements` / `getPartsForUnit` | Mesin rekomendasi §9, deterministik |
| Perkiraan armada | Fleet-level estimate | `attribution: 'fleet_estimated'` | D-5 — dipakai saat pembelian part tidak bisa ditautkan ke satu unit |

---

## 2. EquipmentUnit (L1/L2/L3) — `maintenance.equipment`

| Field API (`EquipmentUnit`, openapi.yaml) | Field Odoo | Tipe | Wajib | Catatan |
|---|---|---|---|---|
| `id` | `id` | integer | (w) | id Odoo |
| `name` | `name` | char | (w) | Label unit (bawaan, dipakai apa adanya) |
| `serial_number` | `serial_no` | char | (w) | Bawaan Odoo. Sumber A-2 |
| `model.product_id` / `model.name` | `catalog_product_id` | m2o `product.product` | (w) | Kunci join ke katalog servis. **Bukan** field bawaan `model` (char bebas) |
| `category.id` / `category.name` | `category_id` | m2o `maintenance.equipment.category` | | Bawaan Odoo |
| `install_date` | `install_date` | date | (w) | Titik nol interval servis. **Bukan** `effective_date` bawaan (itu tanggal aset internal perusahaan sendiri, bukan commissioning di site pelanggan) |
| `warranty_end` | `warranty_date` | date | | Bawaan Odoo |
| `location` | `location` | char | | Bawaan Odoo |
| `status` | `installed_base_status` | selection (`active`/`idle`/`decommissioned`) | (w) | Unit `idle`/`decommissioned` tidak pernah menghasilkan rekomendasi (§9.1) |
| `runtime_hours` | `runtime_hours` | float | | Hanya terisi kalau pelanggan melaporkan |
| `components[]` | anak lewat `parent_equipment_id` | — | | L2/L3, diambil batch (`listChildren`), bukan per-unit |
| — (tidak diekspos) | `customer_id` | m2o `res.partner` | (w) | Pemilik. **Bukan** `partner_id` bawaan (itu Vendor — §6.2) |
| — (audit trail, tidak diekspos) | `lot_id` | m2o `stock.lot` | | Kunci idempotensi backfill |
| — (audit trail, tidak diekspos) | `source_picking_id` | m2o `stock.picking` | | Jejak pengiriman asal |
| — (audit trail, tidak diekspos) | `source_order_id` | m2o `sale.order` | | Jejak sale order asal |

## 3. ServiceCatalogItem (master data) — `product.template`

| Konsep CR §5 | Field Odoo | Tipe | Wajib | Catatan |
|---|---|---|---|---|
| SKU part | (produk itu sendiri) | `product.product` | (w) | Enforced lewat `is_serviceable_part = true` (D-3) |
| Kompatibilitas level keluarga | `compatible_category_ids` | m2m `maintenance.equipment.category` | (w)* | Murah dipelihara |
| Kompatibilitas level model | `compatible_product_ids` | m2m **`product.product`** | | *Deviasi dari CR (aslinya `product.template`)* — dipilih variant-level supaya cocok langsung dengan `catalog_product_id` tanpa hop template→variant |
| Interval bulan | `service_interval_months` | integer | (w)* | Basis utama mesin rekomendasi |
| Interval jam | `service_interval_hours` | integer | | **Informational only** — tidak pernah dipakai menghitung `due_date` (tidak ada data laju konsumsi jam sejak part terakhir diganti) |
| Consumable vs spare | `is_wear_part` | boolean | (w) | |
| Jalur upgrade | `superseded_by_id` | m2o **`product.product`** | | Sama seperti `compatible_product_ids`, deviasi variant-level |
| Alasan upgrade | `supersession_note` | text | | Talking point sales |

*(w)\* — minimal salah satu dari kompatibilitas kategori/produk, dan salah satu dari interval bulan/jam, harus terisi.*

## 4. DueReplacementRow (hasil mesin rekomendasi, §9) — bukan model Odoo, dihitung di `equipmentService.js`

| Field API | Arti | Nilai yang mungkin |
|---|---|---|
| `status` | Status jatuh tempo | `overdue` / `due_soon` (≤60 hari) / `ok` |
| `basis` | Dasar perhitungan `due_date` | `last_purchase` (ada riwayat beli) / `install_date` (belum pernah beli) |
| `basis_date` | Tanggal yang dipakai sebagai titik nol | — |
| `attribution` | Bisakah ditautkan ke unit spesifik | `unit` (bisa) / `fleet_estimated` (tidak bisa — D-5) |
| `attribution_note` | Penjelasan manusiawi saat `fleet_estimated` | null kalau `attribution = 'unit'` |
| `upgrade` | Part pengganti yang direkomendasikan | null kalau part tidak pernah di-superseded |

**Baris tidak pernah muncul (bukan "overdue", tapi tidak ditampilkan sama sekali) ketika**: part
belum pernah dibeli DAN `install_date` unit kosong (§9.3) — tidak ada dasar apa pun untuk
menghitung, jadi tidak ditebak.

## 5. EquipmentCorrection — tabel portal `equipment_corrections`

| Field API | Kolom DB | Catatan |
|---|---|---|
| `id` | `id` (UUID) | |
| `odoo_equipment_id` | `odoo_equipment_id` | id `maintenance.equipment` yang dikoreksi |
| `correction_type` | `correction_type` | `location` / `status` / `runtime_hours` / `ownership` / `other` |
| `proposed_value` | `proposed_value` | Nilai usulan mentah — staf yang menerjemahkan ke Odoo |
| `note` | `note` | Opsional |
| `ticket_id` | `odoo_ticket_id` | `helpdesk.ticket` tempat workflow-nya hidup |
| `status` | *(tidak disimpan)* | Dibaca **live** dari `ticket.stage_id` setiap request — tidak pernah basi (D-2) |

---

## 6. Field yang SENGAJA tidak diekspos API

Ada di Odoo tapi tidak pernah keluar lewat `EquipmentUnit`/`DueReplacementRow` — baik karena
sengaja disembunyikan (identitas pelanggan lain) atau karena hanya audit trail internal:

| Field Odoo | Kenapa disembunyikan |
|---|---|
| `customer_id` | IB-1 — identitas tidak pernah diturunkan dari/ke client; server sudah tahu "siapa Anda" dari sesi |
| `lot_id`, `source_picking_id`, `source_order_id` | Audit trail backfill, tidak relevan bagi pelanggan |
| `partner_id` (bawaan) | Itu **Vendor**, bukan data pelanggan — mengeksposnya membingungkan, bukan berguna |
