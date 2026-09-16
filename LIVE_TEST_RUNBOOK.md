# Quy trình kiểm thử gửi thật an toàn

## 1. Cập nhật và khởi động lại

Không ghi đè thay đổi local. Nếu `git pull` báo `scripts/setup-mac.sh` bị thay đổi, xem bằng
`git diff -- scripts/setup-mac.sh`, sau đó commit hoặc `git stash push -m "local mac setup" -- scripts/setup-mac.sh` trước khi pull.

Trên Mac mini, sau khi cập nhật source:

```bash
npm run db:setup
npm run check
npm run test:safety
./scripts/stop-local.sh
./scripts/start-local.sh
./scripts/start-n8n.sh
./scripts/import-n8n-workflows.sh
```

Các biến mới:

```dotenv
LIVE_TEST_MAX_JOBS=1
N8N_MANUAL_WEBHOOK_URL=http://127.0.0.1:5678/webhook/fb-comment-now
API_INTERNAL_URL=http://host.docker.internal:4300
```

`DRY_RUN` vẫn là công tắc an toàn chung. Chỉ khi API, Worker và chiến dịch đều hiện
`CHẠY THẬT`, preflight mới cho bấm xác nhận.

Migration `003_comment_groups.sql` thêm nhóm bình luận, quan hệ tài khoản–chiến dịch–nhóm
và `group_id` trên từng job. Nội dung cũ được chuyển vào nhóm **Nội dung chung**;
không xóa hoặc sửa câu/job cũ. Trong giao diện, vào **Nội dung bình luận** để tạo
nhóm rồi thêm nhiều câu vào từng nhóm. Khi tạo lịch, chọn bài → nhóm → tài khoản;
hệ thống chọn một câu trong nhóm và lưu bản chụp vào job. Một tài khoản có thể
thuộc nhiều chiến dịch, nhưng mỗi tài khoản chỉ có một nhóm đang gán trong từng
chiến dịch. Một tài khoản không thể tạo lại job đã hoàn tất/UNKNOWN cho cùng bài.
Ba nhóm gợi ý (Hỏi thông tin, Hỏi giá & giao hàng, Thể hiện quan tâm) được tạo sẵn
với ID riêng cho mỗi chiến dịch; chúng không tự có câu, không tự tạo lịch hay gửi.

## 2. Trạng thái workflow cho lần thử đầu

- Publish/bật: `02 FB Manual Dispatcher`, `04 FB Worker Watchdog`, `05 FB Session Check`.
- Giữ tắt: `01 FB Campaign Dispatcher`, `03 FB Failed Job Retry`.
- Workflow 02 chỉ còn: Webhook → Claim đúng job → Browser Worker → Save Result.
- Các JSON trong repository mặc định `active: false`; import không tự ý bật workflow.

## 3. Tạo đúng một lượt thử

1. Dùng một tài khoản có `session_status=READY` và profile `simi_fb_01`.
2. Dùng đúng một bài Facebook hợp lệ, một mẫu bình luận và tạo đúng một job `PENDING`.
3. Trong **Hàng chờ**, chọn radio của job đó.
4. Đọc preflight. Nút chỉ mở khi API/Worker/chiến dịch cùng `CHẠY THẬT`.
5. Bấm **Gửi thử 1 bình luận**, kiểm tra modal rồi bấm rõ ràng **Xác nhận gửi thật**.
   Phím Enter không xác nhận.
6. Quan sát các stage: mở trình duyệt → mở bài → tìm ô → nhập → gửi → xác minh.

Không tạo job live tự động và không bật scheduler trong lần kiểm thử đầu.

## 4. Kết quả và rollback

- `SUCCESS`: chỉ khi Worker tìm thấy chính xác bình luận đã đăng.
- `UNKNOWN`: đã bấm gửi nhưng không xác minh chắc chắn; tuyệt đối không tự retry.
- `FAILED`: chỉ dùng cho lỗi trước khi submit.
- Chỉ ba lỗi được tự đưa lại `PENDING`: `NETWORK_ERROR_BEFORE_SUBMIT`,
  `PAGE_LOAD_FAILED`, `WORKER_BUSY`.

Rollback tức thời: đặt `DRY_RUN=true` ở `.env`, đặt chiến dịch về **CHẠY THỬ**,
giữ workflow 01 và 03 tắt, rồi khởi động lại API/Worker. Không đổi `UNKNOWN` hoặc
`SUCCESS` về `PENDING`.

## 5. Phạm vi xác minh

Các kiểm tra tĩnh, syntax và build có thể chạy bằng `npm run check`,
`npm run test:safety`, `npm run build`. Một lần gửi Facebook thật chỉ được xác nhận
trực tiếp trên máy Mac đã đăng nhập. Cho đến khi thực hiện bước đó: **Chưa xác minh live submit**.
