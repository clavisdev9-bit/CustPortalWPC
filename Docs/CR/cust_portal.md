# Customer Portal — Digital Freight Forwarding Platform

> **Purpose:** This document is the functional and technical blueprint for a customer portal for a freight forwarder.
>
> **Primary goal:** Give customers shipment visibility, vessel/air schedules, LCL capacity visibility, booking capabilities, documents, and notifications through one digital portal.
>
> **Codex usage:** Treat this file as the source of truth for the current product requirements and proposed architecture. Preserve existing terminology and phased scope unless a later instruction explicitly changes it.

## Project Principles

1. Build a **customer experience layer on top of the existing operational systems** rather than replacing the client's TMS/ERP.
2. Prioritize **data integration and data quality**; the portal UI is not the main technical risk.
3. Support a hybrid integration model: **API + EDI + CSV/Excel + manual operational update**.
4. Ship an MVP first; defer complex pricing, payments, AI, and native mobile apps.
5. LCL capacity is a key differentiator and should initially be **CBM-based**, with more advanced constraints in later phases.
6. Use role-based access for Customer Admin, Customer User, Sales, Operations, and Admin.
7. Prefer timeline/milestone visibility over a single generic “In Transit” status.

## Scope at a Glance

### Core MVP
- Customer authentication and management
- Sea shipment tracking
- Air shipment tracking
- Vessel schedule
- Air schedule
- LCL available capacity
- Basic notifications
- Admin/operations portal
- Basic reporting

### Later phases
- Online quotation
- Booking workflow
- Document upload/download
- Automated booking
- Dynamic pricing/rate management
- Capacity optimization
- Warehouse/ERP integration
- Billing/payment
- Analytics/KPI/SLA monitoring

---

## 1. Modul utama yang saya sarankan

### A. Shipment Tracking — Air & Sea

Customer login ke portal dan bisa memasukkan/menarik data berdasarkan:

- Booking number
- House B/L / HBL
- Master B/L / MBL
- AWB / MAWB
- Container number
- PO number
- Customer reference

Untuk **sea freight**, informasi dapat berupa:

- Booking confirmed
- Empty container release
- Container pickup
- Stuffing
- Gate-in
- Vessel departed
- Transshipment
- Vessel arrival
- Customs clearance
- Discharge
- Delivery
- POD

Untuk **air freight**:

- Booking confirmed
- Cargo received
- Flight departed
- Transit
- Flight arrived
- Customs
- Cargo released
- Delivery
- POD

Yang penting, jangan hanya menampilkan **“In Transit”**. Customer sebaiknya mendapatkan timeline seperti:

> Booking → Cargo Received → Departed → Transshipment → Arrived → Customs → Delivered

---

## 2. Vessel Schedule

Customer dapat mencari jadwal kapal berdasarkan:

**POL → POD**

Contoh:

> Jakarta / Tanjung Priok → Singapore

Portal menampilkan:

| **VesselVoyageETDETATransitStatus** |      |        |        |        |      |
| ----------------------------------- | ---- | ------ | ------ | ------ | ---- |
| MV XXX                              | 123E | 18 Sep | 22 Sep | 4 Days | Open |
| MV YYY                              | 456W | 20 Sep | 25 Sep | 5 Days | Open |

Bisa ditambahkan filter:

- Shipping line
- POL
- POD
- ETD
- ETA
- Direct / Transshipment
- Cut-off date
- SI cut-off
- VGM cut-off
- CY cut-off

Ini akan sangat berguna untuk customer yang sedang membuat keputusan booking.

---

## 3. Air Schedule

Konsepnya sama dengan vessel schedule, tetapi untuk airline.

Contoh:

**CGK → SIN**

| **AirlineFlightETDETATransitFrequency** |       |        |       |        |       |
| --------------------------------------- | ----- | ------ | ----- | ------ | ----- |
| SQ                                      | SQxxx | 18 Sep | 21:00 | Direct | Daily |
| CX                                      | CXxxx | 18 Sep | 23:00 | 1 Stop | Daily |

Customer bisa melihat:

