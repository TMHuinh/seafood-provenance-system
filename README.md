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

### Khôi phục mật khẩu

Tính năng **Quên mật khẩu** áp dụng cho mọi tài khoản/role. Đặt `FRONTEND_URL`
đúng với địa chỉ frontend đang triển khai, sau đó thêm URL
`<FRONTEND_URL>/reset-password` vào danh sách **Redirect URLs** tại Supabase
Dashboard → Authentication → URL Configuration. Supabase cũng cần bật gửi email
khôi phục mật khẩu và cấu hình SMTP/email phù hợp. Người dùng yêu cầu email tại
`/forgot-password`; hệ thống kiểm tra hồ sơ và báo nếu email chưa đăng ký. Nếu đã
có tài khoản, người dùng mở liên kết trong email để đặt mật khẩu mới.

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
`BLOCKCHAIN_PRIVATE_KEY`. Thiếu một trong ba thì bằng chứng ở trạng thái chờ;
nghiệp vụ đã lưu được giữ lại và worker tự thử gửi, không giả lập thành công.

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
trong `backend/.env`. Tạo lại container backend để Docker nạp lại `env_file`:

```bash
docker compose up -d --force-recreate --no-deps backend
```

### 3. Cấp quyền ghi và hàng đợi thử lại

Contract mới chỉ cho các ví trong `writers` gọi `recordData`; ví deploy ban đầu
là owner và writer. Owner cấp/thu hồi writer, chuyển owner qua hai bước
`transferOwnership` / `acceptOwnership`. Chuyển owner không tự đổi danh sách writer.
Đọc hash vẫn công khai, mỗi event chỉ ghi được một lần.

Chạy trong `backend/`, ở môi trường quản trị có khóa owner:

```bash
node scripts/manage-writer.js <backend-wallet-address> grant
node scripts/manage-writer.js <backend-wallet-address> revoke
```

Script dùng `BLOCKCHAIN_OWNER_PRIVATE_KEY` nếu được cung cấp riêng cho tiến trình,
hoặc `BLOCKCHAIN_PRIVATE_KEY` khi ví cấu hình cũng là owner. Script kiểm tra owner
và không sửa `.env`. Backend thường trực chỉ cần khóa writer; không đưa khóa thật
vào Git hoặc câu lệnh lưu trong lịch sử terminal.

Áp dụng migration `202611230001_blockchain_outbox.sql` sau `202611090001` trước
khi chạy backend mới. Snapshot vụ, thu hoạch và xác nhận/đính chính/thu hồi nhật ký
được lưu cùng công việc gửi chain trong một transaction. Bản nháp không đưa lên
chain. Xác nhận nghiệp vụ có thể thành công khi chain đang lỗi; giao diện phân
biệt trạng thái xác nhận và bằng chứng trên chain. Thu hồi nhật ký có hiệu lực
ngay với hồ sơ công khai, bằng chứng thu hồi được gửi tiếp khi chain hoạt động.
Chạy tiếp `202611230002_business_conflicts.sql` để xung đột nghiệp vụ trả 409
mà không kích hoạt PostgREST tự thử lại transaction.
Khi dùng luồng nhận hàng/phát hành lại QR mới trên `main`, cần có migration
`202611220001_transport_receipts.sql`, `202611240001_lot_trace_reissue.sql` và
`202611240002_qr_business_conflict.sql`. Migration cuối giữ cách trả lỗi 409
cho RPC QR được tạo lại; không cần chạy lại các migration đã áp dụng.
Chạy tiếp `202611240003_blockchain_records_access.sql` để bảng chứa giao dịch
đã ký chỉ được truy cập qua backend. API tiếp tục trả hash và mã giao dịch để đối soát.
Sau khi triển khai backend có hỗ trợ `batch_version_v1`, chạy
`202611240004_enqueue_batch_snapshot.sql`. Database lưu snapshot vụ cùng công
việc trong transaction. Worker backend định dạng payload trước khi băm và gửi.

