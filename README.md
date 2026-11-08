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

## Vận chuyển lô sau thu hoạch

Chạy lần lượt các file `202610190001_harvest_lot_transport.sql`,
`202610190002_transporter_workflow.sql`,
`202610190003_transport_blockchain_events.sql` và
`202610260001_transport_recipient_confirmation.sql` trong Supabase SQL Editor
trước khi khởi động backend mới. Migration thứ ba thêm lịch sử sự kiện
append-only và hàng đợi gửi blockchain có tự thử lại; migration cuối gắn chuyến
với nhà phân phối nhận hàng.

Các mốc được ghi theo thứ tự: tạo yêu cầu, nhận chuyến, khởi hành, các cập nhật
hành trình tại điểm lấy/trung chuyển/giao hàng, kiểm tra nhiệt độ/vị trí, người
vận chuyển báo giao, nhà phân phối nhận lô xác nhận đã nhận hàng, hoặc hủy
chuyến. Chuyến chỉ chuyển sang `DELIVERED` sau khi đúng nhà phân phối nhận hàng
xác nhận. Chạy tiếp `202610260002_transport_tracking_updates.sql` để bật các cập
nhật hành trình chi tiết do người vận chuyển ghi, rồi chạy
`202610260003_transport_tracking_temperature.sql` để lưu nhiệt độ cùng trạng
thái, địa điểm và ghi chú trong một mốc duy nhất. Chạy thêm
`202610260004_transport_delivery_report_simplified.sql` để bỏ các trường tên
người nhận/mã biên nhận khỏi bước báo giao; nhà phân phối được chọn vẫn là bên
xác nhận đã nhận hàng. Cuối cùng chạy
`202610260005_transport_success_in_tracking.sql` để gộp trạng thái giao thành
công vào form hành trình và bỏ nút/API báo giao riêng; nhà phân phối vẫn phải
xác nhận trước khi chuyến được đóng.
Mỗi mốc có mã sự kiện riêng, hash dữ liệu và liên kết hash mốc trước; nội dung
chi tiết lưu ở Supabase, blockchain chỉ lưu hash. Các chuyến cũ không được tạo
thêm lịch sử giả; timeline áp dụng cho mốc phát sinh sau migration.

Trạng thái `SUCCESS` nghĩa backend đã đọc lại hash từ contract hoặc nhận receipt
giao dịch. `PENDING`/`FAILED` sẽ được worker thử lại. Để ghi lên chain thật, phải
cấu hình đủ `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CONTRACT_ADDRESS` và
`BLOCKCHAIN_PRIVATE_KEY` trong `backend/.env`; nếu thiếu, dữ liệu vẫn nằm trong
database và chưa có bằng chứng on-chain.

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

## QR truy xuất công khai theo lô thu hoạch

Áp dụng **thủ công** migration `supabase/migrations/202611070001_lot_trace_codes.sql`
sau các migration hiện có. Migration bổ sung bảng `lot_trace_codes`, không thay đổi
bảng QR theo vụ cũ và không tự công khai lô cũ. Không chạy migration nếu chưa xác nhận
đúng môi trường và có phê duyệt cho database đó.

Trong **Thu hoạch / Lô**, chủ cơ sở chọn **Phát hành QR công khai** cho từng lô.
Sau khi phát hành có thể mở hồ sơ hoặc tải SVG để in. Một vụ thu nhiều đợt có nhiều
QR; phát hành lặp lại cho cùng lô giữ nguyên mã. Các gói thuộc cùng lô có thể dùng
chung mã. Thu hồi yêu cầu lý do 3–500 ký tự, có hiệu lực với lần đọc tiếp theo và
không thể phát hành lại; mã vẫn dẫn đến thông báo thu hồi, không xóa lịch sử.
Hồ sơ đã được tải/chụp trước đó không thể thu hồi khỏi thiết bị người xem.