- Airline
- Flight number
- Origin
- Destination
- ETD
- ETA
- Transit
- Direct / connecting
- Cut-off time
- Available capacity

---

# 4. LCL Capacity — menurut saya ini justru bisa menjadi fitur pembeda

Ini menarik karena Anda ingin customer mengetahui:

> **“Masih ada space kosong untuk shipment saya?”**

Jadi bukan hanya schedule, tetapi **Available LCL Capacity**.

Misalnya client mempunyai consolidation service:

**Jakarta → Singapore**

| **SailingETDETAContainerCapacityAvailable** |        |        |        |        |            |
| ------------------------------------------- | ------ | ------ | ------ | ------ | ---------- |
| Sailing A                                   | 18 Sep | 22 Sep | CFS-01 | 20 CBM | **8 CBM**  |
| Sailing B                                   | 22 Sep | 26 Sep | CFS-02 | 20 CBM | **14 CBM** |
| Sailing C                                   | 25 Sep | 30 Sep | CFS-03 | 20 CBM | **3 CBM**  |

Customer kemudian memasukkan:

> Cargo: 5 CBM

System bisa memberikan:

🟢 **Available — 8 CBM remaining**

Customer bahkan bisa langsung klik:

**Request Booking**

---

# 5. Saya sarankan jangan berhenti di 4 fitur tersebut

Kalau Anda sedang menyusun proposal untuk client, saya akan membangun roadmap seperti ini:

### Phase 1 — Customer Visibility

- Customer login
- Shipment tracking
- Air tracking
- Sea tracking
- Vessel schedule
- Air schedule
- LCL available capacity
- Booking request
- Shipment document download

### Phase 2 — Customer Self-Service

Customer tidak hanya melihat informasi, tetapi bisa melakukan:

- Request quotation
- Request booking
- Upload shipping instruction
- Upload commercial invoice
- Upload packing list
- Upload dokumen customs
- Check quotation
- Approve quotation
- Check booking confirmation
- Download BL/AWB
- Download invoice
- Request delivery

### Phase 3 — Digital Freight Forwarding Platform

Kemudian masuk ke:

- Online quotation
- Dynamic pricing
- Automated booking
- Capacity management
- Container management
- Consolidation planning
- Warehouse/CFS management
- Billing
- Payment
- Customer analytics
- KPI dashboard

---

# 6. Arsitektur yang saya rekomendasikan

Karena client **sudah mempunyai sistem/operasional internal**, saya tidak akan langsung menyarankan mengganti sistem mereka.

Lebih baik dibuat **layer digital customer** di atas existing operation.

```text
                    CUSTOMER
                       │
                       ▼
             ┌──────────────────┐
             │ Customer Portal  │
             │ Web / Mobile     │
             └────────┬─────────┘
                      │
                      ▼
             ┌──────────────────┐
             │ API / Integration│
             │      Layer       │
             └────────┬─────────┘
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
  Internal TMS     Carrier Data    Schedule Data
       │              │              │
       ▼              ▼              ▼
  Shipment Data    Sea / Air       Vessel / Flight
       │
       ▼
  Capacity / LCL

```

Dengan pendekatan ini, customer mendapatkan pengalaman digital tanpa harus mengubah seluruh sistem operasional client.

---

# 7. Hal paling penting: sumber datanya

Ini yang menurut saya perlu Anda bahas dengan client sejak awal.

**UI/portal relatif mudah dibuat. Tantangan sebenarnya adalah data.**

Untuk shipment tracking, data bisa berasal dari:

- Internal TMS
- Shipping line
- Airline
- Freight carrier
- EDI
- API
- Manual operational update

Sedangkan vessel/air schedule bisa berasal dari:

- Carrier API
- Schedule provider
- Data dari shipping line/airline
- Internal database

Dan **LCL capacity** sebaiknya berasal dari **internal booking/consolidation system**, karena capacity tersebut merupakan commercial/operational data milik freight forwarder.

---

# 8. Ada peluang bisnis yang lebih besar

