# Hệ thống truy xuất nguồn gốc thủy sản

Dự án gồm frontend Vue.js, backend Node.js, Supabase local và blockchain.

## Cấu trúc dự án

```text
seafood-provenance-system/
├── frontend/       # Vue 3 + TypeScript
├── backend/        # Node.js + Express
├── supabase/       # PostgreSQL, Auth, Storage và Studio
├── blockchain/     # Smart contract
└── README.md
```

## Yêu cầu môi trường

- WSL 2 hoặc Linux.
- Docker Engine và Docker Compose.
- Node.js 20 trở lên để phát triển frontend và backend.

Kiểm tra môi trường:

```bash
docker info
docker compose version
node --version
npm --version
```

## Cấu hình biến môi trường

Các file chứa key local không được đưa lên Git. Khi mới clone dự án, tạo chúng từ file mẫu:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp supabase/.env.example supabase/.env
```

Các key trong `backend/.env` và `frontend/.env.local` phải tương ứng với
`SERVICE_ROLE_KEY` và `ANON_KEY` trong `supabase/.env`.

Backend sử dụng secret key:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=your_local_secret_key
```

Frontend chỉ sử dụng publishable key:

```env
VITE_API_URL=http://localhost:3000
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your_local_publishable_key
```

Không đưa secret key hoặc private key blockchain vào frontend.

## Khởi động Supabase local

```bash
cd supabase
docker compose up -d
```

Lệnh này chỉ khởi động PostgreSQL, Auth, REST, Realtime, Storage, API gateway,
Meta và Studio. Khi có file migration mới, chạy riêng:

```bash
./migrate-up.sh
```

Các địa chỉ mặc định:

```text
Supabase API: http://localhost:54321
PostgreSQL:   localhost:54322
Mailpit:      http://localhost:54324
```

Khởi động Supabase Studio riêng tại port `8001`:

```bash
cd supabase
docker compose up -d
```

Truy cập Studio:

```text
http://localhost:8001/project/default
```

Dừng toàn bộ Supabase nhưng vẫn giữ dữ liệu:

```bash
cd supabase
docker compose down
```

Hướng dẫn tạo, chạy và rollback migration được đặt tại
[`supabase/README.md`](supabase/README.md).

## Chạy backend bằng Docker Compose

Supabase phải chạy trước. Sau đó:

```bash
cd backend
docker compose up -d --build
```

Kiểm tra backend:

```bash
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

Xem log và dừng backend:

```bash
docker compose logs -f
docker compose down
```

## Chạy frontend bằng Docker Compose

```bash
cd frontend
docker compose up -d --build
```

Truy cập frontend:

```text
http://localhost:5173
```

Xem log và dừng frontend:

```bash
docker compose logs -f
docker compose down
```

## Thứ tự khởi động toàn bộ môi trường

Luôn khởi động theo thứ tự sau:

1. **Supabase và database:** thực hiện phần “Khởi động Supabase” trong
   [`supabase/README.md`](supabase/README.md).

2. **Backend:**

```bash
cd backend
docker compose up -d --build
```

3. **Frontend:**

```bash
cd frontend
docker compose up -d --build
```

Sau khi khởi động, truy cập frontend tại `http://localhost:5173`, backend tại
`http://localhost:3000` và Supabase Studio tại
`http://localhost:8001/project/default`.

## Cài thêm thư viện

### Backend

Khi container đang chạy:

```bash
cd backend
docker compose exec backend npm install ten-thu-vien
```

Ví dụ:

```bash
docker compose exec backend npm install zod
docker compose exec backend npm install -D eslint
```

Khi container chưa chạy:

```bash
docker compose run --rm backend npm install ten-thu-vien
```

### Frontend

Khi container đang chạy:

```bash
cd frontend
docker compose exec frontend npm install ten-thu-vien
```

Ví dụ:

```bash
docker compose exec frontend npm install axios
docker compose exec frontend npm install -D sass
```

Khi container chưa chạy:

```bash
docker compose run --rm frontend npm install ten-thu-vien
```

Sau khi cài thư viện, commit cả hai file:

```text
package.json
package-lock.json
```

Không commit thư mục `node_modules/`.

## Cập nhật dependency sau khi pull code

Backend:

```bash
cd backend
docker compose run --rm backend npm ci
docker compose up -d
```

Frontend:

```bash
cd frontend
docker compose run --rm frontend npm ci
docker compose up -d
```

## Các port local

| Thành phần | Địa chỉ |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend | `http://localhost:3000` |
| Backend health | `http://localhost:3000/api/health` |
| Supabase API | `http://localhost:54321` |
| PostgreSQL | `localhost:54322` |
| Mailpit | `http://localhost:54324` |
| Supabase Studio | `http://localhost:8001/project/default` |

## Lưu ý khi làm việc nhóm

- Luôn commit `package-lock.json` khi dependency thay đổi.
- Không commit `.env`, secret key, private key hoặc dữ liệu production.
- Không chạy `docker system prune` hoặc `docker volume prune` nếu chưa kiểm tra phạm vi ảnh hưởng.
