# Giải Thích Code Change - Thay Đổi Trên Máy Local

## Tổng Quan

Có **2 feature lớn** đang được phát triển:

1. **Tích hợp Blockchain thật** (thay cho mock data) - Smart Contract Solidity + Ethers.js
2. **Module "Nhật ký nuôi" (Farming Logs)** - CRUD + xác minh đồng bộ blockchain

---

## 1. Smart Contract (`SeafoodProvenance.sol`)

**Vị trí:** `backend/contracts/SeafoodProvenance.sol`

Hợp đồng Solidity lưu hash dữ liệu (bất biến) trên chuỗi:

- **`recordData(id, dataHash)`** - Ghi hoặc cập nhật hash của một thực thể (batch, nhật ký nuôi, ...). Đồng thời lưu thêm `recordedBy` (người ghi), `timestamp`, `blockNumber`, `writeCount` (số lần ghi).
- **`getRecord(id)`** - Trả về toàn bộ bản ghi từ chuỗi (dùng để đối soát).
- **`getDataHash(id)`** - Chỉ trả về hash.

---

## 2. Hardhat & Hạ Tầng

| File | Chức Năng |
|------|----------|
| `hardhat.config.js` | Cấu hình Hardhat: Solidity 0.8.28, optimizer, network localhost:8545 |
| `scripts/deploy.js` | Sau khi compile, chạy script này để deploy contract. **Tự ghi** `BLOCKCHAIN_CONTRACT_ADDRESS` vào `.env` |
| `scripts/check-record.js` | Công cụ CLI để đối soát: `node scripts/check-record.js <id>` - gọi `getRecord()` trên chain và in kết quả |

Trong `compose.yml`, thêm service **`chain`** chạy `npx hardhat node` trong Docker. Backend `depends_on` (phụ thuộc) service chain.

---

## 3. Thay Đổi Blockchain Service (`blockchain.service.js`)

Đây là **phần lõi của việc tích hợp blockchain thật**:

- **Trước:** `submitToContract()` chỉ là stub (hàm giả), trả về toàn bộ giá trị `null`.
- **Sau:** Dùng `ethers.js` kết nối qua RPC + Wallet, gọi `contract.recordData(batchId, dataHash)`, **chờ mạng lưới xác nhận** (`tx.wait()`), trả về `transactionHash`, `blockNumber`, `status: 'SUCCESS'`.

Logic mới:
- `isContractConfigured()` giờ yêu cầu **đủ cả 3 biến**: `RPC_URL` + `CONTRACT_ADDRESS` + `PRIVATE_KEY`. Thiếu bất kỳ biến nào -> chạy mock data.
- `createRecord()` giờ dựa vào `chain.status` để quyết định trạng thái cuối (`SUCCESS`/`PENDING`/`FAILED`), thay vì luôn là `PENDING`.

---

## 4. Module Nhật Ký Nuôi (Backend - 5 files)

| File | Vai Trò |
|------|------|
| `farming-logs.validation.js` | Validate dữ liệu đầu vào: batchId là UUID, logType nằm trong danh sách cho phép, logDate hợp lệ, details phải là object |
| `farming-logs.repository.js` | CRUD bảng Supabase `farming_logs`: create (tạo), updateHashes (cập nhật hash), findAllByBatch (lấy theo batch) |
| `farming-logs.service.js` | **Logic chính**: tạo log -> gọi `blockchainService.createRecord()` để băm lên chain -> cập nhật `data_hash` + `tx_hash` về DB. Có hàm `verify()` để đối soát hash local với chain. |
| `farming-logs.controller.js` | Handler Express: POST `/`, GET `/batch/:batchId`, GET `/batch/:batchId/verify` |
| `farming-logs.routes.js` | Định nghĩa route, yêu cầu `requireAuth` (phải đăng nhập) |

### Luồng tạo nhật ký (`POST /api/farming-logs`):
1. Validate dữ liệu -> Kiểm tra quyền sở hữu batch
2. INSERT vào Supabase `farming_logs` (lấy được ID)
3. Gọi `blockchainService.createRecord()` -> ghi hash lên chain
4. UPDATE `data_hash` + `tx_hash` vào bản ghi farming_log

### Luồng đối soát (`GET /api/farming-logs/batch/:batchId/verify`):
1. Lấy tất cả logs + tất cả blockchain records theo batchId
2. Re-hash payload hiện tại -> so sánh với `data_hash` đã lưu
3. Kết luận: `SYNCED` (đồng bộ) / `DESYNCED` (lệch, kèm danh sách issues)

---

## 5. Frontend

### Types (`types/index.ts`)
Thêm các interface: `FarmingLog`, `FarmingLogInput`, `FarmingLogVerifyResponse`, `FARMING_LOG_TYPE_LABELS` (7 loại: FEEDING, MEDICINE, WATER_QUALITY, CARE, ENVIRONMENT, MORTALITY, OTHER).

### Store (`farming-logs.store.ts`)
Pinia store với 3 action: `load(batchId)` (tải danh sách), `create(input)` (tạo mới), `verify(batchId)` (kiểm tra đồng bộ).

### Router (`router/index.ts`)
Route mới: `/farms/:farmId/ponds/:pondId/batches/:batchId/logs` -> `FarmingLogsPage.vue`.