Kalau saya berada di posisi Anda sebagai konsultan, saya tidak akan menjual ini ke client sebagai:

> “Kita buat website tracking.”

Saya akan positioning sebagai:

### **Digital Customer Experience Platform for Freight Forwarder**

Tujuannya:

**Before Shipment**
→ Customer mencari schedule & available capacity

**During Booking**
→ Customer request quotation & booking

**During Shipment**
→ Customer tracking shipment

**After Shipment**
→ Customer mendapatkan dokumen, POD, invoice, dan shipment history.

Jadi customer memiliki **satu portal untuk seluruh proses freight forwarding**.

---

## 9. Contoh dashboard customer

Bayangkan setelah login customer melihat:

```text
┌──────────────────────────────────────────────┐
│              MY SHIPMENTS                    │
├──────────────────────────────────────────────┤
│                                              │
│  12 Active Shipments                         │
│                                              │
│  🚢 8 Sea Shipments     ✈️ 4 Air Shipments  │
│                                              │
├──────────────────────────────────────────────┤
│ Shipment #SO-2026-001                        │
│ Jakarta → Singapore                          │
│                                              │
│ ████████████░░░░░░░░  65%                    │
│                                              │
│ Vessel: XXXXX                                │
│ ETD: 18 Sep 2026                             │
│ ETA: 22 Sep 2026                             │
│ Status: In Transit                           │
│                                              │
│ [View Tracking]                              │
└──────────────────────────────────────────────┘

```

Di menu lain:

```text
BOOK A SHIPMENT

Origin       Jakarta
Destination  Singapore
Mode         LCL
Volume       5 CBM

Available Sailing:

18 Sep       8 CBM AVAILABLE    [BOOK]
22 Sep      14 CBM AVAILABLE    [BOOK]
25 Sep       3 CBM AVAILABLE    [BOOK]

```

Ini sudah mulai terasa seperti **digital freight platform**, bukan sekadar website perusahaan.

---

## 10. Untuk proposal ke client

Saya menyarankan Anda membuat **Business Requirement Document (BRD)** terlebih dahulu sebelum bicara vendor/developer.

Minimal BRD-nya mencakup:

1. **Business objective**
2. Customer journey
3. User roles
4. Shipment tracking requirements
5. Vessel schedule requirements
6. Air schedule requirements
7. LCL capacity management
8. Booking workflow
9. Data sources
10. API/EDI integration
11. Customer portal
12. Admin/operations portal
13. Notification — email/WhatsApp
14. Dashboard & reporting
15. Security & user access
16. Integration architecture
17. MVP scope
18. Phase 2/3 roadmap

Kalau Anda mau, saya juga bisa bantu Anda membuat **blueprint lengkap untuk dipresentasikan ke client**, termasuk **Business Process → Customer Journey → fitur portal → system architecture → database/data flow → API integration → wireframe dashboard → MVP roadmap → estimasi development effort dan model pricing untuk Anda sebagai konsultan**.

Masuk untuk bantuan yang lebih personal terkait pekerjaan, proyek, dan tujuan karier.

**MasukDaftar gratis**
### Conversation context — user
iya, bantu Anda saya blueprint lengkap untuk dipresentasikan ke client, termasuk Business Process → Customer Journey → fitur portal → system architecture → database/data flow → API integration → wireframe dashboard → MVP roadmap → estimasi development effort dan model pricing untuk Anda sebagai konsultan.
### Conversation context — assistant
Tentu. Saya sarankan blueprint ini diposisikan sebagai **proposal transformasi digital customer experience untuk freight forwarder**, bukan sekadar proyek pembuatan website.

Di bawah ini saya buat dalam format yang bisa langsung Anda kembangkan menjadi **deck presentasi client + dasar BRD/RFP untuk vendor IT**.

# Blueprint Digital Freight Forwarding Customer Portal

### Proposed title

**Digital Freight Forwarding Customer Visibility & Self-Service Platform**

**Objective:**
Membangun platform digital yang memungkinkan customer memperoleh visibility terhadap shipment, schedule, dan available capacity secara real-time/semi-real-time, serta secara bertahap melakukan booking dan aktivitas freight forwarding secara digital.

