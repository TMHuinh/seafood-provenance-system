# Luồng nhật ký nuôi và Blockchain hiện tại

## 1. Mục tiêu

Luồng hiện tại cho phép người dùng:

- Lưu nhật ký dưới dạng bản nháp và chỉnh sửa tự do.
- Chỉ ghi dữ liệu lên Blockchain khi người dùng xác nhận.
- Không sửa trực tiếp nhật ký đã xác nhận.
- Đính chính bằng cách tạo phiên bản mới, có lý do và hash riêng.
- Thu hồi dữ liệu mà không xóa lịch sử.
- Kiểm tra hash trực tiếp từ Smart Contract.

Blockchain không lưu toàn bộ nội dung nhật ký. Nó chỉ lưu hash SHA-256 để chứng minh dữ liệu đã được ghi nhận và không bị thay đổi âm thầm.

## 2. Vòng đời nhật ký

```text
Tạo nhật ký
      |
      v
    DRAFT ----------------------+
      |                         |
      | Chỉnh sửa tự do       |
      +-------------------------+
      |
      | Xác nhận
      v
  CONFIRMED
      |
      +---- Đính chính ----> CONFIRMED (version mới)
      |
      +---- Thu hồi --------> REVOKED
```

Các trạng thái trong `farming_logs.lifecycle_status`:

| Trạng thái | Ý nghĩa |
|---|---|
| `DRAFT` | Bản nháp, chưa ghi Blockchain, có thể chỉnh sửa trực tiếp |
| `CONFIRMED` | Đã có phiên bản chính thức và bằng chứng Blockchain |
| `REVOKED` | Đã thu hồi, không còn hiệu lực nhưng không bị xóa |

## 3. Các bảng dữ liệu liên quan

### `farming_logs`

Giữ dữ liệu hiện hành để giao diện truy vấn nhanh.

Các trường quan trọng:

| Trường | Ý nghĩa |
|---|---|
| `id` | ID cố định của nhật ký |
| `lifecycle_status` | `DRAFT`, `CONFIRMED` hoặc `REVOKED` |
| `current_version` | Số phiên bản hiện hành |
| `current_version_id` | Tham chiếu tới bản ghi version hiện hành |
| `data_hash` | Hash của phiên bản hiện hành |
| `tx_hash` | Transaction hash của phiên bản hiện hành |

Với `DRAFT`, `current_version_id`, `data_hash` và `tx_hash` có thể chưa có giá trị.

### `farming_log_versions`

Lưu snapshot bất biến của mỗi phiên bản đã xác nhận.

| Trường | Ý nghĩa |
|---|---|
| `farming_log_id` | Nhật ký gốc |
| `version_number` | Số phiên bản: 1, 2, 3... |
| `status` | `ACTIVE`, `SUPERSEDED`, `REVOKED` hoặc `FAILED` |
| `supersedes_version_id` | Phiên bản cũ bị phiên bản này thay thế |
| `correction_reason` | Lý do đính chính, bắt buộc từ version 2 |
| `corrected_by` | Người tạo phiên bản |
| `blockchain_event_id` | Khóa duy nhất dùng trên Smart Contract |
| `data_hash` | Hash nội dung của phiên bản |
| `tx_hash` | Giao dịch Blockchain của phiên bản |
| `confirmed_at` | Thời gian phiên bản được xác nhận |
| `revocation_reason` | Lý do thu hồi nếu version bị thu hồi |

Trạng thái version:

- `ACTIVE`: phiên bản đang có hiệu lực.
- `SUPERSEDED`: đã bị một phiên bản mới thay thế.
- `REVOKED`: đã bị thu hồi.
- `FAILED`: quá trình chứng thực không thành công.

### `blockchain_records`

Lưu thông tin kỹ thuật của mỗi lần gửi Blockchain:

- `event_id`
- `entity_id`
- `data_hash`
- `transaction_hash`
- `block_number`
- `contract_address`
- `status`

Mỗi phiên bản có một `event_id` riêng nên không ghi đè bằng chứng cũ.

### `audit_logs`

Ghi nhận hành động của người dùng:

- `CREATE`: tạo bản nháp.
- `UPDATE`: sửa bản nháp hoặc tạo đính chính.
- `CONFIRM`: xác nhận bản nháp.
- `REVOKE`: thu hồi nhật ký.

## 4. Luồng tạo bản nháp

API:

```http
POST /api/farming-logs
```

Trình tự xử lý:

1. Backend kiểm tra dữ liệu đầu vào.
2. Kiểm tra người dùng có quyền với lô nuôi.
3. Tạo `farming_logs` với trạng thái `DRAFT`.
4. Ghi `CREATE` vào `audit_logs`.
5. Chưa tạo version và chưa gửi Blockchain.

Kết quả trên giao diện: **Bản nháp**.

## 5. Luồng sửa bản nháp

API:

```http
PATCH /api/farming-logs/:id
```

Chỉ cho phép khi `lifecycle_status = DRAFT`.

1. Kiểm tra quyền truy cập.
2. Kiểm tra nhật ký là bản nháp.
3. Cập nhật trực tiếp `farming_logs`.
4. Ghi `UPDATE` vào `audit_logs`.
5. Không tăng version và không gửi Blockchain.

Nếu nhật ký đã xác nhận, API trả `409 Conflict` và yêu cầu dùng luồng đính chính.

## 6. Luồng xác nhận

API:

```http
POST /api/farming-logs/:id/confirm
```

Chỉ cho phép khi nhật ký là `DRAFT`.

