# Supabase Cloud và migration

Thư mục này chỉ lưu cấu hình Supabase CLI và lịch sử schema của ứng dụng.
Dự án không còn chạy Supabase local bằng Docker Compose.

## Thành phần

```text
supabase/
├── config.toml
└── migrations/
    └── 08092006_001_initial_schema.sql
```

Không lưu database password, API key hoặc connection string thật trong thư mục
này hay trong Git.

## Migration hiện tại

Migration ban đầu dùng định dạng cũ gồm hai phần:

```sql
-- migrate:up
-- câu lệnh tạo schema

-- migrate:down
-- câu lệnh rollback
```

Khi khởi tạo project cloud, chỉ chạy nội dung nằm giữa `-- migrate:up` và
`-- migrate:down` trong Supabase Dashboard → SQL Editor. Không chạy nguyên file
vì phần `migrate:down` sẽ xóa schema vừa tạo.

## Chuẩn hóa cho Supabase CLI

Trước khi dùng `supabase db push`, cần:

- Đổi tên migration sang `YYYYMMDDHHMMSS_ten_migration.sql`.
- Mỗi file chỉ chứa migration tiến, không chứa rollback trong cùng file.
- Bật `[db.migrations] enabled = true` trong `config.toml`.

Sau khi chuẩn hóa:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Không chạy `supabase db push` với migration hiện tại khi chưa chuẩn hóa.

## Thu hoạch và lô hàng

Sau migration `202609180001_batch_versions.sql`, chạy toàn bộ
`migrations/202610050001_harvest_lots.sql` trong SQL Editor trước khi dùng
chức năng thu hoạch mới. Sau đó chạy `migrations/202610170001_harvest_conflict_status.sql`
để xung đột nghiệp vụ trả HTTP 409, tránh bị thử lại như lỗi serialization.
Migration thu hoạch thêm `harvests.is_final`, `harvest_lots`,
RPC `record_batch_harvest` và trigger bảo vệ tổng sản lượng. RPC chỉ được
gọi bằng `service_role`; lưu thu hoạch, lô, tổng sản lượng và phiên bản vụ
trong cùng transaction. Bảng lô bật RLS; không mở truy cập công khai.
Các lần thu hoạch cũ được giữ nguyên, chưa có lô tương ứng và không được
tự coi là có bằng chứng blockchain. Tổng sản lượng khi ghi thu mới bao gồm
các lần thu cũ. Chức năng chưa hỗ trợ sửa/xóa lần thu đã ghi.

## Vận chuyển lô sau thu hoạch

Sau migration `202610190001_harvest_lot_transport.sql`, chạy tiếp
`migrations/202610190002_transporter_workflow.sql`, rồi chạy
`migrations/202610190003_transport_blockchain_events.sql` trong SQL Editor.
Migration thứ ba thêm lịch sử sự kiện vận chuyển bất biến, hàng đợi gửi lại
blockchain, mốc nhiệt độ/vị trí và báo giao của người vận chuyển. Migration kế
tiếp gắn quyền xác nhận với đúng nhà phân phối nhận hàng.

Sau đó chạy `migrations/202610260001_transport_recipient_confirmation.sql`.
Migration này gắn yêu cầu mới với tổ chức nhà phân phối nhận hàng và chuyển
quyền xác nhận `DELIVERED` từ cơ sở gửi sang tài khoản `DISTRIBUTOR` thuộc tổ
chức nhận. Chọn tổ chức nhận trong danh sách nhà phân phối đang có tài khoản;
các chuyến cũ chưa gắn người nhận có thể được cơ sở tạo yêu cầu gán nhà phân
phối từ lịch sử chuyến (việc gán được ghi thành sự kiện). Chuyến đã giao hoặc
đã hủy không thể gán lại.

