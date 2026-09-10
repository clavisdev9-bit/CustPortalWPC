# System Design Documentation --- Customer Self-Service Portal

## Odoo 18 Customer-Scoped Access & Data Isolation

**Document Type:** Functional & Technical System Design\
**Audience:** Senior Business Analyst, Solution Architect, Developer,
QA, DevOps, Odoo Consultant\
**Status:** Proposed implementation based on the supplied as-built
architecture and the requested customer-portal access rule\
**Integration:** Odoo 18 External API\
**Primary principle:** One portal user is explicitly mapped to one
eligible Odoo customer identity and can only access records belonging to
that identity.

------------------------------------------------------------------------

## 1. Purpose

Dokumen ini mendefinisikan implementasi **Customer Self-Service Portal**
yang terintegrasi dengan Odoo 18.

Requirement utama adalah:

> Setelah login, setiap user hanya boleh melihat data customer yang
> telah di-grant kepada user tersebut. User tidak boleh memperoleh data
> customer lain hanya dengan mengganti URL, ID record, request
> parameter, atau memanipulasi request API.

Contoh:

  ---------------------------------------------------------------------------
  Portal User                 Customer/Partner Scope  Hak Data
  --------------------------- ----------------------- -----------------------
  `purbaningruma@gmail.com`   **AYU SENTOSA           Hanya data customer
                              SEJAHTERA, PT**         tersebut

  `aristya.r@outlook.com`     **PT. Aris Sentosa      Hanya data customer
                              Sejahtera**             tersebut
  ---------------------------------------------------------------------------

Arsitektur sumber menyatakan bahwa Custom Portal mengelola **siapa
customer di portal dan apa yang boleh dilakukan**, sedangkan Odoo
mengelola **data yang dimiliki customer dan transaksi ERP**.
fileciteturn0file0L3-L16

------------------------------------------------------------------------

# 2. Scope

## 2.1 Scope Customer Portal

Menu yang menjadi scope dokumen ini:

### Customer Information

1.  Company Profile
2.  Addresses
3.  Contacts / PIC

### Sales

4.  Sales
5.  Quotations
6.  Sales Orders
7.  Request Quotation

### Finance

8.  Invoice

Portal bersifat self-service. Data ERP seperti customer, quotation,
sales order, invoice, product, dan transaksi tetap berasal dari Odoo 18
sesuai source-of-truth yang telah ditentukan.
fileciteturn0file0L452-L460

## 2.2 Out of Scope untuk versi minimum

Fitur berikut tersedia pada arsitektur yang diberikan tetapi tidak
menjadi fokus acceptance scope dokumen ini:

-   Delivery / POD
-   Helpdesk
-   RMA
-   Warranty
-   Subscription
-   Analytics
-   Online payment
-   Advanced notification
-   Multi-Odoo

Fitur tersebut dapat tetap tersedia sesuai role/permission apabila
memang diaktifkan.

------------------------------------------------------------------------

# 3. Existing Architecture

Arsitektur yang digunakan terdiri dari:

  -----------------------------------------------------------------------
  Layer                   Technology              Responsibility
  ----------------------- ----------------------- -----------------------
  Frontend                React 18 + Vite + PWA   Customer UI

  Backend / BFF           Express.js / Node.js    Authentication,
                                                  authorization, business
                                                  logic, Odoo integration

  Portal DB               PostgreSQL              Identity, RBAC,
                                                  session, mapping,
                                                  request, audit dan
                                                  domain portal

  ERP                     Odoo 18                 Customer master dan
                                                  transaksi ERP

  Integration             XML-RPC External API    Komunikasi backend ke
                                                  Odoo
  -----------------------------------------------------------------------

Frontend tidak menyimpan credential Odoo. Backend adalah satu-satunya
komponen yang memegang credential Odoo dan menjalankan authorization.
fileciteturn0file0L49-L60

High-level:

``` text
Customer Browser
       |
       | HTTPS
       v
React SPA / PWA
       |
       | REST /api/v1
       v
Express.js API / BFF
       |
       +--------------------+
       |                    |
       v                    v
Portal PostgreSQL       Odoo 18
       |                    |
       |                    +-- res.partner
       |                    +-- sale.order
       |                    +-- account.move
       |                    +-- products
       |
       +-- Portal User
       +-- Role / Permission
       +-- Identity Mapping
       +-- Session
       +-- Audit
       +-- Customer Request
```

