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

## Lịch sử đính chính vụ nuôi

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
