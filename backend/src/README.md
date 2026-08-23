# Backend modules

Backend được tổ chức theo feature để code của một nghiệp vụ nằm cùng một chỗ.

```text
src/
├── config/                 # Biến môi trường và external clients
├── modules/
│   ├── auth/               # Auth, profile và auth middleware
│   ├── batches/            # Danh sách và chi tiết lô hàng
│   ├── blockchain/         # Ghi nhận và đọc blockchain records
│   └── health/             # Health check
├── shared/                 # Thành phần dùng chung, không thuộc nghiệp vụ
├── app.js                  # Khởi tạo Express và mount routes
└── server.js               # Khởi động/dừng HTTP server
```

## Luồng phụ thuộc

```text
routes -> controller -> service -> repository -> Supabase
```

- `routes`: URL và middleware của endpoint.
- `controller`: chuyển đổi HTTP request/response, không truy vấn database.
- `service`: nghiệp vụ và phối hợp nhiều repository/service.
- `repository`: truy vấn Supabase, không xử lý HTTP.
- `validation`: kiểm tra input của module.
- `constants`: enum và hằng số của module.

`shared/` không được import ngược từ một module cụ thể. Khi thêm nghiệp vụ mới,
tạo `src/modules/<feature>/` thay vì thêm controller/service vào thư mục chung.