Chạy tiếp `migrations/202610260002_transport_tracking_updates.sql` để bật các
mốc hành trình do người vận chuyển chủ động ghi: lấy hàng, đang trên đường,
đến/rời điểm trung chuyển, đang giao và giao chưa thành công. Mỗi mốc cần địa
điểm hiện tại, có thể kèm ghi chú. Sau đó chạy
`migrations/202610260003_transport_tracking_temperature.sql` để gộp nhiệt độ
vào cùng mốc cập nhật hành trình; mỗi lần lưu chỉ tạo một sự kiện và một lượt
đưa vào hàng đợi blockchain. Cuối cùng chạy
`migrations/202610260004_transport_delivery_report_simplified.sql`: người vận
chuyển chỉ báo đã tới điểm giao, còn nhà phân phối đã chọn xác nhận đã nhận.
Tên người nhận và mã biên nhận không còn bắt buộc. Cuối cùng chạy
`migrations/202610260005_transport_success_in_tracking.sql` để đưa trạng thái
giao thành công vào cùng form cập nhật hành trình và bỏ endpoint báo giao riêng.
Trạng thái này chỉ đánh dấu đang chờ nhà phân phối xác nhận; không tự đóng chuyến.

Các mốc được neo theo thứ tự, mỗi mốc dùng hash riêng và tham chiếu hash mốc
trước. Backend tự thử gửi lại khi blockchain lỗi; trạng thái giao diện chỉ là
`Đã xác nhận trên blockchain` sau khi có xác nhận từ contract. Bản ghi blockchain
chỉ chứa hash, còn nội dung chi tiết nằm trong Supabase. Cần cấu hình đủ
`BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_CONTRACT_ADDRESS` và `BLOCKCHAIN_PRIVATE_KEY`
trong `backend/.env`; thiếu cấu hình thì giao dịch sẽ ở trạng thái chờ và chưa
được ghi lên chain thật.

## Lịch sử phiên bản vụ nuôi

Chạy toàn bộ file `migrations/202609180001_batch_versions.sql` trong SQL Editor
sau các migration trước đó và trước khi khởi động backend mới. File bổ sung
`batches.current_version`, bảng `batch_versions`, sự kiện `BATCH_CORRECTED`
và hàm `correct_batch` chỉ cho backend gọi bằng quyền `service_role`.
Snapshot và cập nhật vụ được lưu trong cùng transaction; gửi blockchain diễn
ra sau transaction. Dữ liệu vụ có sẵn được lưu làm phiên bản nền tại thời điểm
migration, không phải lịch sử được khôi phục từ blockchain.

### Hoàn tác (DOWN)

Phần `-- migrate:down` nằm cuối file
[migrations/202609180001_batch_versions.sql](migrations/202609180001_batch_versions.sql),
trong khối chú thích `/* ... */`. Chạy toàn bộ file chỉ thực thi UP.
Để chạy DOWN, sao chép riêng nội dung bên trong khối chú thích (không lấy
`/*` và `*/`) sang truy vấn SQL Editor mới và chạy. Không chạy kèm phần UP.

Trước khi chạy, sao lưu `batch_versions` nếu cần giữ lịch sử và đưa ứng dụng
về phiên bản không phụ thuộc `current_version`, `batch_versions`, `correct_batch`.
DOWN xóa trigger, hai hàm, bảng lịch sử (toàn bộ dữ liệu) và cột phiên bản.
Nội dung hiện tại trong `batches`, bảng `blockchain_records` và dữ liệu trên
blockchain được giữ nguyên; thông tin đã sửa không tự trở về giá trị cũ.
Giá trị enum `BATCH_CORRECTED` cũng được giữ để bảo toàn các bản ghi tham chiếu.

Không chạy lại UP ngay sau DOWN nếu đã ghi sự kiện đính chính lên blockchain:
UP sẽ bắt đầu lại từ phiên bản 1, khiến các mã sự kiện của phiên bản tiếp theo
có thể trùng với mã đã ghi. Cần phục hồi lịch sử và số phiên bản phù hợp trước
khi bật lại chức năng đính chính. Phần DOWN không thay đổi lịch sử migration
của Supabase CLI.