Worker kiểm tra mỗi 15 giây, thử lại sau 2 phút rồi tăng dần tới tối đa 1 giờ.
Lease database ngăn hai worker xử lý cùng việc và tuần tự hóa ví ký giữa hàng
đợi chung và vận chuyển. Sau lỗi/khởi động lại, worker dùng payload đã lưu,
đối soát event/hash trước khi gửi. Giao dịch đã ký và hash được lưu trước khi
broadcast; khôi phục chỉ phát lại đúng giao dịch đó khi chưa rõ kết quả, giữ
nguyên nonce/hash. `SUCCESS` không bị kết quả lỗi
đến muộn ghi đè. Chain ID và contract được giữ theo từng bằng chứng; worker
không tự chuyển bằng chứng cũ sang contract/network mới.

Contract cũ không có phân quyền không thể cập nhật tại chỗ: cần triển khai
contract mới và cấp writer trước khi chuyển cấu hình ghi. Giữ chain/contract cũ
để đọc bằng chứng đã có; xử lý riêng việc còn chờ gắn contract cũ. Migration chỉ
khôi phục hàng đợi từ snapshot thu hoạch còn thiếu proof, không dựng lại payload
vụ/nhật ký cũ. Nếu có event trùng trong `blockchain_records`, migration dừng để
đối soát thủ công, không tự xóa bằng chứng.

### 4. Kiểm tra kết nối

- Tạo rồi xác nhận một nhật ký từ giao diện → dòng log backend phải **không còn** cảnh báo
  `Thiếu cấu hình Blockchain`, và bản ghi phải có `tx_hash` + trạng thái `SUCCESS`.
- Đối soát trực tiếp trên chain bằng id nhật ký:

```bash
docker compose exec backend node scripts/check-record.js <id-nhat-ky>
```

Lưu ý: Hardhat lưu trạng thái trong bộ nhớ; dừng/khởi động lại node có thể mất
toàn bộ bằng chứng. Chỉ dùng cho phát triển. Deploy lại không khôi phục các hash
cũ và không làm bằng chứng cũ trở lại hợp lệ. Môi trường cần lưu bằng chứng lâu
dài phải dùng chain có lưu trữ bền vững.

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

Nhà phân phối đúng tổ chức nhận xác nhận nhận chuyến, nhập hồ sơ đóng gói và kiểm định,
rồi phát hành QR trong trang **Nhận hàng**. Hồ sơ xác nhận một lần theo chuyến, giới hạn
khối lượng đóng gói theo khối lượng thực nhận, và được đưa vào hàng đợi Blockchain.
Chủ cơ sở có thể xem QR từ **Thu hoạch / Lô**. Nhà phân phối dùng **Nhận hàng**
để lấy đúng mã in bao bì. Một lô có thể giao nhiều chuyến. Mỗi chuyến có tối đa
một QR hoạt động và các gói từ cùng hồ sơ đóng gói của chuyến dùng chung mã đó. Thu hồi yêu cầu
lý do 3–500 ký tự và có hiệu lực với lần đọc tiếp theo. Tổ chức đã phát hành có
thể tạo mã thay thế sau khi thu hồi. Mã cũ vẫn dẫn đến thông báo thu hồi.
Hồ sơ đã được tải/chụp trước đó không thể thu hồi khỏi thiết bị người xem.

QR chứa URL frontend `/trace/:traceCode`, không phải URL API. URL được tạo từ
origin/base path đang mở: trước khi in phải mở ứng dụng qua địa chỉ HTTPS công khai
ổn định. `localhost` không dùng được từ điện thoại khác. Hosting cần chuyển các
đường dẫn `/trace/*` về `index.html` để mở trực tiếp; không đổi tên miền sau khi in
nếu chưa duy trì chuyển hướng. Cấu hình API và CORS hiện có phải phù hợp deployment.
Tính năng này không tự deploy hay thay đổi hosting/network.

API chủ cơ sở (đăng nhập, kiểm tra toàn bộ cơ sở/ao/vụ/lô):