### PondBatchesPage.vue
Thêm nút **"Nhật ký nuôi"** trên mỗi card batch, bấm vào sẽ điều hướng tới trang farming-logs.

### FarmingLogsPage.vue (535 dòng)
Trang đầy đủ tính năng:
- **Danh sách nhật ký nuôi** dạng lưới (grid), mỗi card hiển thị loại nhật ký, ngày, chi tiết, hash blockchain, trạng thái đồng bộ
- **Form tạo nhật ký** (modal) - form động theo từng loại: FEEDING -> nhập loại thức ăn + kg, WATER_QUALITY -> pH/nhiệt độ/độ mặn, MEDICINE -> tên + liều lượng, MORTALITY -> số con chết + nguyên nhân...
- **Nút "Kiểm tra đồng bộ Blockchain"** -> gọi API verify -> hiển thị modal kết quả: tổng số, đồng bộ, lệch + chi tiết từng log kèm issues
- Hỗ trợ trạng thái **PENDING** (đang chờ blockchain xác nhận) với badge màu cam

---

## 6. Dependencies Mới

| Package | Version | Vai Trò |
|---------|---------|------|
| `ethers` | ^6.17.0 | Thư viện kết nối blockchain (provider, wallet, contract) |
| `hardhat` | ^2.22.17 | Dev dependency: compile, deploy, chạy local node |

---

## 7. Thay Đổi Cấu Hình

### `backend/.env.example`
- Thêm biến `BLOCKCHAIN_PRIVATE_KEY`
- Cập nhật ghi chú: cả 3 biến blockchain đều bắt buộc để kết nối thật, thiếu bất kỳ biến nào sẽ chạy mock data

### `backend/compose.yml`
- Thêm service `chain` (Hardhat node trong Docker)
- Backend giờ `depends_on` (phụ thuộc) service chain
- Thêm `BLOCKCHAIN_PRIVATE_KEY` vào env config

### `backend/src/config/env.js`
- Thêm export `blockchainPrivateKey`

### `backend/src/app.js`
- Đăng ký route mới: `/api/farming-logs`

---

## 8. Cập Nhật README.md

Thêm mục tài liệu "Kết nối Blockchain" bao gồm:
- Cách khởi động Hardhat node qua Docker
- Cách compile và deploy contract
- Cách kiểm tra kết nối (xem log có cảnh báo, dùng script check-record)
- Lưu ý: trạng thái Hardhat là éphemeral (lưu trong bộ nhớ), cần deploy lại sau khi `docker compose down`

---

## Sơ Đồ Luồng Dữ Liệu

```
Người dùng tạo nhật ký nuôi (Frontend)
  -> POST /api/farming-logs
    -> Validate -> Kiểm tra quyền sở hữu batch
    -> INSERT farming_logs (Supabase)
    -> hashData(payload) -> SHA-256
    -> submitToContract(batchId, hash)
      -> ethers.Wallet + JsonRpcProvider
      -> contract.recordData(batchId, hash)
      -> tx.wait() -> receipt (biên lai)
    -> UPDATE farming_logs (data_hash, tx_hash)
  -> Response: log kèm thông tin blockchain

Người dùng kiểm tra đồng bộ (Frontend)
  -> GET /api/farming-logs/batch/:batchId/verify
    -> Lấy tất cả logs + blockchain_records
    -> Re-hash payload từng log
    -> So sánh với data_hash đã lưu
    -> Trả về trạng thái SYNCED/DESYNCED theo từng log
```

---

## Tổng Kết Các File

### File đã sửa (11 file):
1. `README.md` - Thêm tài liệu kết nối blockchain
2. `backend/.env.example` - Thêm biến PRIVATE_KEY, cập nhật ghi chú
3. `backend/compose.yml` - Thêm service chain, depends_on
4. `backend/package.json` - Thêm dependencies ethers, hardhat
5. `backend/package-lock.json` - Cập nhật file lock
6. `backend/src/app.js` - Đăng ký routes farming-logs
7. `backend/src/config/env.js` - Thêm blockchainPrivateKey
8. `backend/src/modules/blockchain/blockchain.service.js` - Tích hợp ethers.js thật
9. `frontend/src/pages/batches/PondBatchesPage.vue` - Thêm nút nhật ký nuôi
10. `frontend/src/router/index.ts` - Thêm route farming-logs
11. `frontend/src/types/index.ts` - Thêm types và interfaces nhật ký nuôi

### File mới (11 file):
1. `backend/hardhat.config.js` - Cấu hình Hardhat
2. `backend/contracts/SeafoodProvenance.sol` - Smart contract Solidity
3. `backend/scripts/deploy.js` - Script deploy contract
4. `backend/scripts/check-record.js` - Script đối soát bản ghi trên chain
5. `backend/src/modules/farming-logs/farming-logs.validation.js` - Validate dữ liệu đầu vào
6. `backend/src/modules/farming-logs/farming-logs.repository.js` - CRUD Supabase
7. `backend/src/modules/farming-logs/farming-logs.service.js` - Logic business + blockchain
8. `backend/src/modules/farming-logs/farming-logs.controller.js` - Handler Express
9. `backend/src/modules/farming-logs/farming-logs.routes.js` - Định nghĩa route
10. `frontend/src/pages/batches/FarmingLogsPage.vue` - Trang UI nhật ký nuôi
11. `frontend/src/stores/farming-logs.store.ts` - Store Pinia
