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
