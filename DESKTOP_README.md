# SIMI Automation Desktop

Desktop là ứng dụng cài riêng trên macOS/Windows. Gói cài chứa giao diện, Worker và Chromium của Playwright. MySQL, API và n8n chỉ chạy trên Central Server; máy Desktop không cần Docker, Node.js, mã nguồn hay file .env để sử dụng bản đã cài.

## Tạo bộ cài

Build trên đúng hệ điều hành đích. Trong repo, chạy `npm run install:all` rồi:

- Mac Apple Silicon: `npm run desktop:build:mac`
- Windows x64: `npm run desktop:build:win`

Script tải Chromium vào thư mục build riêng, build giao diện và đóng gói tại `release/desktop/`. Mac tạo .dmg; Windows tạo bộ cài NSIS .exe. Bản Mac chưa ký mã/notarize. Chưa có kết quả build thực tế trên Mac mini trong môi trường Windows này.

## Dùng app sau khi cài

1. Mở SIMI Automation, vào **Cài đặt**.
2. Nhập URL Central API (`http://127.0.0.1:4300` chỉ khi app chạy ngay trên Mac mini; Desktop khác cần URL HTTPS của Cloudflare Tunnel), Worker key duy nhất, tên máy và mã kích hoạt từ server.
3. Bấm **Đăng ký thiết bị**. Token được lưu bằng secure storage của hệ điều hành. App tự khởi động Worker và bắt đầu heartbeat; lần mở sau không cần đăng ký lại.
4. Trong mục **Facebook**, gán tài khoản cho đúng máy Worker, rồi đăng nhập Facebook trên chính máy đó. Profile nằm trong thư mục dữ liệu của app và không chuyển lên Central Server.

Trước khi cài bản mới, thoát hẳn phiên `desktop:dev` hoặc Worker cũ đang giữ cổng 4311. App không chiếm quyền hay dừng tiến trình ngoài app. Khi đóng cửa sổ, tùy chọn chạy nền giữ Worker tiếp tục hoạt động; **Thoát SIMI Automation** mới dừng Worker do app khởi động.

Central Server hiện bind `127.0.0.1:4300`, vì vậy các máy khác chưa thể kết nối cho đến khi cấu hình Cloudflare Tunnel. App giữ `DRY_RUN=true`; chưa tự bật gửi bình luận thật hoặc Publish n8n workflow. Kiểm tra heartbeat và một job chạy thử trước khi dùng nhiều máy.
