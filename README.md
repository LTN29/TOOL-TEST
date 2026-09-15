# SIMI Facebook Comment Orchestrator

Hệ thống local-first gồm Web quản trị tiếng Việt, Node/Express API, MySQL và n8n chạy Docker, cùng trình điều khiển Facebook bằng Playwright.

## Kiến trúc

```text
Web :5173 → API :4300 → MySQL Docker :3307
                    ↘ n8n :5678 → Playwright :4311 → Facebook
```

- Mỗi tài khoản dùng một `profile_key` tương ứng với `apps/worker/profiles/<profile_key>`.
- Không lưu username hoặc password Facebook.
- `DRY_RUN=true` mặc định: chỉ nhập nội dung, không gửi.
- API, n8n và trình điều khiển dùng chung `AUTOMATION_TOKEN`.
- Mỗi campaign/post/account chỉ có một job, tránh bình luận trùng.

## Windows — lần đầu

1. Cài Node.js 22+ và Docker Desktop.
2. Sao chép `.env.example` thành `.env`, sửa mật khẩu MySQL, `N8N_ENCRYPTION_KEY` và `AUTOMATION_TOKEN`.
3. Chạy `npm run install:all`, `npm run mysql:start`, rồi `npm run db:setup`.
4. Chạy `npm run playwright:install`.
5. Đăng nhập từng profile: `cd apps/worker` rồi `npm run login -- simi_fb_01`.

Từ lần sau, double-click `START_LOCAL.cmd`. API, Web và trình điều khiển chạy trong một terminal. Double-click `STOP_LOCAL.cmd` để dừng đúng các PID đã được project ghi nhận.

## n8n

Double-click `START_N8N.cmd`, mở `http://localhost:5678`, rồi import 5 file trong `n8n/`. MySQL Docker sẽ được bảo đảm đang chạy trước n8n. Chạy workflow Watchdog một lần trước khi bật Dispatcher.

## Địa chỉ

- Web: http://localhost:5173
- API health: http://localhost:4300/health
- Trình điều khiển health: http://localhost:4311/health
- n8n: http://localhost:5678

## Mac mini

Đọc [HUONG_DAN_MAC_MINI.md](./HUONG_DAN_MAC_MINI.md). Script `scripts/setup-mac.sh` cài dependency và kiểm tra build; `scripts/start-local.sh` chạy local; `scripts/install-autostart-mac.sh` tạo LaunchAgent để chạy 24/7.

## An toàn vận hành

- Chỉ đưa Web `5173` qua Cloudflare Tunnel và bảo vệ bằng Cloudflare Access.
- Không public MySQL `3307`, API `4300`, trình điều khiển `4311` hay n8n `5678`.
- Không tắt chế độ thử nghiệm trước khi kiểm tra selector và nội dung trên tài khoản được phép sử dụng.
- Project không chứa CAPTCHA bypass, fingerprint spoofing, proxy rotation hoặc cơ chế né checkpoint.