Arsitektur as-built memang menggunakan pola React → Express →
PostgreSQL/Odoo dan memisahkan domain portal dari database Odoo.
fileciteturn0file0L100-L131

------------------------------------------------------------------------

# 4. Core Security Principle

## 4.1 Customer Scope

Customer scope **tidak boleh berasal dari request frontend**.

### Salah

``` http
GET /api/v1/invoices?partner_id=123
```

Backend tidak boleh mempercayai:

``` json
{
  "partner_id": 123
}
```

karena user dapat mengganti:

``` text
partner_id=123
partner_id=456
partner_id=999
```

### Benar

Backend mengambil customer identity dari session:

``` text
JWT
  |
  v
Session
  |
  v
Portal User
  |
  v
Identity Mapping
  |
  v
Odoo Partner
  |
  v
Odoo Company
  |
  v
Permission
  |
  v
Odoo Domain Filter
```

Arsitektur sumber secara eksplisit menetapkan bahwa identity harus
diturunkan dari session, bukan dari parameter yang dikirim client.
fileciteturn0file0L201-L215

------------------------------------------------------------------------

# 5. Identity Mapping

## 5.1 Konsep

Setiap user portal harus mempunyai mapping ke customer Odoo.

Contoh:

``` text
portal_users
-------------------------
id: U001
email: purbaningruma@gmail.com
name: AYU SENTOSA SEJAHTERA, PT
status: active

        |
        v

identity_mappings
-------------------------
portal_user_id: U001
odoo_connection_id: ODOO01
odoo_partner_id: 125
odoo_company_id: 1
```

Untuk user kedua:

``` text
portal_users
-------------------------
id: U002
email: aristya.r@outlook.com
name: PT. Aris Sentosa Sejahtera
status: active

        |
        v

identity_mappings
-------------------------
portal_user_id: U002
odoo_connection_id: ODOO01
odoo_partner_id: 230
odoo_company_id: 1
```

Arsitektur menyediakan tabel `identity_mappings` untuk memetakan portal
user ke `res.partner` per koneksi Odoo, serta `portal_user_companies`
untuk menentukan company yang dapat diakses.
fileciteturn0file0L401-L420

------------------------------------------------------------------------

# 6. Recommended Grant Model

Untuk requirement saat ini, gunakan prinsip:

``` text
1 Portal User
        |
        +---- 1 Customer Scope
                    |
                    +---- 1 Odoo Partner
                    |
                    +---- 1 Odoo Company
```

Contoh:

``` text
purbaningruma@gmail.com
        |
        +--> AYU SENTOSA SEJAHTERA, PT
                |
                +--> Odoo partner_id = 125
                +--> company_id = 1
```

User tidak boleh mempunyai akses:

``` text
PT. Aris Sentosa Sejahtera
PT. Customer Lain
Customer Group Lain
```

kecuali secara eksplisit diberikan mapping baru.

------------------------------------------------------------------------

# 7. User Management Flow

## 7.1 Admin membuat user

Admin portal membuka:

``` text
Administration
  > Users
      > Create
```

Input:

  Field             Example
  ----------------- ---------------------------
  Name              AYU SENTOSA SEJAHTERA, PT
  Email             purbaningruma@gmail.com
  Role              Customer Admin / Viewer
  Status            Active
  Odoo Connection   Odoo Indonesia
  Odoo Customer     AYU SENTOSA SEJAHTERA, PT
  Odoo Company      Main Company

Setelah save:

``` text
Portal User
   |
   +--> Role
   |
   +--> Company Scope
   |
   +--> Identity Mapping
             |
             +--> Odoo Partner
```

------------------------------------------------------------------------

# 8. Login Flow

Untuk user:

``` text
purbaningruma@gmail.com
```

alur:

``` text
1. User membuka portal
2. Input email + password
3. Backend validasi credential
4. Backend membuat session
5. Session menyimpan current_company_id
6. Backend resolve identity mapping
7. Backend mendapatkan:
      - Odoo connection
      - Odoo partner_id
      - Odoo company_id
8. Backend menerbitkan access token
9. Frontend menampilkan customer context
10. Semua API berikutnya menggunakan context dari session
```

Authentication existing menggunakan JWT access token, server-side
session yang dapat dicabut, refresh token rotation, brute-force
protection, dan optional 2FA. fileciteturn0file0L217-L237

------------------------------------------------------------------------

# 9. Expected Login Result

## User

``` text
Email:
purbaningruma@gmail.com
```

## Portal Context

``` text
Customer:
AYU SENTOSA SEJAHTERA, PT
```

Dashboard harus menunjukkan:

``` text
Welcome,
AYU SENTOSA SEJAHTERA, PT
```

dan seluruh menu/data harus berada dalam customer scope tersebut.

### Tidak boleh

``` text
Company Switcher
    - AYU SENTOSA SEJAHTERA, PT
    - PT. Aris Sentosa Sejahtera
    - Customer XYZ
```

Untuk requirement single-customer access, **Company Switcher sebaiknya
disembunyikan** jika user hanya mempunyai satu customer/company scope.

Arsitektur existing memang mendukung company switching, tetapi query
Odoo selalu di-scope ke company aktif. fileciteturn0file0L563-L570

------------------------------------------------------------------------

# 10. Menu & Data Authorization

## 10.1 Company Profile

Source:

``` text
Odoo res.partner
```

Filter:

``` text
id = session.identity.odooPartnerId
```

Response hanya:

``` text
AYU SENTOSA SEJAHTERA, PT
```

Tidak boleh:

``` text
PT. Aris Sentosa Sejahtera
Customer XYZ
```

------------------------------------------------------------------------

# 11. Addresses

Address harus berasal dari customer partner yang telah dimapping.

Recommended rule:

``` text
partner.id = authorized_partner_id
OR
partner.parent_id = authorized_partner_id
```

Contoh:

``` text
AYU SENTOSA SEJAHTERA, PT
|
+-- Billing Address
+-- Shipping Address
+-- Other Address
```

Jika Odoo menggunakan child contact/address, hanya child record yang
berada di bawah customer authorized yang boleh ditampilkan.

Backend harus menentukan parent partner dari identity mapping, bukan
menerima `partner_id` dari frontend.

------------------------------------------------------------------------

# 12. Contacts / PIC

Contacts/PIC menggunakan customer scope yang sama.

Filter:

``` text
parent_id = authorized_partner_id
```

Contoh:

``` text
AYU SENTOSA SEJAHTERA, PT
|
+-- PIC Finance
+-- PIC Procurement
+-- PIC Purchasing
+-- PIC Management
```

User tidak boleh melihat PIC customer lain.

------------------------------------------------------------------------

# 13. Quotations

Endpoint:

``` http
GET /api/v1/quotations
```

Backend:

``` text
session
  ↓
identity mapping
  ↓
partner_id = 125
  ↓
Odoo sale.order
```

Domain minimum:

``` python
[
    ('partner_id', '=', authorized_partner_id),
    ('company_id', '=', authorized_company_id),
]
```

Jika quotation mempunyai customer:

``` text
AYU SENTOSA SEJAHTERA, PT
```

maka quotation boleh tampil.

Jika:

``` text
PT. Aris Sentosa Sejahtera
```

maka quotation harus tidak dikembalikan.

------------------------------------------------------------------------

# 14. Sales Orders

Endpoint:

``` http
GET /api/v1/orders
```

Domain:

``` python
[
    ('partner_id', '=', authorized_partner_id),
    ('company_id', '=', authorized_company_id),
]
```

Detail:

``` http
GET /api/v1/orders/{orderId}
```

harus menggunakan:

``` text
base customer domain
+
id = requested order id
```

Bukan:

``` text
id = requested order id
```

Arsitektur as-built sudah menggunakan pola base domain + record ID
sehingga IDOR/tebakan ID record customer lain tidak mengembalikan record
tersebut. fileciteturn0file0L286-L305

------------------------------------------------------------------------

# 15. Request Quotation

Menu:

``` text
Sales
  > Request Quotation
```

Endpoint existing:

``` http
GET /api/v1/requests
```

Request disimpan pada domain portal melalui:

``` text
customer_requests
```

Sesuai source-of-truth as-built, **Customer Request merupakan data
domain Portal**, sedangkan quotation/sales order tetap merupakan data
Odoo. fileciteturn0file0L413-L415

## Recommended Request Data

``` text
Request ID
Portal User ID
Odoo Partner ID
Odoo Company ID
Request Type
Subject
Description
Product / Service
Quantity
Required Date
Attachment
Status
Created At
```

Critical:

``` text
odoo_partner_id
odoo_company_id
```

harus ditentukan backend dari session.

Jangan menerima customer identity dari frontend.

------------------------------------------------------------------------

# 16. Invoice

Endpoint:

``` http
GET /api/v1/invoices
```

Invoice harus menggunakan domain:

``` python
[
    ('partner_id', '=', authorized_partner_id),
    ('company_id', '=', authorized_company_id),
    ('move_type', '=', 'out_invoice'),
    ('state', '=', 'posted'),
]
```

Pola ini sudah tercermin pada `OdooInvoiceService` dalam arsitektur yang
diberikan. fileciteturn0file0L288-L303

Invoice detail:

``` http
GET /api/v1/invoices/{invoiceId}
```

harus tetap:

``` text
authorized partner
+
authorized company
+
invoice ID
```

------------------------------------------------------------------------

# 17. Sales Summary

Menu `Sales` dapat menjadi dashboard agregasi:

``` text
Sales
-------------------------
Total Quotations
Total Sales Orders
Open Orders
Confirmed Orders
Total Sales Value
```

Semua agregasi wajib menggunakan:

``` text
authorized_partner_id
+
authorized_company_id
```

Tidak boleh menggunakan global Odoo sales count.

------------------------------------------------------------------------

# 18. API Security Pattern

Semua endpoint harus melewati:

``` text
authenticate
    ↓
resolve session
    ↓
resolve identity
    ↓
requirePermission
    ↓
service
    ↓
Odoo domain
```

Contoh:

``` text
GET /api/v1/invoices
```

menjadi:

``` text
authenticate()
        ↓
req.user
        ↓
session.id
        ↓
portal_user.id
        ↓
identity_mapping
        ↓
partnerId = 125
companyId = 1
        ↓
OdooInvoiceService
        ↓
search_read(account.move, domain)
```

Controller tidak boleh memanggil XML-RPC secara langsung. Semua akses
harus melalui service dan Odoo connector.
fileciteturn0file0L136-L160

------------------------------------------------------------------------

# 19. RBAC vs Customer Data Scope

Dua konsep harus dipisahkan.

## RBAC

Menentukan:

> User boleh melakukan apa?

Contoh:

``` text
quotation.view
order.view
invoice.view
request.create
profile.view
```

## Customer Scope

Menentukan:

> User boleh melihat data siapa?

Contoh:

``` text
portal_user = U001
authorized_partner = AYU SENTOSA SEJAHTERA, PT
```

Maka:

``` text
Permission:
    invoice.view = YES

Scope:
    partner_id = AYU SENTOSA SEJAHTERA, PT
```

Hasil:

``` text
User boleh melihat invoice
TETAPI
hanya invoice AYU SENTOSA SEJAHTERA, PT
```

RBAC existing menggunakan role → permission dan authorization wajib
dilakukan di Express, bukan hanya frontend.
fileciteturn0file0L269-L284

------------------------------------------------------------------------

# 20. Recommended Permission Matrix

  Feature                      Viewer   Customer Admin   Finance
  -------------------------- -------- ---------------- ---------
  Company Profile View              ✓                ✓         ✓
  Address View                      ✓                ✓         ✓
  Contact/PIC View                  ✓                ✓         ✓
  Quotation View                    ✓                ✓         ✓
  Quotation Approve/Reject         \-                ✓        \-
  Sales Order View                  ✓                ✓         ✓
  Request Quotation View            ✓                ✓         ✓
  Request Quotation Create         \-                ✓         ✓
  Invoice View                      ✓                ✓         ✓
  Invoice PDF                       ✓                ✓         ✓
  Payment                          \-                ✓         ✓
  User Management                  \-                ✓        \-