- `GET /api/farms/:farmId/ponds/:pondId/batches/:id/lots/:lotId/qr`.
- `POST` cùng đường dẫn thêm `/revoke` chỉ cho QR cũ chưa có tổ chức phát hành.
- Nhà phân phối dùng `GET/POST /api/transports/:transportId/qr` để xem/phát hành.
  `POST` thêm `/revoke` nhận `traceCode` và `reason`. `POST` thêm `/reissue`
  nhận `traceCode` của mã đã thu hồi để tạo mã thay thế.

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

Trang QR đối soát trực tiếp hồ sơ thu hoạch và hồ sơ đóng gói, kiểm định của
chuyến phát hành. Kết quả phân biệt khớp, sai lệch, chờ ghi và chưa thể kiểm tra.
Nhật ký và vận chuyển hiển thị trạng thái ghi nhận lưu trong database.
Quét QR chỉ đọc dữ liệu và kết quả kiểm tra.
QR theo chuyến hiển thị hành trình, khối lượng gửi, khối lượng thực nhận
và hồ sơ đóng gói, kiểm định của chuyến phát hành. Với chuyến cũ thiếu khối lượng
thực nhận, trang hiển thị tình trạng thiếu dữ liệu. Bộ phận nhận hàng
in QR lên bao bì để khách mua trực tiếp quét tại điểm bán. QR đã phát hành trước migration
vẫn đọc được. Phát hành thay thế áp dụng điều kiện đóng gói và kiểm định như QR mới.
QR có thể sao chép, không phải tem chống giả riêng từng gói.

Giới hạn hiện tại: tối đa 500 nhật ký, 100 chuyến và 500 sự kiện vận chuyển mỗi
hồ sơ; vượt giới hạn trả lỗi tạm thời thay vì âm thầm hiển thị thiếu. Giới hạn
120 lượt/phút và 4 lượt đồng thời trên mỗi process; triển khai nhiều replica cần
bổ sung giới hạn tại gateway. Không cache hồ sơ công khai, luôn kiểm tra trạng thái
thu hồi; không xem lỗi chain là hồ sơ đã xác thực.

Kiểm thử tự động không cần database hoặc `.env` (contract chạy trên EVM nội bộ;
lần đầu compile cần tải Solidity compiler):

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

## Tìm lô, thống kê sản lượng và báo cáo truy xuất

Menu **Tra cứu và báo cáo** dành cho chủ cơ sở và quản trị viên:

- **Tìm kiếm lô hàng** (`/lo-hang`): tìm mã lô, mã vụ, tên cơ sở/ao, mã ao
  hoặc nguồn giống; lọc cơ sở, ao, tôm/cua, ngày thu hoạch và trạng thái lô.
  Kết quả phân trang trên server, có liên kết báo cáo và QR đã phát hành.
- **Thống kê sản lượng** (`/thong-ke/san-luong`): cộng kg từ từng lần thu hoạch,
  bao gồm các đợt thu một phần và lần thu cũ chưa có lô. Có bộ lọc cơ sở/ao,
  loài và khoảng ngày; tổng hợp theo tháng, loài, cơ sở, ao; tải CSV UTF-8
  để mở bằng Excel. Ngày và tháng tính theo giờ Việt Nam. Loài/tên nguồn gốc
  lấy từ snapshot lô; lần thu cũ chưa có lô dùng thông tin vụ hiện tại.
- **Báo cáo kết quả truy xuất** (`/lo-hang/:lotId/bao-cao`): mở từ danh sách
  lô hoặc màn hình thu hoạch, gồm nguồn gốc, nhật ký đã xác nhận còn hiệu lực,
  thu hoạch, vận chuyển, lịch sử phiên bản vụ và kết quả đối soát snapshot
  thu hoạch với Blockchain. Chọn **In / Lưu PDF**, rồi chọn máy in hoặc
  **Lưu dưới dạng PDF** của trình duyệt để xuất bản A4.

