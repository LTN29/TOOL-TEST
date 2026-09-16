# Hướng dẫn cài đặt trên Mac mini

## 1. Chuẩn bị

Cài Node.js 22+ và Docker Desktop. MySQL sẽ chạy bằng Docker tại `127.0.0.1:3307`. Không chép `node_modules` hoặc thư mục `profiles` từ Windows sang Mac.

```bash
brew install node@22
```

Docker Desktop cần được mở ít nhất một lần và bật tự khởi động cùng macOS.

## 2. Thiết lập project lần đầu

```bash
cd /duong-dan/toi/simi-fb-comment-orchestrator-v2
chmod +x scripts/*.sh
./scripts/setup-mac.sh
```

Lần cài mới, script tự sinh mật khẩu MySQL và các khóa bảo mật trong `.env`, khởi động MySQL Docker rồi tạo schema.

Nếu nâng cấp từ bản cũ hoặc đã có `.env`, kiểm tra `DB_PORT=3307` rồi chạy:

```bash
npm run mysql:start
npm run db:setup
```

Lệnh dùng thông tin trong `.env`, chạy `CREATE TABLE IF NOT EXISTS` và migration mở rộng enum. Nó không xóa hay đổi tên bảng, không làm mất dữ liệu hiện có.

## 3. Đăng nhập Facebook trên Mac

```bash
cd apps/worker
npm run login -- simi_fb_01
```

Đăng nhập và hoàn tất 2FA, sau đó đóng cửa sổ Chromium. Lặp lại với từng mã phiên. Không lưu mật khẩu Facebook trong project.

## 4. Chạy hệ thống

```bash
./scripts/start-local.sh
```

Một terminal chạy API `4300`, Web `5173` và Trình điều khiển Facebook `4311`. Trình duyệt tự mở Web. Dừng bằng `Ctrl+C`, hoặc từ terminal khác:

```bash
./scripts/stop-local.sh
```

Chạy n8n nền:

```bash
./scripts/start-n8n.sh
```

Mở `http://localhost:5678`, import 5 file trong `n8n/`, chạy Watchdog một lần rồi mới bật Dispatcher. Dừng n8n bằng `./scripts/stop-n8n.sh`.

Có thể import cả 5 workflow bằng một lệnh (chỉ chạy một lần):

```bash
npm run n8n:import
```

Sau đó mở giao diện n8n, kiểm tra và nhấn **Publish** cho từng workflow. n8n hiển thị Online chỉ có nghĩa container đang chạy; lịch tự động chỉ hoạt động khi workflow Dispatcher đã được import và Publish.

## 5. Cloudflare và bảo mật

Chỉ đưa Web `http://localhost:5173` qua Cloudflare Tunnel. Điền hostname tunnel vào `APP_ALLOWED_HOSTS` trong `.env`, ví dụ `binhluan.example.com`. Không public trực tiếp MySQL `3307`, API `4300`, Trình điều khiển `4311` hoặc n8n `5678`. Bật Cloudflare Access để yêu cầu đăng nhập trước khi vào trang quản trị.

Thiết lập tunnel quản lý tại máy:

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create simi-comment
cp deploy/cloudflare-config.example.yml ~/.cloudflared/config.yml
```

Thay UUID, user macOS và hostname trong `~/.cloudflared/config.yml`, sau đó:

```bash
cloudflared tunnel route dns simi-comment binhluan.example.com
cloudflared tunnel run simi-comment
```

Khi đã kiểm tra thành công, chạy `cloudflared service install` để tunnel chạy lúc đăng nhập. Trong Cloudflare Zero Trust, tạo ứng dụng Self-hosted cho toàn bộ hostname và tạo chính sách chỉ cho phép email nhân viên. Phải tạo Access trước khi xem việc xuất bản hoàn tất; nếu không, hostname có thể truy cập công khai.

Giữ `DRY_RUN=true` cho đến khi đã kiểm tra đúng bài, tài khoản và nội dung. Đổi token ngay nếu file `.env` bị lộ. Không commit `.env`, `profiles/`, dữ liệu n8n hoặc `node_modules`.

## 6. Tự chạy sau khi Mac khởi động

Sau khi đã chạy thử ổn định:

```bash
chmod +x scripts/install-autostart-mac.sh
./scripts/install-autostart-mac.sh
```

LaunchAgent chạy bản Web đã build, API và Trình điều khiển dưới đúng tài khoản macOS hiện tại. Log nằm trong `logs/`. Bật Docker Desktop tự khởi động để n8n tự khôi phục nhờ `restart: unless-stopped`.