Permission harus diterapkan pada backend. Frontend hanya mengontrol
visibility/UX dan bukan security boundary.
fileciteturn0file0L282-L284

------------------------------------------------------------------------

# 21. Data Isolation Matrix

  Data                Odoo Model / Portal   Scope
  ------------------- --------------------- -------------------------------------
  Company Profile     `res.partner`         Authorized Partner
  Addresses           `res.partner`         Authorized Partner + child
  Contacts/PIC        `res.partner`         Authorized Partner children
  Quotations          `sale.order`          `partner_id + company_id`
  Sales Orders        `sale.order`          `partner_id + company_id`
  Invoice             `account.move`        `partner_id + company_id`
  Request Quotation   Portal DB             `portal_user + partner scope`
  User                Portal DB             Own user / delegated customer admin
  Audit               Portal DB             User activity

------------------------------------------------------------------------

# 22. Example --- User AYU

## Login

``` text
Email:
purbaningruma@gmail.com
```

Identity mapping:

``` text
Portal User
    U001
       |
       +--> Odoo Partner 125
                 |
                 +--> AYU SENTOSA SEJAHTERA, PT
```

## Allowed

``` text
Company Profile
Addresses
Contacts / PIC
Sales
Quotations
Sales Orders
Request Quotation
Invoices
```

## Not Allowed

``` text
PT. Aris Sentosa Sejahtera
Customer XYZ
Customer ABC
```

------------------------------------------------------------------------

# 23. Example --- User ARIS

## Login

``` text
Email:
aristya.r@outlook.com
```

Identity mapping:

``` text
Portal User
    U002
       |
       +--> Odoo Partner 230
                 |
                 +--> PT. Aris Sentosa Sejahtera
```

Allowed:

``` text
PT. Aris Sentosa Sejahtera
```

Not allowed:

``` text
AYU SENTOSA SEJAHTERA, PT
Customer XYZ
```

------------------------------------------------------------------------

# 24. Frontend Navigation

Untuk user AYU:

``` text
---------------------------------------
AYU SENTOSA SEJAHTERA, PT
---------------------------------------

Dashboard

Company
  - Company Profile
  - Addresses
  - Contacts / PIC

Sales
  - Sales
  - Quotations
  - Sales Orders
  - Request Quotation

Finance
  - Invoices

Security
  - My Profile
  - Change Password
---------------------------------------
```

Customer name harus berasal dari authenticated user context, bukan
hardcoded.

------------------------------------------------------------------------

# 25. Backend API Surface

Existing architecture menyediakan endpoint:

``` text
/api/v1/auth
/api/v1/users
/api/v1/roles
/api/v1/permissions
/api/v1/companies
/api/v1/quotations
/api/v1/orders
/api/v1/invoices
/api/v1/requests
```

Endpoint quotations, orders, invoices, dan requests memang sudah
tercantum pada API surface as-built. fileciteturn0file0L465-L507

Recommended API:

``` text
GET    /api/v1/companies/current
GET    /api/v1/profile
GET    /api/v1/addresses
GET    /api/v1/contacts

GET    /api/v1/quotations
GET    /api/v1/quotations/:id

GET    /api/v1/orders
GET    /api/v1/orders/:id

GET    /api/v1/requests
POST   /api/v1/requests

GET    /api/v1/invoices
GET    /api/v1/invoices/:id
GET    /api/v1/invoices/:id/pdf
```

------------------------------------------------------------------------

# 26. Critical Backend Rule

Jangan membuat endpoint seperti:

``` http
GET /api/v1/customers/:customerId/orders
```

yang memperbolehkan user menentukan `customerId`.

Jika endpoint tersebut tetap diperlukan untuk internal/admin, endpoint
harus memvalidasi apakah customer tersebut berada dalam authorized
scope.

Untuk customer portal lebih aman:

``` http
GET /api/v1/orders
```

Backend menentukan customer dari authenticated session.

------------------------------------------------------------------------

# 27. Odoo Domain Standard

## Partner

``` python
[
    ('id', '=', authorized_partner_id)
]
```

