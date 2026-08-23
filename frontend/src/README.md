# Frontend structure

```text
src/
├── api/          # HTTP client dùng chung
├── components/   # Component tái sử dụng ở nhiều page
├── pages/        # Route page, chia thư mục theo module
├── router/       # Khai báo route và navigation guard
├── stores/       # Pinia state, actions và lời gọi backend API
├── types/        # Type dùng chung
├── assets/       # CSS và static assets
├── App.vue
└── main.ts
```

## Quy ước

- Page gọi action của store, không gọi `fetch` hoặc API client trực tiếp.
- Store quản lý state, loading, error và gọi backend qua `api/client.ts`.
- Component dùng chung nhận dữ liệu bằng props và phát sự kiện bằng emits.
- Mỗi route page đặt trong `pages/<module>/` và dùng hậu tố `Page.vue`.
- Store dùng hậu tố `.store.ts`.
- Type dùng chung được export từ `types/index.ts`.

Luồng dữ liệu:

```text
Page/Component -> Store -> API client -> Backend
```