```text
DRAFT
  |
  | Chuẩn hóa payload và tạo SHA-256
  v
Gửi eventId + dataHash lên Smart Contract
  |
  | Giao dịch thành công
  v
Tạo farming_log_versions version 1 (ACTIVE)
  |
  v
Cập nhật farming_logs thành CONFIRMED
```

`eventId` của version 1:

```text
FARMING_LOG_RECORDED:<farmingLogId>
```

Backend chỉ chuyể sang `CONFIRMED` khi giao dịch Blockchain thành công.

## 7. Luồng đính chính

API:

```http
POST /api/farming-logs/:id/corrections
```

Request phải có:

```json
{
  "expectedVersion": 1,
  "correctionReason": "Nhập nhầm số lượng thức ăn",
  "logType": "FEEDING",
  "logDate": "2026-09-12",
  "details": {
    "feedType": "Thức ăn A",
    "feedAmount": 30
  }
}
```

Quy tắc:

- Chỉ đính chính nhật ký `CONFIRMED`.
- `correctionReason` bắt buộc từ 3 đến 1000 ký tự.
- `expectedVersion` phải trùng version hiện tại; nếu không, API trả `409 Conflict`.
- Phiên bản cũ không bị xóa hoặc thay đổi nội dung.

Ví dụ:

```text
Version 1: 20 kg | SUPERSEDED | Hash A
                           |
                           v
Version 2: 30 kg | ACTIVE     | Hash B
```

`eventId` từ version 2:

```text
FARMING_LOG_RECORDED:<farmingLogId>:v<versionNumber>
```

Sau khi Blockchain xác nhận:

1. Version cũ chuyển thành `SUPERSEDED`.
2. Tạo version mới `ACTIVE` và liên kết qua `supersedes_version_id`.
3. Cập nhật `farming_logs` sang nội dung và version mới.
4. Ghi hành động vào `audit_logs`.

## 8. Luồng thu hồi

API:

```http
POST /api/farming-logs/:id/revoke
```

Request:

```json
{
  "reason": "Phiếu cân không thuộc lô hàng này"
}
```

1. Chỉ nhật ký `CONFIRMED` mới có thể thu hồi.
2. Lý do thu hồi là bắt buộc.
3. Backend tạo một event Blockchain riêng cho việc thu hồi.
4. Version hiện hành chuyển thành `REVOKED`.
5. `farming_logs.lifecycle_status` chuyển thành `REVOKED`.
6. Hệ thống lưu người thu hồi, thời gian và lý do.
7. Ghi `REVOKE` vào `audit_logs`.

Dữ liệu không bị xóa khỏi database hoặc Blockchain.

## 9. Luồng xem lịch sử

API:

```http
GET /api/farming-logs/:id/history
```

API trả các phiên bản theo thứ tự mới nhất trước, bao gồm:

- Số phiên bản.
- Trạng thái.
- Snapshot nội dung.
- Lý do đính chính.
- Event ID và transaction hash.
- Người tạo và thời gian tạo.
- Thông tin thu hồi nếu có.

Giao diện cung cấp nút **Lịch sử** cho nhật ký đã có version.

## 10. Luồng xác minh Blockchain

API:

```http
GET /api/farming-logs/batch/:batchId/verify
```

Với mỗi nhật ký đã xác nhận:

1. Backend tạo lại payload từ dữ liệu hiện hành.
2. Tính lại SHA-256.
3. Lấy `event_id` và `contract_address` từ `blockchain_records`.
4. Gọi `getDataHash(eventId)` trực tiếp trên đúng Smart Contract.
5. So sánh hash tính lại với hash on-chain.

Kết quả:

| Kết quả | Ý nghĩa |
|---|---|
| `SYNCED` | Dữ liệu hiện tại khớp bằng chứng trên Blockchain |
| `DESYNCED` | Thiếu bằng chứng hoặc hash không khớp |
| `DRAFT` | Bản nháp, không cần có bằng chứng Blockchain |

Nếu RPC hoặc Smart Contract không truy cập được, API trả lỗi `503` thay vì kết luận sai rằng dữ liệu bị thay đổi.

## 11. Quy tắc của Smart Contract

Smart Contract không cho phép ghi lại cùng một `eventId`:

```solidity
require(record.timestamp == 0, "Event already exists");
```

Vì vậy:

- Version 1, version 2 và version 3 phải có event ID khác nhau.
- Hash cũ không thể bị ghi đè.
- Đính chính và thu hồi tạo bằng chứng mới.

## 12. Hành vi giao diện

| Trạng thái | Nút hiển thị |
|---|---|
| `DRAFT` | **Chỉnh sửa**, **Xác nhận** |
| `CONFIRMED` | **Đính chính**, **Thu hồi**, **Lịch sử** |
| `REVOKED` | **Lịch sử** |

Người dùng không thấy nút **Chỉnh sửa** thông thường sau khi dữ liệu đã được xác nhận.

## 13. Giới hạn hiện tại

Luồng gửi Blockchain hiện vẫn chạy đồng bộ trong API:

```text
API request -> Gửi transaction -> Chờ tx.wait() -> Trả response
```

Vì vậy, khi RPC chậm hoặc mất kết nối, thao tác xác nhận có thể chậm hoặc thất bại. Hướng hoàn thiện tiếp theo là bổ sung outbox/worker:

```text
API -> Lưu job QUEUED -> Trả response
                         |
                         v
                       Worker -> Blockchain -> CONFIRMED/RETRY
```

Ngoài ra, Blockchain chỉ chứng minh dữ liệu không bị thay đổi sau khi xác nhận; nó không tự chứng minh dữ liệu đầu vào phản ánh đúng sự kiện ngoài đời thực.