## Child Contact / Address

``` python
[
    ('parent_id', '=', authorized_partner_id)
]
```

## Sales Order / Quotation

``` python
[
    ('partner_id', '=', authorized_partner_id),
    ('company_id', '=', authorized_company_id)
]
```

## Invoice

``` python
[
    ('partner_id', '=', authorized_partner_id),
    ('company_id', '=', authorized_company_id),
    ('move_type', '=', 'out_invoice'),
    ('state', '=', 'posted')
]
```

------------------------------------------------------------------------

# 28. Record-Level Security Test

QA wajib melakukan pengujian IDOR.

## Test 1 --- Normal

User AYU:

``` http
GET /api/v1/orders
```

Expected:

``` text
Only AYU orders
```

## Test 2 --- Manipulate ID

User AYU:

``` http
GET /api/v1/orders/ORDER_MILIK_ARIS
```

Expected:

``` http
404 Not Found
```

atau response equivalent yang tidak membocorkan existence record.

## Test 3 --- Manipulate Query

``` http
GET /api/v1/orders?partner_id=ARIS
```

Expected:

``` text
Request parameter diabaikan untuk customer scope
```

atau endpoint menolak parameter tersebut.

## Test 4 --- Invoice ID

User AYU mencoba invoice milik ARIS:

``` http
GET /api/v1/invoices/ARIS_INVOICE_ID
```

Expected:

``` text
404 / not_found
```

## Test 5 --- Direct Odoo Access

Browser tidak boleh mempunyai:

``` text
Odoo password
Odoo API key
Odoo database password
```

Frontend hanya berkomunikasi dengan Portal API.

------------------------------------------------------------------------

# 29. User Grant Lifecycle

## Create

``` text
Admin
 ↓
Create Portal User
 ↓
Assign Role
 ↓
Select Odoo Customer
 ↓
Create Identity Mapping
 ↓
Activate
 ↓
Send Invitation / Password Setup
```

## Disable

``` text
Admin
 ↓
Disable User
 ↓
Active session revoked
 ↓
Refresh token revoked
 ↓
User cannot access portal
```

## Change Customer Mapping

Jika user pindah customer:

``` text
Old Mapping
AYU
   ↓
Deactivate

New Mapping
ARIS
   ↓
Activate
```

Semua perubahan wajib masuk audit log.

------------------------------------------------------------------------

# 30. Audit Log

Audit minimal:

``` text
Login
Logout
Failed Login
Password Change
User Created
User Disabled
Role Changed
Customer Mapping Created
Customer Mapping Changed
Quotation Viewed
Quotation Approved
Quotation Rejected
Sales Order Viewed
Invoice Viewed
Invoice PDF Downloaded
Request Quotation Created
```

Audit log pada arsitektur existing bersifat append-only.
fileciteturn0file0L403-L412

------------------------------------------------------------------------

# 31. Source of Truth

  Object                 System of Record
  ---------------------- ------------------
  Portal User            Portal
  Portal Password        Portal
  Portal Role            Portal
  Portal Permission      Portal
  Customer Master        Odoo
  Company Master         Odoo
  Customer Address       Odoo
  Customer Contact/PIC   Odoo
  Quotation              Odoo
  Sales Order            Odoo
  Invoice                Odoo
  Customer Request       Portal
  Audit Log              Portal

Portal tidak boleh membuat duplikasi tabel transaksi Odoo seperti
`portal_invoices` atau `portal_sales_orders`.
fileciteturn0file0L389-L397

------------------------------------------------------------------------

# 32. Error Handling

## Unauthorized

``` http
401 Unauthorized
```

Jika session tidak valid.

## Forbidden

``` http
403 Forbidden
```

Jika user tidak mempunyai permission.

## Record Not Found

``` http
404 Not Found
```

Jika record tidak berada dalam customer scope.

Penting:

Jangan mengembalikan:

``` text
"This invoice belongs to another customer"
```

karena response tersebut dapat membocorkan existence record.

Lebih aman:

``` json
{
  "error": {
    "code": "not_found",
    "message": "Resource not found"
  }
}
```

------------------------------------------------------------------------

# 33. Recommended Database Constraint