Chủ cơ sở chỉ xem dữ liệu của mình; quản trị viên xem toàn hệ thống.
Người tiêu dùng mở báo cáo tại `/trace/:traceCode/report` từ trang QR,
không cần đăng nhập. Báo cáo công khai dùng cùng bộ lọc trường dữ liệu và
kiểm tra thu hồi QR với trang truy xuất; không chứa lịch sử quản lý nội bộ.
Báo cáo quản lý dùng được cả khi lô chưa có QR hoặc QR đã thu hồi.

API mới: `GET /api/lots`, `/api/lots/options`, `/api/lots/production`,
`/api/lots/:id/report` (đăng nhập); `/api/public/trace/:traceCode/report`
(công khai). Bộ lọc dùng `farmId`, `pondId`, `species`, `from`, `to`;
danh sách nhận thêm `search`, `status`, `page`, `pageSize` (tối đa 100).

Các tính năng này chỉ đọc schema hiện có, không cần migration mới. Cần đã áp
dụng các migration lô, phiên bản vụ, vận chuyển và QR của dự án. Thống kê đọc
đủ các trang dữ liệu, tối đa 20.000 lần thu hoạch trong phạm vi; vượt ngưỡng
trả lỗi yêu cầu thu hẹp bộ lọc. Báo cáo giữ các giới hạn kích thước hồ sơ
truy xuất hiện có và tối đa 2.000 phiên bản vụ. Báo cáo công khai đối soát
hồ sơ thu hoạch và đóng gói, kiểm định như trang QR. Báo cáo quản lý đối soát
hồ sơ thu hoạch và hiển thị trạng thái ghi nhận của các hồ sơ đóng gói.
Nhật ký và vận chuyển hiển thị trạng thái ghi nhận.
PDF/CSV là bản tại thời điểm lập, không được lưu như một báo cáo bất biến
trên server; dữ liệu đã tải xuống không cập nhật khi QR hoặc nhật ký bị thu hồi.

## Cảnh báo nhật ký nuôi

Màn hình nhật ký của vụ hiển thị các mục có dữ liệu cần sửa và cảnh báo sau
3 ngày theo lịch Việt Nam chưa có nhật ký hợp lệ đã xác nhận. Quy tắc 3 ngày
áp dụng cho vụ đang nuôi hoặc sẵn sàng thu hoạch, tính từ ngày thả hoặc nhật
ký hợp lệ đã xác nhận gần nhất. API kiểm tra dữ liệu khi xác nhận và đính chính.

## Kiểm thử toàn luồng với môi trường riêng

Cần Node.js phù hợp `frontend/package.json`, Docker và dependency đã cài ở cả
`backend/`, `frontend/`. Trong `backend/`:

```bash
npx playwright install chromium
npm run test:system
```

Windows có Edge có thể bỏ bước tải Chromium và đặt
`$env:E2E_BROWSER_CHANNEL='msedge'` trước khi chạy. Test sử dụng các cổng loopback
6540–6547, project Compose `seafood-isolated-tests`, PostgreSQL/Auth/PostgREST
thật, contract trên Hardhat và trình duyệt thật. Database test được tạo mới,
chạy chuỗi migration UP và xóa cùng volume khi kết thúc. Không chạy đồng thời
hai phiên test trên các cổng này. Không dùng project test này để chứa dữ liệu cần giữ.

Luồng kiểm tra: đăng ký/đăng nhập theo vai trò → cơ sở/ao/vụ → nhật ký → thu
hoạch một phần/kết thúc → vận chuyển/bên nhận → phát hành QR → truy xuất/báo cáo
→ tìm lô/thống kê/PDF trên trình duyệt → thu hồi QR. Có kiểm tra ví chưa có quyền,
RPC lỗi/khôi phục, worker chạy lại, yêu cầu trùng/xung đột và lease database.
Ảnh bằng chứng giao hàng dùng URL fixture hợp lệ; test này không upload lên
Cloudinary, không xác nhận tích hợp upload với dịch vụ bên ngoài.
