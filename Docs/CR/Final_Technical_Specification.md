**Final Technical Specification --- Customer Self-Service Portal
Terintegrasi Odoo 18**

Berikut saya susun sebagai **baseline dokumentasi implementasi** yang
bisa digunakan sebagai acuan BA, UI/UX, Backend Developer, Frontend
Developer, Odoo Developer, QA, dan DevOps.

Saya merekomendasikan sistem ini dibangun sebagai **Custom Customer
Portal Platform**, bukan sekadar modifikasi Odoo Portal.

**1. Executive Summary**

**Tujuan**

Membangun aplikasi **Customer Self-Service Portal** yang memungkinkan
customer melakukan berbagai aktivitas secara mandiri melalui web/mobile
browser, sementara seluruh transaksi ERP tetap terintegrasi dengan
**Odoo 18**.

Teknologi utama:

  -----------------------------------------------------------------------
  **Layer**             **Technology**
  --------------------- -------------------------------------------------
  Frontend              React.js

  Backend               Express.js / Node.js

  Portal Database       PostgreSQL

  Cache / Queue         Redis, optional

  ERP                   Odoo 18

  Integration           Odoo External API / custom Odoo API

  Authentication        Portal Authentication + RBAC + 2FA

  Payment               Odoo Payment Provider

  File Storage          Odoo Documents / Object Storage

  Reverse Proxy         Nginx / Cloudflare

  Deployment            Docker recommended
  -----------------------------------------------------------------------

Odoo 18 menyediakan External API untuk integrasi eksternal melalui API
model Odoo, termasuk autentikasi dan operasi pada model seperti
res.partner, sale.order, dan model lainnya. Namun, dokumentasi Odoo
menyatakan External API tersedia pada **Custom pricing plans**, bukan
One App Free atau Standard.
([Odoo](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html?utm_source=chatgpt.com))

**2. Arsitektur Sistem**

CUSTOMER

│

▼

┌───────────────────┐

│ React.js │

│ Customer Portal │

└─────────┬─────────┘

│

HTTPS / REST

│

▼

┌───────────────────┐

│ Express.js │

│ API / BFF Layer │

├───────────────────┤

│ Authentication │

│ Authorization │

│ RBAC │

│ 2FA │

│ Business Workflow │

│ Odoo Connector │

│ Payment Handler │

│ Notification │

│ Audit Log │

└──────┬───────┬────┘

│ │

┌────────────┘ └─────────────┐

▼ ▼

┌─────────────────┐ ┌─────────────────┐

│ Portal DB │ │ Odoo 18 │

│ PostgreSQL │ │ ERP │

├─────────────────┤ ├─────────────────┤

│ Users │ │ Customer │

│ Roles │ │ Sales │

│ Permissions │ │ Accounting │

│ Sessions │ │ Inventory │

│ Mapping │ │ Delivery │

│ Audit │ │ Subscription │

│ Custom Request │ │ Helpdesk │

└─────────────────┘ │ Sign │

│ Payment │

└─────────────────┘

**Prinsip utama**

**Odoo = System of Record / ERP**

**Custom Portal = Customer Experience + Identity + Self-Service Layer**

**3. Pembagian Responsibility**

**React.js**

Bertanggung jawab terhadap:

-   UI/UX

-   Dashboard

-   Form

-   Table

-   Customer interaction

-   File upload

-   Notification UI

-   Responsive/mobile interface

-   E-signature interface jika diperlukan

React **tidak boleh** menyimpan:

-   Odoo API Key

-   Odoo password

-   database credential

-   Odoo authentication credential

**Express.js**

Express menjadi **central integration layer**.

Tanggung jawab:

-   Authentication

-   Authorization

-   RBAC

-   User management

-   Session

-   2FA

-   API

-   Validation

-   Business workflow

-   Odoo integration

-   Payment orchestration

-   Notification

-   Audit

-   Security

-   File authorization

**Portal PostgreSQL**

Menyimpan data yang memang merupakan domain aplikasi portal:

Portal User

Role

Permission

Session

User-Company mapping

Odoo connection

Identity mapping

Customer request

Audit log

Notification

**Tidak digunakan untuk menduplikasi seluruh database Odoo.**

**Odoo 18**

Menjadi master untuk:

Customer

Company

Product

Pricelist

Quotation

Sales Order

Invoice

Payment

Stock

Delivery

Subscription

Helpdesk

Project

Timesheet

Contract

ERP Documents

**4. User Management --- Rekomendasi Final**

Saya merekomendasikan:

**Portal User Management dikelola oleh Custom App.**

Sedangkan:

**Customer/Partner Master dikelola Odoo.**

**Mapping**

Portal User

│

│ odoo_partner_id

▼

Odoo res.partner

Contoh:

Portal User

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

Budi

finance@abc.co.id

Role: Finance

odoo_partner_id: 125

↓

Odoo

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

res.partner

ID: 125

Name: PT ABC Indonesia

Odoo Portal sendiri menggunakan contact/customer sebagai basis pemberian
akses portal dan mendukung perubahan informasi customer, password, 2FA,
serta payment information.
([Odoo](https://www.odoo.com/documentation/18.0/id/applications/general/users/portal.html?utm_source=chatgpt.com))

Tetapi karena aplikasi Anda memiliki RBAC dan workflow self-service yang
jauh lebih luas, **identity layer tetap lebih baik berada di custom
application**.

**5. Struktur User Management**

Minimal:

portal_users

portal_roles

portal_permissions

portal_user_roles

portal_role_permissions

portal_user_companies

identity_mappings

sessions

audit_logs

**portal_users**

id

email

password_hash

name

status

odoo_partner_id

default_company_id

last_login_at

created_at

updated_at

**portal_roles**

id

name

description

status

**portal_permissions**

id

code

name

module

Contoh:

invoice.view

invoice.download

invoice.pay

quotation.view

quotation.approve

quotation.reject

order.view

order.reorder

ticket.view

ticket.create

ticket.reply

user.view

user.create

user.disable

**6. Role Customer**

Default role yang disarankan:

**Customer Admin**

User Management ✓

Profile Management ✓

Quotation ✓

Sales Order ✓

Invoice ✓

Payment ✓

Subscription ✓

Helpdesk ✓

Documents ✓

RMA ✓

Warranty ✓

**Finance**

Invoice ✓

Payment ✓

Outstanding ✓

Credit Information ✓

Sales Order View

Quotation View

**Procurement**

Product ✓

Quotation ✓

Sales Order ✓

Reorder ✓

Delivery ✓

Invoice View

**Viewer**

Quotation View

Sales Order View

Invoice View

Delivery View

Documents View

**7. Customer Organization**

Satu customer/company dapat memiliki banyak user.

PT ABC Indonesia

│

├── Budi

│ └── Customer Admin

│

├── Andi

│ └── Finance

│

├── Sinta

│ └── Procurement

│

└── Joko

└── Viewer

Customer Admin dapat mengelola user portal, tetapi **tidak mendapatkan
administrator access ke Odoo**.

Ini mengikuti prinsip least privilege; Odoo sendiri menggunakan
user/groups untuk mengatur access rights dan memperingatkan bahwa
perubahan hak akses harus dikontrol dengan hati-hati.
([Odoo](https://www.odoo.com/documentation/18.0/applications/general/users/access_rights.html?utm_source=chatgpt.com))

**8. Authentication**

Flow:

Customer

│

▼

React Login

│

▼

Express

│

├── Validate email

├── Validate password

├── Check status

├── Check 2FA

├── Load role

├── Load permission

└── Load Odoo mapping

│

▼

Session

│

▼

Dashboard

Password:

password

↓

Argon2id / bcrypt

↓

password_hash

Jangan menyimpan password plaintext.

**9. Odoo Connection Management**

Untuk kebutuhan Anda:

URL

↓

Database

↓

Username

↓

Password / API Key

↓

Check Connection

↓

Check Odoo Version

↓

Authenticate

↓

Get Companies

↓

Select Company

↓

Save

UI:

┌─────────────────────────────────────┐

│ ODOO CONNECTION │

├─────────────────────────────────────┤

│ URL │

│ \[ https://company.odoo.com \] │

│ │

│ Database │

│ \[ company_prod \] │

│ │

│ Username │

│ \[ integration@company.com \] │

│ │

│ Authentication │

│ ○ Password │

│ ● API Key │

│ │

│ \[ \*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\* \] │

│ │

│ \[ CHECK CONNECTION \] │

│ │

│ ✓ Connection Successful │

│ Odoo Version: 18.0 │

│ │

│ Company │

│ \[ PT ABC Indonesia ▼ \] │

│ │

│ \[ SAVE \] │

└─────────────────────────────────────┘

Odoo mendokumentasikan common.version() untuk pengecekan server dan
authenticate() untuk autentikasi; API Key dapat digunakan sebagai
pengganti password untuk external API.
([Odoo](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html?utm_source=chatgpt.com))

**API Key harus encrypted**, bukan plaintext.

**10. Odoo Integration Layer**

Jangan membuat controller seperti:

InvoiceController

↓

langsung XML-RPC

Gunakan:

Controller

↓

Service

↓

Odoo Connector

↓

Odoo

Struktur:

src/

├── controllers/

├── services/

├── repositories/

├── middleware/

├── routes/

├── validators/

├── integrations/

│ └── odoo/

│ ├── OdooClient

│ ├── OdooAuthService

│ ├── OdooPartnerService

│ ├── OdooSalesService

│ ├── OdooInvoiceService

│ ├── OdooPaymentService

│ ├── OdooDeliveryService

│ ├── OdooHelpdeskService

│ └── OdooSubscriptionService

└── utils/

Odoo External API menyediakan operasi search/read/create/update dan
method model melalui API.
([Odoo](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html?utm_source=chatgpt.com))

**11. API Architecture**

Gunakan versioning:

/api/v1/

**Authentication**

POST /api/v1/auth/login

POST /api/v1/auth/logout

POST /api/v1/auth/refresh

POST /api/v1/auth/2fa/enable

POST /api/v1/auth/2fa/verify

POST /api/v1/auth/password/change

POST /api/v1/auth/password/forgot

**User**

GET /api/v1/users

POST /api/v1/users

GET /api/v1/users/:id

PATCH /api/v1/users/:id

DELETE /api/v1/users/:id

**Company**

GET /api/v1/companies

GET /api/v1/companies/current

POST /api/v1/companies/switch

**Sales**

GET /api/v1/quotations

GET /api/v1/quotations/:id

POST /api/v1/quotations/:id/approve

POST /api/v1/quotations/:id/reject

GET /api/v1/orders

GET /api/v1/orders/:id

POST /api/v1/orders/:id/reorder

**Invoice**

GET /api/v1/invoices

GET /api/v1/invoices/:id

GET /api/v1/invoices/:id/pdf

POST /api/v1/invoices/:id/pay

POST /api/v1/invoices/:id/payment-proof

**Delivery**

GET /api/v1/deliveries

GET /api/v1/deliveries/:id

GET /api/v1/deliveries/:id/tracking

POST /api/v1/deliveries/:id/confirm

**After Sales**

GET /api/v1/rma

POST /api/v1/rma

GET /api/v1/rma/:id

GET /api/v1/warranty

POST /api/v1/warranty/claims

GET /api/v1/service-requests

POST /api/v1/service-requests

**Helpdesk**

GET /api/v1/tickets

POST /api/v1/tickets

GET /api/v1/tickets/:id

POST /api/v1/tickets/:id/reply

**12. Self-Service Scope**

**A. Customer Account**

  ------------------------------------------------------------------------
  **Feature**                      **Status**   **Source**
  -------------------------------- ------------ --------------------------
  View Profile                     🟢           Odoo

  Edit Profile                     🟢           Odoo

  Billing Address                  🟢           Odoo

  Shipping Address                 🟢           Odoo

  Manage PIC                       🟢           Odoo + Portal

  Password                         🟢           Portal

  2FA                              🟢           Portal

  Customer Level                   🟢           Odoo
  ------------------------------------------------------------------------

**13. Sales**

  -----------------------------------------------------------------------
  **Feature**                                          **Status**
  ---------------------------------------------------- ------------------
  View Quotation                                       🟢

  Approve Quotation                                    🟢

  Reject Quotation                                     🟢

  E-Sign Quotation                                     🟢

  View SO                                              🟢

  Reorder                                              🟡

  Request Product                                      🟡

  Request Quotation                                    🟡

  Order Tracking                                       🟢
  -----------------------------------------------------------------------

**14. Finance**

  -----------------------------------------------------------------------
  **Feature**                                            **Status**
  ------------------------------------------------------ ----------------
  View Invoice                                           🟢

  Download Invoice                                       🟢

  Due Date                                               🟢

  Payment Status                                         🟢

  Online Payment                                         🟢

  Outstanding                                            🟢

  Credit Limit                                           🟢

  Upload Payment Proof                                   🟡
  -----------------------------------------------------------------------

Odoo 18 dapat menampilkan **Pay Now** pada invoice Customer Portal
ketika Online Invoice Payment diaktifkan.
([Odoo](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments/online.html?utm_source=chatgpt.com))

Odoo 18 juga menyediakan sejumlah payment provider termasuk **Xendit,
Stripe, PayPal, Adyen, Mollie, Razorpay**, dan lainnya.
([Odoo](https://www.odoo.com/documentation/18.0/applications/finance/payment_providers.html?utm_source=chatgpt.com))

**15. Delivery**

SO

↓

Delivery Order

↓

Picking

↓

Shipment

↓

Delivered

Portal:

Order Status

│

├── Confirmed

├── Processing

├── Packed

├── Shipped

└── Delivered

Fitur:

-   Delivery Order

-   Tracking Number

-   Shipment Status

-   ETA

-   Delivery Confirmation

-   POD

Untuk tracking carrier eksternal, Express dapat mengintegrasikan API
carrier.

**16. RMA / Complaint / Warranty**

Ini sebaiknya menggunakan **custom workflow**.

**RMA**

Customer

↓

Create RMA

↓

Review

↓

Approved

↓

Return

↓

Warehouse Inspection

↓

Refund / Replacement

**Warranty**

Warranty Claim

↓

Validate Serial Number

↓

Validate Warranty Period

↓

Validate Customer

↓

Create Service Request

↓

Technician

↓

Complete

**17. Helpdesk**

Odoo Helpdesk digunakan sebagai backend ticket.

React

↓

Express

↓

Odoo Helpdesk

↓

helpdesk.ticket

Customer dapat:

-   Create ticket

-   View ticket

-   Reply

-   Upload attachment

-   View status

-   View assigned team

-   Close/reopen sesuai policy

**18. Document Management**

Dokumen dapat berasal dari Odoo Documents atau storage portal.

Kategori:

Documents

│

├── Quotation

├── Sales Order

├── Invoice

├── Tax Invoice

├── Delivery Order

├── Surat Jalan

├── Contract

├── Warranty

├── Service Report

└── POD

Odoo Documents sendiri mendukung pengaturan hak akses terhadap
file/folder dan akses portal.
([Odoo](https://www.odoo.com/documentation/18.0/id/applications/productivity/documents.html?utm_source=chatgpt.com))

**19. Contract & Subscription**

Jika menggunakan Odoo Subscription:

Subscription

├── Active

├── Expiring

├── Renew

├── Upgrade

├── Downgrade

└── Close

Recurring invoice tetap berasal dari Odoo.

Portal hanya menyediakan customer interaction.

**20. Approval Workflow**

Gunakan state machine.

Contoh quotation:

DRAFT

↓

SENT

↓

CUSTOMER_REVIEW

↓

APPROVED

↓

SIGNED

↓

CONFIRMED

Reject:

CUSTOMER_REVIEW

↓

REJECTED

↓

Sales Team

Order Change:

Customer

↓

Change Request

↓

Internal Review

↓

Approved

↓

Update Odoo SO

**21. Real-Time Status**

Untuk tahap awal:

React

↓

Polling 30-60 sec

↓

Express

↓

Odoo

Untuk production scale:

Odoo

↓

Event / Webhook

↓

Queue

↓

Express

↓

WebSocket

↓

React

Contohnya:

\"Invoice INV/00125 has been paid.\"

\"Order SO/00125 has been shipped.\"

\"Ticket HD/00125 has been updated.\"

**22. Security**

Minimal:

HTTPS

JWT / Secure Session

RBAC

2FA

Rate Limiting

Input Validation

SQL Injection Protection

CORS

CSRF protection where applicable

Audit Log

API Key Encryption

Secrets Management

File Access Validation

**Sangat penting**

Customer request:

GET /invoices/999

tidak boleh langsung diteruskan ke Odoo.

Backend harus:

Session

↓

Portal User

↓

Odoo Partner

↓

Company

↓

Permission

↓

Validate Record Ownership

↓

Odoo

**23. Multi-Company**

Karena requirement Anda memiliki pilihan Company:

Customer

│

├── PT ABC Indonesia

├── PT ABC Malaysia

└── PT ABC Singapore

maka user mapping:

portal_user_companies

user_id

odoo_company_id

is_default

Saat user memilih:

Current Company

\[ PT ABC Indonesia \]

semua transaksi harus dibatasi terhadap company tersebut.

**24. Multi-Odoo --- Optional Future Architecture**

Arsitektur Anda bahkan dapat dikembangkan:

Customer Portal

│

Express

│

┌──────────────┼──────────────┐

▼ ▼ ▼

Odoo A Odoo B Odoo C

Indonesia Singapore Malaysia

Connection:

odoo_connections

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

id

name

url

database

username

encrypted_api_key

version

status

Mapping:

identity_mappings

\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\--

portal_user_id

odoo_connection_id

odoo_partner_id

odoo_user_id

odoo_company_id

Ini akan membuat platform Anda jauh lebih scalable.

**25. Database Architecture**

**Portal Database**

portal_users

portal_roles

portal_permissions

portal_user_roles

portal_role_permissions

portal_user_companies

odoo_connections

odoo_companies

identity_mappings

sessions

refresh_tokens

customer_requests

rma_requests

warranty_claims

payment_proofs

notifications

audit_logs

**Jangan copy tabel Odoo**

Jangan membuat:

portal_invoices

portal_sales_orders

portal_products

portal_stock

sebagai master kedua kecuali untuk **cache/read model** yang memang
dirancang secara khusus.

**26. Source of Truth**

┌───────────────────────────┬───────────────┐

│ DATA │ MASTER │

├───────────────────────────┼───────────────┤

│ Portal User │ Portal │

│ Password │ Portal │

│ Role │ Portal │

│ Permission │ Portal │

│ Session │ Portal │

│ Audit Login │ Portal │

│ Customer │ Odoo │

│ Company │ Odoo │

│ Product │ Odoo │

│ Price │ Odoo │

│ Quotation │ Odoo │

│ Sales Order │ Odoo │

│ Invoice │ Odoo │

│ Payment │ Odoo │

│ Stock │ Odoo │

│ Delivery │ Odoo │

│ Subscription │ Odoo │

│ Helpdesk │ Odoo │

│ RMA │ Odoo/Custom │

│ Warranty │ Odoo/Custom │

└───────────────────────────┴───────────────┘

**27. Odoo Custom Module**

Tidak semua requirement perlu dibuat sebagai custom Odoo module.

Saya sarankan custom module hanya untuk:

portal_rma

portal_warranty

portal_customer_request

portal_delivery_confirmation

portal_order_change

portal_service_request

Sedangkan standard Odoo digunakan untuk:

Sales

Accounting

Inventory

Delivery

Subscription

Helpdesk

Sign

Payment

Documents

**28. Payment Architecture**

Saya **tidak menyarankan membuat payment engine sendiri**.

Gunakan:

Customer

↓

Portal

↓

Express

↓

Odoo Payment

↓

Payment Provider

↓

Webhook

↓

Odoo

↓

Invoice Paid

Odoo mendukung payment provider pada customer portal/eCommerce dan
menangani informasi pembayaran sensitif melalui provider tersertifikasi,
sehingga data kartu tidak perlu disimpan di server Odoo.
([Odoo](https://www.odoo.com/documentation/18.0/applications/finance/payment_providers.html?utm_source=chatgpt.com))

**29. Notification Architecture**

Odoo Event

↓

Express

↓

Notification Service

├── In-App

├── Email

└── Push

Event:

Quotation Created

Quotation Approved

Order Confirmed

Invoice Created

Invoice Overdue

Payment Received

Shipment Created

Shipment Shipped

Shipment Delivered

Ticket Updated

Warranty Expiring

Contract Expiring

**30. Dashboard**

Dashboard utama:

┌─────────────────────────────────────────────────┐

│ Welcome, PT ABC │

├─────────────────────────────────────────────────┤

│ │

│ Quotations Orders Invoices Tickets │

│ 5 12 8 3 │

│ │

│ Outstanding Balance │

│ Rp 125.000.000 │

│ │

├─────────────────────────────────────────────────┤

│ Recent Activities │

│ │

│ SO/00125 Shipped Today │

│ INV/00125 Payment Pending Today │

│ HD/00125 Ticket Updated Yesterday │

│ │

├─────────────────────────────────────────────────┤

│ Pending Actions │

│ │

│ Quotation Approval 2 │

│ Payment 3 │

│ Document Signature 1 │

└─────────────────────────────────────────────────┘

**31. Menu Final**

CUSTOMER PORTAL

│

├── Dashboard

│

├── My Account

│ ├── Company Profile

│ ├── Addresses

│ ├── Contacts / PIC

│ ├── User Management

│ └── Security

│

├── Sales

│ ├── Quotations

│ ├── Sales Orders

│ ├── Reorder

│ └── Request Quotation

│

├── Finance

│ ├── Invoices

│ ├── Payments

│ ├── Outstanding

│ └── Credit Information

│

├── Delivery

│ ├── Delivery Orders

│ ├── Tracking

│ └── Delivery Confirmation

│

├── After Sales

│ ├── RMA / Return

│ ├── Warranty

│ ├── Service Request

│ └── Complaint

│

├── Documents

│ ├── Quotations

│ ├── Sales Orders

│ ├── Invoices

│ ├── Tax Documents

│ ├── Delivery Documents

│ └── Contracts

│

├── Products

│ ├── Catalog

│ ├── Customer Price

│ ├── Availability

│ └── Purchase History

│

├── Contract & Subscription

│ ├── Contracts

│ └── Subscriptions

│

├── Communication

│ ├── Tickets

│ ├── Messages

│ └── Notifications

│

└── Approvals

├── Pending

├── Approved

└── Rejected

**32. Implementation Phase**

Saya menyarankan development tidak langsung membuat seluruh fitur
sekaligus.

**Phase 1 --- Foundation**

Authentication

User Management

RBAC

Odoo Connection

Odoo Connector

Customer Mapping

Company Selection

Audit Log

**Phase 2 --- Core Customer Portal**

Dashboard

Profile

Quotation

Sales Order

Invoice

Document

Notification

**Phase 3 --- Payment**

Online Payment

Payment Status

Outstanding

Payment Proof

**Phase 4 --- Fulfillment**

Delivery Order

Tracking

Delivery Status

POD

Delivery Confirmation

**Phase 5 --- After Sales**

Helpdesk

Complaint

Service Request

RMA

Warranty

**Phase 6 --- Contract**

Contract

Subscription

Renewal

Upgrade

Downgrade

**Phase 7 --- Advanced**

Real-time Notification

Recommendation

Multi-Odoo

Advanced Analytics

Mobile/PWA

SSO

**33. Acceptance Criteria Utama**

**Connection**

-   Admin dapat memasukkan URL Odoo.

-   Admin dapat memasukkan database.

-   Admin dapat memasukkan username.

-   Admin dapat memasukkan API Key.

-   System dapat melakukan connection test.

-   System dapat membaca versi Odoo.

-   System dapat authenticate.

-   System dapat mengambil company.

-   Admin dapat memilih company.

-   Credential disimpan encrypted.

**User**

-   Customer Admin dapat membuat user.

-   Customer Admin dapat disable user.

-   Customer Admin dapat assign role.

-   User hanya melihat company yang diizinkan.

-   User tidak dapat melihat customer lain.

-   Password di-hash.

-   2FA dapat diaktifkan.

-   Semua login/logout tercatat.

**Sales**

-   Customer dapat melihat quotation.

-   Customer dapat approve.

-   Customer dapat reject.

-   Customer dapat sign.

-   Customer dapat melihat SO.

-   Reorder mengikuti price/stock/approval Odoo.

**Finance**

-   Customer dapat melihat invoice.

-   Customer dapat download invoice.

-   Customer dapat melihat outstanding.

-   Customer dapat membayar online.

-   Payment status tersinkronisasi kembali dari Odoo.

**Delivery**

-   Customer dapat melihat DO.

-   Customer dapat melihat tracking.

-   Customer dapat melakukan delivery confirmation.

-   POD dapat disimpan.

**After Sales**

-   Customer dapat membuat RMA.

-   Customer dapat membuat complaint.

-   Customer dapat membuat warranty claim.

-   Customer dapat melihat status request.

**34. Risiko yang Harus Diantisipasi**

**1. API Odoo**

Pastikan Odoo customer memiliki plan/environment yang mendukung External
API. Dokumentasi Odoo 18 menyatakan external API tidak tersedia pada One
App Free dan Standard.
([Odoo](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html?utm_source=chatgpt.com))

**2. Performance**

Jangan semua request langsung query Odoo tanpa caching/aggregation.

**3. Security**

Jangan expose Odoo credential ke frontend.

**4. Data Duplication**

Jangan membuat database ERP kedua.

**5. Permission**

Jangan hanya mengandalkan frontend permission.

**Authorization wajib dilakukan di Express.**

**6. Payment**

Jangan membuat payment processor sendiri jika Odoo payment provider
sudah memenuhi kebutuhan.

**7. Odoo Upgrade**

Buat OdooConnector abstraction sehingga perubahan API tidak menyebar ke
seluruh aplikasi.

**35. Final Architecture Decision**

Saya menyarankan keputusan arsitektur berikut sebagai **baseline resmi
development**:

  -----------------------------------------------------------------------
  **Component**             **Decision**
  ------------------------- ---------------------------------------------
  Frontend                  **React.js**

  Backend                   **Express.js / Node.js**

  Database                  **PostgreSQL**

  Cache                     Redis optional

  ERP                       **Odoo 18**

  Customer Master           **Odoo**

  Portal User Master        **Custom App**

  Authentication            **Custom App**

  RBAC                      **Custom App**

  2FA                       **Custom App**

  Odoo Integration          **Express Odoo Connector**

  ERP Transaction           **Odoo**

  RMA                       Custom Workflow

  Warranty                  Custom Workflow

  Complaint                 Odoo Helpdesk + Custom Portal

  Payment                   Odoo Payment Provider

  E-Sign                    Odoo Sign

  Documents                 Odoo Documents / Object Storage

  Notification              Express + Odoo

  Audit                     Portal DB

  Multi-company             Portal Mapping + Odoo

  Multi-Odoo                Supported by architecture

  API                       REST /api/v1

  Deployment                Docker + Nginx/Cloudflare
  -----------------------------------------------------------------------

**Kesimpulan Final**

Arsitektur yang paling tepat untuk kebutuhan ini adalah:

CUSTOMER

│

▼

┌───────────────┐

│ React.js │

│ Customer UI │

└───────┬───────┘

│

▼

┌───────────────┐

│ Express.js │

│ API / BFF │

├───────────────┤

│ Auth │

│ User │

│ RBAC │

│ 2FA │

│ Workflow │

│ Odoo Adapter │

│ Payment │

│ Notification │

│ Audit │

└───────┬───────┘

│

┌──────────┴──────────┐

▼ ▼

┌──────────────┐ ┌──────────────┐

│ Portal DB │ │ Odoo 18 │

├──────────────┤ ├──────────────┤

│ Users │ │ Customer │

│ Roles │ │ Sales │

│ Permissions │ │ Accounting │

│ Sessions │ │ Inventory │

│ Mapping │ │ Delivery │

│ Audit │ │ Subscription │

│ Requests │ │ Helpdesk │

└──────────────┘ │ Sign │

│ Payment │

└──────────────┘

**Core principle-nya:**

**Custom Portal mengelola siapa customer itu di dalam portal dan apa
yang boleh dia lakukan. Odoo mengelola apa yang dimiliki customer dan
transaksi apa yang terjadi.**

Dengan arsitektur ini, kebutuhan Anda untuk **customer self-service,
user management, quotation approval, order, invoice, payment, delivery,
RMA, complaint, warranty, document, subscription, communication, dan
approval workflow** dapat dikembangkan secara modular tanpa menjadikan
portal sebagai duplikasi ERP.

Sebagai baseline integrasi, dokumentasi resmi Odoo 18 mencakup External
API, Portal Access, Online Payment, Payment Providers, dan Documents.
([Odoo](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html?utm_source=chatgpt.com))