QR chứa URL frontend `/trace/:traceCode`, không phải URL API. URL được tạo từ
origin/base path đang mở: trước khi in phải mở ứng dụng qua địa chỉ HTTPS công khai
ổn định. `localhost` không dùng được từ điện thoại khác. Hosting cần chuyển các
đường dẫn `/trace/*` về `index.html` để mở trực tiếp; không đổi tên miền sau khi in
nếu chưa duy trì chuyển hướng. Cấu hình API và CORS hiện có phải phù hợp deployment.
Tính năng này không tự deploy hay thay đổi hosting/network.

API chủ cơ sở (đăng nhập, kiểm tra toàn bộ cơ sở/ao/vụ/lô):

- `GET/POST /api/farms/:farmId/ponds/:pondId/batches/:id/lots/:lotId/qr`
- `POST` cùng đường dẫn thêm `/revoke`, body `{ "reason": "Lý do thu hồi" }`.

Khách dùng `GET /api/public/trace/:traceCode`, không đăng nhập. API chọn trường
công khai từ snapshot nguồn gốc lô, nhật ký hiện còn xác nhận đến hết ngày
thu hoạch theo giờ Việt Nam và chuyến gắn đúng lô. Không trả toàn bộ snapshot, bản nháp, người thao
tác, liên hệ cá nhân, tài xế, vị trí giao chi tiết hoặc ghi chú tự do. Đây là nhật
ký liên quan của vụ, không phải snapshot nhật ký bất biến tại ngày phát hành QR;
đính chính/thu hồi nhật ký có thể làm nội dung công khai thay đổi.

Trang QR ưu tiên nguồn gốc, thức ăn và thuốc/hóa chất đã ghi nhận. Bản tổng hợp
gom tên sản phẩm sau khi chuẩn hóa Unicode, khoảng trắng và chữ hoa/thường;
hiển thị số lần ghi nhận và ngày đầu/cuối, không suy diễn sử dụng liên tục hoặc
cộng liều lượng khác đơn vị. Nhật ký thiếu tên sản phẩm được đếm riêng.
Không có ghi nhận thuốc không có nghĩa là không sử dụng thuốc, và nhật ký không
thay thế kết quả kiểm nghiệm. Phần nhật ký chi tiết thu gọn mặc định, lọc theo
loại, nội dung và khoảng ngày Việt Nam; mỗi trang 20 bản ghi.
Việc tổng hợp/lọc/phân trang thực hiện trên trình duyệt từ dữ liệu công khai
API đã chọn lọc; giới hạn 500 nhật ký của API bên dưới vẫn áp dụng.

Đối soát Blockchain trực tiếp chỉ áp dụng snapshot thu hoạch, phân biệt khớp/lệch,
chờ ghi và không thể kiểm tra. Nhật ký/vận chuyển hiển thị trạng thái ghi nhận lưu
trong database, không giả định đã đối soát lại. Không gửi giao dịch khi quét QR.
Đóng gói/kiểm định/bán lẻ chưa được triển khai nên không suy diễn các bước này.
QR có thể sao chép, không phải tem chống giả riêng từng gói.

Giới hạn hiện tại: tối đa 500 nhật ký, 100 chuyến và 500 sự kiện vận chuyển mỗi
hồ sơ; vượt giới hạn trả lỗi tạm thời thay vì âm thầm hiển thị thiếu. Giới hạn
120 lượt/phút và 4 lượt đồng thời trên mỗi process; triển khai nhiều replica cần
bổ sung giới hạn tại gateway. Không cache hồ sơ công khai, luôn kiểm tra trạng thái
thu hồi; không xem lỗi chain là hồ sơ đã xác thực.

Kiểm thử không cần database hoặc `.env`:

```bash
cd backend
npm test
cd ../frontend
npm test
npm run type-check
npm run build-only
```

Nếu `dist` hiện có thuộc user khác, có thể kiểm tra build vào thư mục scratch bằng
`npm run build-only -- --outDir /tmp/seafood-qr-build`; không tự thay quyền hệ thống.
