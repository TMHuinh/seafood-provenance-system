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