---

# 1. Executive Summary

### Kondisi saat ini

Client telah memiliki:

- Perusahaan freight forwarding
- Customer base
- Proses operasional shipment
- Data shipment
- Relasi dengan shipping line dan airline
- LCL consolidation
- Proses booking dan documentation

Namun customer masih bergantung pada:

- Email
- WhatsApp
- Telepon
- Sales/customer service
- Manual update dari operations

untuk mengetahui:

- Shipment status
- Vessel schedule
- Air schedule
- ETA/ETD
- Available LCL space
- Booking status
- Dokumen shipment

### Masalah bisnis

```text
Customer
   │
   ├── "Shipment saya sudah sampai mana?"
   │
   ├── "Kapal berikutnya kapan?"
   │
   ├── "Ada flight besok?"
   │
   ├── "Masih ada space LCL?"
   │
   └── "Booking saya sudah confirmed?"
              │
              ▼
      Sales / Customer Service
              │
              ▼
          Operations
              │
              ▼
       Carrier / Shipping Line

```

Akibatnya:

- Banyak repetitive inquiry
- Customer service workload tinggi
- Informasi tidak selalu real-time
- Customer bergantung kepada individu
- Sulit melakukan tracking secara transparan
- Potensi LCL capacity tidak terlihat oleh customer
- Opportunity untuk digital booking belum dimanfaatkan

---

# 2. Target Operating Model

Targetnya mengubah proses menjadi:

```text
                    CUSTOMER
                       │
                       ▼
             ┌──────────────────┐
             │ Customer Portal  │
             └────────┬─────────┘
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
   TRACKING        SCHEDULE       CAPACITY
       │              │              │
       └──────────────┼──────────────┘
                      ▼
               BOOKING REQUEST
                      │
                      ▼
             INTERNAL OPERATIONS
                      │
             ┌────────┴────────┐
             ▼                 ▼
         TMS/ERP           Carrier API
             │                 │
             └────────┬────────┘
                      ▼
               STATUS UPDATE
                      │
                      ▼
                   CUSTOMER

```

---

# 3. Business Process — AS IS

Saya sarankan Anda menunjukkan kepada client perbandingan **AS-IS vs TO-BE**.

### AS-IS

```text
Customer
   │
   │ WhatsApp / Email
   ▼
Sales / CS
   │
   ▼
Operations
   │
   ├── Check TMS
   ├── Check carrier
   ├── Check schedule
   └── Check consolidation
   │
   ▼
Sales / CS
   │
   ▼
Customer

```

### Problem

Satu pertanyaan customer bisa membutuhkan beberapa internal activity.

---

# 4. Business Process — TO-BE

```text
Customer Login
      │
      ▼
Customer Portal
      │
      ├───────────────┐
      ▼               ▼
Shipment Tracking   Schedule
      │               │
      │         ┌─────┴─────┐
      │         ▼           ▼
      │       Ocean        Air
      │
      ▼
LCL Capacity
      │
      ▼
Booking Request
      │
      ▼
Operations Review
      │
      ▼
Booking Confirmation
      │
      ▼
Shipment Execution
      │
      ▼
Automatic Status Update
      │
      ▼
Customer Portal

```

---

# 5. Customer Journey

Ini salah satu slide paling penting untuk presentasi.

## Journey 1 — Customer mencari shipment

**Customer:**

> "Saya ingin tahu shipment saya sekarang berada di mana."

### Journey

```text
Login
 ↓
My Shipments
 ↓
Search HBL / AWB / Container
 ↓
Shipment Detail
 ↓
Tracking Timeline
 ↓
ETA / ETD
 ↓
Documents

```

---

## Journey 2 — Customer mencari LCL space

Customer mempunyai:

> Jakarta → Singapore
> 5 CBM
> Ready cargo: 20 September

Customer masuk:

**Book Shipment → LCL**

System menampilkan:

```text
Jakarta → Singapore

18 Sep    8 CBM Available
22 Sep   14 CBM Available
25 Sep    3 CBM Available

```

