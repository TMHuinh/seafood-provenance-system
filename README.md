# Hệ thống truy xuất nguồn gốc thủy sản

Dự án gồm frontend Vue.js, backend Node.js, Supabase Cloud và blockchain.

## Cấu trúc dự án

```text
seafood-provenance-system/
├── frontend/       # Vue 3 + TypeScript
├── backend/        # Node.js + Express
├── supabase/       # Cấu hình CLI và migration database
├── blockchain/     # Smart contract
└── README.md
```

## Yêu cầu

- Docker Engine và Docker Compose.
- Một project Supabase Cloud đã được tạo và áp dụng schema.
- Node.js phù hợp với trường `engines` nếu chạy ứng dụng ngoài Docker.

## Cấu hình backend

```bash
cp backend/.env.example backend/.env
```

Điền các giá trị lấy từ Supabase Dashboard:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SECRET_KEY
SUPABASE_ANON_KEY=sb_publishable_YOUR_PUBLISHABLE_KEY
```

`SUPABASE_SECRET_KEY` chỉ được dùng ở backend. Không đưa secret key vào
frontend hoặc commit file `.env` lên Git.

## Cấu hình frontend

```bash
cp frontend/.env.example frontend/.env.local
```

Frontend chỉ gọi backend:

```env
VITE_API_URL=http://localhost:3000
```

## Database và migration

Schema được lưu trong `supabase/migrations/` và triển khai lên Supabase Cloud.
Xem [`supabase/README.md`](supabase/README.md) trước khi chạy migration.

## Chạy backend

```bash
cd backend
docker compose up -d --build
curl http://localhost:3000/api/health
```

Kết quả mong đợi:

```json
{
  "success": true,
  "services": {
    "api": "healthy",
    "database": "healthy"
  }
}
```

## Chạy frontend

```bash
cd frontend
docker compose up -d --build
```

Truy cập `http://localhost:5173`.

## Thu hoạch nhiều đợt và lô hàng

Áp dụng `supabase/migrations/202610050001_harvest_lots.sql` sau migration
phiên bản vụ nuôi. Trong trang quản lý vụ, chọn **Thu hoạch / Lô** để ghi
ngày thu, khối lượng (kg), ghi chú và chọn thu một phần hoặc kết thúc thu hoạch.
Vụ phải ở trạng thái đang nuôi hoặc sẵn sàng thu hoạch. Mỗi lần thu tạo một
lô riêng, lưu snapshot nguồn gốc cơ sở, ao, vụ và giống tại thời điểm thu.
Các lần thu cũ vẫn được giữ; migration không tự tạo lô hoặc bằng chứng cho chúng.

Thu hoạch, lô hàng, tổng sản lượng và lịch sử vụ được lưu trong cùng transaction.
Ngày thu theo múi giờ Việt Nam, không trước ngày thả hoặc sau ngày hiện tại.
Đợt cuối phải có ngày không trước các đợt đã ghi. Tổng sản lượng được cộng từ
các lần thu; ngày thu thực tế của vụ là ngày kết thúc. Không thể sửa đè sản
lượng trong form đính chính hoặc mở lại vụ đã kết thúc thu hoạch.

API `GET/POST /api/farms/:farmId/ponds/:pondId/batches/:id/harvests` chỉ dành
cho chủ cơ sở. POST nhận `requestId` (UUID), `harvestDate` (YYYY-MM-DD),
`quantity`, `isFinal` và `note`. Gửi lại cùng mã và dữ liệu trả về lô đã tạo,
không gửi lại giao dịch blockchain. Thay đổi dữ liệu với cùng mã trả lỗi 409.
Mỗi lô có sự kiện `HARVEST_RECORDED:<harvestId>`; payload hash là snapshot
`provenance` đã lưu. Blockchain lỗi vẫn giữ thu hoạch và lô, trả trạng thái
riêng. Danh sách hiển thị kết quả giao dịch đã lưu, chưa đối soát trực tiếp
trên chain; chưa có tự động thử lại, chia/gộp lô hoặc QR.

## Ghi dữ liệu vụ nuôi lên blockchain

Smart contract nằm trong `backend/contracts/` (Hardhat project). Code backend dùng
`ethers` để ghi hash dữ liệu lên chain. Backend chỉ kết nối khi **đủ cả 3 biến**
trong `backend/.env`: `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CONTRACT_ADDRESS`,
`BLOCKCHAIN_PRIVATE_KEY`. Thiếu một trong ba sẽ chạy **Mock data** (không ghi chain).

### 1. Khởi động node (node chạy trong Docker, service `chain`)

```bash
cd backend
docker compose up -d chain
```

Node là Hardhat (địa chỉ mặc định `http://chain:8545` trong mạng nội bộ compose),
tài khoản dev (dư ETH) sẵn có — khớp với `BLOCKCHAIN_PRIVATE_KEY` trong `.env`.
`backend/.env` cần có `BLOCKCHAIN_RPC_URL=http://chain:8545`.

Muốn truy cập node từ máy host để debug: tắt node Hardhat thủ công (nếu có) rồi mở
comment `ports` cho service `chain` trong `compose.yml`.

### 2. Biên dịch và deploy contract

```bash
# Vẫn trong backend/
docker compose exec backend npx hardhat compile
docker compose exec backend node scripts/deploy.js
```

Script `deploy.js` tự ghi địa chỉ contract vào `BLOCKCHAIN_CONTRACT_ADDRESS`
trong `backend/.env`, sau đó yêu cầu:

```bash
docker compose restart backend
```

### 3. Kiểm tra kết nối

- Ghi một nhật ký nuôi từ giao diện → dòng log backend phải **không còn** cảnh báo
  `Thiếu cấu hình Blockchain`, và bản ghi phải có `tx_hash` + trạng thái `SUCCESS`.
- Đối soát trực tiếp trên chain bằng id nhật ký:

```bash
docker compose exec backend node scripts/check-record.js <id-nhat-ky>
```

Lưu ý: node Hardhat lưu trạng thái trong bộ nhớ, éphemeral. Mỗi lần
`docker compose down` / xóa container `chain` thì phải deploy lại contract
(`scripts/deploy.js`) rồi restart backend.

## Quản lý dependency

Khi container đang chạy:

```bash
cd backend
docker compose exec backend npm install ten-thu-vien

cd ../frontend
docker compose exec frontend npm install ten-thu-vien
```

Commit cả `package.json` và `package-lock.json` sau khi thay đổi dependency.
Không commit `.env`, secret key, private key hoặc `node_modules/`.