Untuk requirement single customer scope, business rule yang disarankan:

``` text
portal_user
    |
    +-- exactly one active identity mapping
```

Jika sistem tetap harus mendukung multi-company di masa depan, struktur
existing dapat dipertahankan, tetapi untuk customer portal biasa UI
tidak perlu menampilkan company switcher ketika hanya terdapat satu
scope.

------------------------------------------------------------------------

# 34. Security Architecture

Security boundary:

``` text
                    INTERNET
                       |
                    HTTPS/TLS
                       |
                       v
                React Frontend
                       |
                  Bearer Token
                       |
                       v
             Express API / BFF
                       |
          +------------+-------------+
          |                          |
     Authentication              RBAC
          |                          |
          +------------+-------------+
                       |
                 Session Context
                       |
                       v
              Identity Mapping
                       |
              +--------+--------+
              |                 |
        Partner Scope      Company Scope
              |                 |
              +--------+--------+
                       |
                       v
                Odoo Service
                       |
                       v
                  Odoo Domain
                       |
                       v
                   Odoo 18
```

Arsitektur existing menggunakan HTTPS/reverse proxy, JWT/session, RBAC,
input validation, encrypted credential, record ownership, dan audit log.
Rate limiting masih menjadi item production hardening.
fileciteturn0file0L318-L331

------------------------------------------------------------------------

# 35. Production Hardening

Sebelum production, beberapa item pada dokumen as-built perlu
ditindaklanjuti:

1.  File upload masih menggunakan local disk; pindahkan ke object
    storage/Odoo Documents.
2.  State SSO exchange dan polling throttle masih in-memory; gunakan
    persistent store jika horizontal scaling.
3.  Tambahkan rate limiting khususnya authentication endpoint.
4.  Pertimbangkan Argon2id atau peningkatan password hashing cost.
5.  Pertimbangkan HttpOnly/SameSite cookie untuk refresh token.
6.  Untuk real-time berskala besar, targetkan Odoo webhook → queue →
    WebSocket.
7.  Redis dapat digunakan untuk caching/queue bila dibutuhkan.

Item-item tersebut memang tercatat sebagai production-hardening
limitation pada arsitektur yang diberikan.
fileciteturn0file0L657-L680

------------------------------------------------------------------------

# 36. Acceptance Criteria

## AC-01 --- Login

**Given** user aktif\
**When** user login\
**Then** user memperoleh session yang valid.

## AC-02 --- Customer Identity

**Given** `purbaningruma@gmail.com`\
**When** login berhasil\
**Then** customer context harus:

``` text
AYU SENTOSA SEJAHTERA, PT
```

## AC-03 --- Profile Isolation

User AYU hanya dapat melihat profile AYU.

## AC-04 --- Address Isolation

User AYU hanya dapat melihat address AYU.

## AC-05 --- Contact Isolation

User AYU hanya dapat melihat contact/PIC AYU.

## AC-06 --- Quotation Isolation

User AYU hanya dapat melihat quotation dengan customer scope AYU.

## AC-07 --- Sales Order Isolation

User AYU hanya dapat melihat sales order dengan customer scope AYU.

## AC-08 --- Invoice Isolation

User AYU hanya dapat melihat invoice dengan customer scope AYU.

## AC-09 --- Request Isolation

Request yang dibuat user AYU harus otomatis memiliki customer scope AYU.

## AC-10 --- IDOR Protection

User AYU tidak dapat mengakses record ARIS dengan mengganti ID URL.

## AC-11 --- Frontend Manipulation

Mengubah `partner_id`, `company_id`, atau customer identifier melalui
browser/API request tidak boleh mengubah customer scope.

## AC-12 --- Disabled User

User yang dinonaktifkan tidak dapat menggunakan session lama.

------------------------------------------------------------------------