Customer memilih:

**22 September**

Kemudian:

```text
5 CBM requested
14 CBM available

Remaining:
9 CBM

```

Lalu:

**Request Booking**

---

# 6. Customer Portal — Feature Map

Saya akan membagi menu menjadi 6 kelompok.

### 1. Dashboard

- Active shipment
- Upcoming shipment
- Shipment alerts
- Recent shipment
- Outstanding booking
- Available LCL capacity

### 2. Shipment

- Sea shipment
- Air shipment
- Shipment search
- Tracking
- ETA/ETD
- Container information
- Milestone history

### 3. Schedule

- Vessel schedule
- Air schedule
- POL/POD search
- ETD
- ETA
- Transit time
- Cut-off

### 4. Capacity

- LCL available capacity
- Route
- Sailing
- ETD
- ETA
- Available CBM
- Booking

### 5. Booking

- Request quotation
- Booking request
- Booking history
- Booking status
- Cancel/amend request

### 6. Documents

- HBL
- MBL
- AWB
- Invoice
- Packing list
- POD
- Other documents

---

# 7. Role & Access Management

Jangan membuat semua user memiliki akses yang sama.

### Customer Admin

- View all shipments
- View quotation
- Booking
- Manage users
- Download documents

### Customer User

- View shipment
- View schedule
- Track shipment
- Request booking

### Sales

- Customer management
- Quotation
- Booking approval
- Customer communication

### Operations

- Shipment update
- Booking
- Schedule
- Container
- Consolidation

### Admin

- User management
- Customer management
- Master data
- Integration monitoring
- System configuration

---

# 8. Shipment Tracking Module

### Sea

Minimal milestone:

```text
Booking Confirmed
       ↓
Cargo Received
       ↓
Container Stuffed
       ↓
Gate In
       ↓
Vessel Departed
       ↓
Transshipment
       ↓
Vessel Arrived
       ↓
Discharged
       ↓
Customs Clearance
       ↓
Cargo Released
       ↓
Delivered

```

### Air

```text
Booking Confirmed
       ↓
Cargo Received
       ↓
Accepted by Airline
       ↓
Flight Departed
       ↓
Transit
       ↓
Flight Arrived
       ↓
Customs
       ↓
Released
       ↓
Delivered

```

---

# 9. Vessel Schedule

Search criteria:

**From**

- Port
- Country

**To**

- Port
- Country

**Date**

**Shipping line**

Result:

| **SailingCarrierVesselETDETATransitStatus** |           |          |        |        |    |      |
| ------------------------------------------- | --------- | -------- | ------ | ------ | -- | ---- |
| SL001                                       | Carrier A | Vessel X | 20 Sep | 25 Sep | 5D | Open |
| SL002                                       | Carrier B | Vessel Y | 22 Sep | 28 Sep | 6D | Open |

Tambahkan:

- CY cut-off
- SI cut-off
- VGM cut-off
- Direct/transshipment

---

# 10. Air Schedule

Search:

**Origin → Destination**

Result:

| **AirlineFlightETDETATransitFrequencyStatus** |       |        |        |        |       |      |
| --------------------------------------------- | ----- | ------ | ------ | ------ | ----- | ---- |
| Airline A                                     | XX123 | 20 Sep | 21 Sep | Direct | Daily | Open |
| Airline B                                     | YY456 | 20 Sep | 22 Sep | 1 Stop | Daily | Open |

---

# 11. LCL Capacity Management

Ini saya sarankan menjadi **core differentiator**.

Internal Operations mempunyai:

```text
Consolidation:
JKT → SIN
Container: C-001
ETD: 20 Sep
Maximum: 20 CBM

Bookings:

Customer A     4 CBM
Customer B     3 CBM
Customer C     5 CBM
--------------------
Used           12 CBM

Available       8 CBM

```

Portal menampilkan:

### Available Capacity

**20 CBM total**

**12 CBM booked**

**8 CBM available**

Customer dapat melakukan:

> Request 5 CBM

System melakukan validation:

```text
Requested = 5 CBM
Available = 8 CBM

Result:
AVAILABLE
Remaining = 3 CBM

```

---

# 12. Sangat penting: Capacity tidak sama dengan physical capacity

Ini perlu Anda masukkan ke requirement.

Available LCL capacity sebaiknya bisa dihitung berdasarkan:

- CBM
- Weight
- Package
- Commodity
- Dimension
- Container type
- Destination
- Cut-off
- Operational restriction

Karena:

> 5 CBM cargo belum tentu bisa masuk jika berat/dimensinya tidak sesuai.

Jadi MVP bisa menggunakan:

**CBM-based capacity**

kemudian Phase 2 dikembangkan menjadi:

**CBM + Weight + Dimension + Commodity rules.**

---

# 13. System Architecture

Saya menyarankan arsitektur berikut:

```text
                         CUSTOMER
                            │
                            ▼
                  ┌──────────────────┐
                  │ Customer Portal  │
                  │ Web Responsive   │
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │ API Gateway /    │
                  │ Integration Layer│
                  └────────┬─────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
      Shipment          Schedule         Capacity
       Service           Service          Service
          │                │                 │
          └────────────────┼─────────────────┘
                           │
                           ▼
                    Core Application
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
           TMS            ERP          CRM/Other
            │
            ▼
      Internal Database
            │
            ▼
    Carrier / Airline / Shipping Line

```

---

# 14. Database — High Level

Database minimal:

### Customer

```text
customer
- customer_id
- company_name
- tax_id
- address
- status

```

### User

```text
user
- user_id
- customer_id
- name
- email
- role
- status

```

### Shipment

```text
shipment
- shipment_id
- customer_id
- mode
- booking_no
- HBL
- MBL
- AWB
- origin
- destination
- ETD
- ETA
- status

```

### Shipment Milestone

```text
shipment_milestone
- milestone_id
- shipment_id
- event_code
- event_date
- location
- source

```

### Vessel Schedule

```text
vessel_schedule
- schedule_id
- carrier
- vessel
- voyage
- POL
- POD
- ETD
- ETA
- cutoff
- status

```

### Air Schedule

```text
air_schedule
- schedule_id
- airline
- flight_no
- origin
- destination
- ETD
- ETA
- transit

```

### LCL Capacity

```text
lcl_capacity
- capacity_id
- consolidation_no
- origin
- destination
- ETD
- ETA
- total_cbm
- booked_cbm
- available_cbm
- status

```

### Booking

```text
booking
- booking_id
- customer_id
- capacity_id
- requested_cbm
- status

```

---

# 15. Data Flow

Contoh shipment tracking:

```text
Carrier / TMS
      │
      │ API / EDI / File
      ▼
Integration Layer
      │
      ▼
Data Validation
      │
      ▼
Shipment Database
      │
      ▼
Tracking Engine
      │
      ▼
Customer Portal

```

Contoh:

```text
Carrier says:

VESSEL DEPARTED
18 Sep 2026
Tanjung Priok

            ↓

System maps event

DEP → Vessel Departed

            ↓

Shipment status updated

"In Transit"

            ↓

Customer receives:

🚢 Vessel Departed
18 Sep 2026
Jakarta

```

---

# 16. API Integration

Ini harus dibahas sejak awal karena akan menentukan budget.

### Integration source

Ada kemungkinan:

**A. Internal TMS API**

```text
TMS → API → Portal

```

Ideal.

**B. Database integration**

```text
TMS DB → Integration → Portal

```

Masih memungkinkan, tetapi perlu security dan governance.

**C. EDI**

```text
Carrier → EDI → Integration Layer

```

**D. Carrier API**

```text
Shipping Line API
Airline API
       ↓
Integration Layer
       ↓
Portal

```

**E. Manual upload**

Untuk carrier yang belum mempunyai API:

```text
Excel / CSV
     ↓
Admin Upload
     ↓
Validation
     ↓
Database

```

Untuk MVP, saya justru menyarankan **jangan memaksakan semua carrier harus API**.

Gunakan hybrid:

> API + EDI + CSV/Excel + Manual update.

---

# 17. Notification Engine

Ini sangat berguna.

Customer mendapatkan notification ketika:

- Booking confirmed
- Shipment departed
- ETA changed
- Vessel delayed
- Cargo arrived
- Customs released
- Delivery completed
- LCL capacity hampir penuh

Channel:

- Email
- WhatsApp
- Portal notification

Contoh:

> **Shipment Update**
> HBL: ABC12345
> Vessel departed Jakarta on 18 Sep.
> Revised ETA Singapore: 22 Sep.

---

# 18. Dashboard Wireframe

### Customer Dashboard

```text
┌─────────────────────────────────────────────────┐
│ LOGO                     Hi, ABC COMPANY       │
├─────────────────────────────────────────────────┤
│                                                 │
│  ACTIVE SHIPMENTS                               │
│                                                 │
│   12             8              4               │
│  TOTAL          SEA            AIR              │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  RECENT SHIPMENT                                │
│                                                 │
│  HBL: ABC-001                                   │
│  Jakarta → Singapore                            │
│                                                 │
│  Booking ─── Departed ───► Arrived ─── Delivery│
│              ●                                  │
│                                                 │
│  Vessel: MV XXXXX                               │
│  ETD: 18 Sep                                    │
│  ETA: 22 Sep                                    │
│                                                 │
│                 [ VIEW TRACKING ]               │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  AVAILABLE LCL CAPACITY                         │
│                                                 │
│  JKT → SIN       18 Sep       8 CBM             │
│  JKT → SIN       22 Sep      14 CBM             │
│  JKT → BKK       20 Sep       6 CBM             │
│                                                 │
│                  [ BOOK SPACE ]                 │
└─────────────────────────────────────────────────┘

```

---

# 19. Internal Operations Dashboard

Customer portal harus mempunyai pasangan **Operations/Admin Portal**.

```text
┌──────────────────────────────────────────────┐
│ OPERATIONS DASHBOARD                         │
├──────────────────────────────────────────────┤
│                                              │
│  Shipments     Bookings      Alerts          │
│     248           34           12             │
│                                              │
├──────────────────────────────────────────────┤
│ LCL CAPACITY                                 │
│                                              │
│ JKT-SIN   20 CBM   ███████████░  80%         │
│ JKT-BKK   20 CBM   ███████░░░░░  60%         │
│ JKT-KUL   15 CBM   █████████████ 90%         │
│                                              │
├──────────────────────────────────────────────┤
│ EXCEPTIONS                                   │
│                                              │
│ ⚠ 5 shipments delayed                       │
│ ⚠ 3 ETA changed                              │
│ ⚠ 4 bookings awaiting approval               │
└──────────────────────────────────────────────┘

```

---

# 20. MVP Roadmap

Saya sarankan **jangan langsung membuat seluruh digital freight forwarding ecosystem**.

### Phase 0 — Discovery

**2–4 minggu**

Deliverables:

- Business process mapping
- Customer journey
- System audit
- Data source mapping
- API assessment
- BRD
- UX/UI prototype
- Technical architecture
- Development estimation

---

### Phase 1 — MVP

**± 10–16 minggu**

Fokus:

- Customer login
- Customer management
- Shipment tracking
- Sea tracking
- Air tracking
- Vessel schedule
- Air schedule
- LCL available capacity
- Basic notification
- Admin portal
- Basic reporting

**Belum perlu:**

- Online payment
- Complex quotation engine
- Automated pricing
- Full documentation workflow
- AI
- Mobile native application

---

### Phase 2 — Self Service

**± 8–12 minggu**

Tambah:

- Online booking
- Booking approval
- Request quotation
- Document upload
- Document download
- Email/WhatsApp notification
- Booking history
- Customer user management

---

### Phase 3 — Digital Freight Platform

**± 12–24 minggu**

Tambah:

- Dynamic quotation
- Rate management
- Automated booking
- Capacity optimization
- Warehouse integration
- ERP integration
- Billing
- Payment
- Analytics
- Customer KPI
- SLA monitoring