# 37. QA Test Matrix

  Test                 User   Data Target       Expected
  -------------------- ------ ----------------- ----------
  Login                AYU    AYU               PASS
  Profile              AYU    AYU               PASS
  Profile              AYU    ARIS              BLOCK
  Address              AYU    AYU               PASS
  Address              AYU    ARIS              BLOCK
  Contact              AYU    AYU               PASS
  Contact              AYU    ARIS              BLOCK
  Quotation            AYU    AYU               PASS
  Quotation            AYU    ARIS              BLOCK
  Order                AYU    AYU               PASS
  Order                AYU    ARIS              BLOCK
  Invoice              AYU    AYU               PASS
  Invoice              AYU    ARIS              BLOCK
  Request              AYU    AYU               PASS
  ID Manipulation      AYU    ARIS ID           BLOCK
  Query Manipulation   AYU    ARIS partner_id   BLOCK
  Disabled User        AYU    Any               BLOCK

------------------------------------------------------------------------

# 38. Recommended Implementation Sequence

## Phase 1 --- Identity & Access

-   Portal User
-   Role
-   Permission
-   Odoo Customer Mapping
-   Company Mapping
-   Session
-   Login
-   Logout
-   Password management

## Phase 2 --- Customer Information

-   Company Profile
-   Addresses
-   Contacts/PIC

## Phase 3 --- Sales

-   Sales dashboard
-   Quotations
-   Sales Orders
-   Request Quotation

## Phase 4 --- Finance

-   Invoice
-   Invoice detail
-   Invoice PDF
-   Outstanding

## Phase 5 --- Security & QA

-   IDOR testing
-   Scope manipulation testing
-   RBAC testing
-   Audit testing
-   Session revocation
-   API penetration testing

------------------------------------------------------------------------

# 39. Final Business Rule

Business rule yang harus menjadi **non-negotiable rule**:

``` text
A portal user MUST NOT be able to select
which Odoo customer it represents during normal operation.
```

Customer identity harus berasal dari:

``` text
Authenticated Session
        ↓
Portal User
        ↓
Identity Mapping
        ↓
Odoo Partner
```

Bukan dari:

``` text
URL
Query Parameter
Request Body
Frontend State
localStorage customer_id
```

Dengan demikian:

``` text
purbaningruma@gmail.com
        ↓
AYU SENTOSA SEJAHTERA, PT
        ↓
Only AYU Data

aristya.r@outlook.com
        ↓
PT. Aris Sentosa Sejahtera
        ↓
Only ARIS Data
```

------------------------------------------------------------------------

# 40. Final Architecture Statement

Implementasi yang direkomendasikan **tidak perlu mengganti arsitektur
existing**.

Arsitektur yang diberikan sudah memiliki komponen yang tepat untuk
requirement ini:

``` text
React SPA
   ↓
Express BFF
   ↓
Authentication
   ↓
RBAC
   ↓
Session
   ↓
Identity Mapping
   ↓
Odoo Partner + Company Scope
   ↓
Domain-locked Odoo Service
   ↓
Odoo 18
```

Perubahan utama yang harus dipastikan pada implementasi adalah:

1.  Setiap portal user memiliki **explicit Odoo customer mapping**.
2.  Customer mapping menjadi **server-side authorization context**.
3.  Semua service Odoo menggunakan **partner + company base domain**.
4.  Frontend tidak pernah menjadi sumber customer authorization.
5.  Detail record selalu menggunakan **base customer domain + record
    ID**.
6.  Request Quotation otomatis mendapatkan customer scope dari session.
7.  Untuk single-customer user, Company Switcher disembunyikan.
8.  Semua perubahan identity mapping dicatat pada audit log.
9.  QA wajib melakukan IDOR dan parameter-manipulation testing.

Dengan pola tersebut, requirement:

> "User AYU hanya dapat melihat data AYU dan tidak dapat melihat data
> customer lain"

menjadi **security rule di backend**, bukan sekadar filter pada tampilan
frontend.

------------------------------------------------------------------------

## Reference to Supplied Architecture

Dokumen ini menggunakan dokumen arsitektur yang diberikan sebagai
baseline. Dokumen sumber menyatakan bahwa sistem adalah Custom Customer
Portal Platform yang terintegrasi dengan Odoo 18, menggunakan
React/Vite, Express/Node.js, PostgreSQL dan Odoo External API, serta
menerapkan identity mapping dan record ownership sebagai kontrol isolasi
data. fileciteturn0file0L42-L60 fileciteturn0file0L286-L305
