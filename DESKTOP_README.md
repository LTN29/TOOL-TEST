# SIMI Automation Desktop (đang triển khai)

Ứng dụng Electron dùng lại giao diện React và API/Worker hiện có. Không tự chuyển `DRY_RUN=false`, không tự Publish workflow, không tự gửi bình luận thật.

## Chạy để phát triển

1. Cài dependencies bằng `npm run install:all`.
2. Tạo `.env` ở root theo `.env.example` và đặt mật khẩu, `N8N_ENCRYPTION_KEY`, `AUTOMATION_TOKEN` riêng. Giữ `DRY_RUN=true` khi thử.
3. Cài Docker Desktop và Google Chrome trên máy chạy Worker. Dùng `npm run desktop:dev` để mở cửa sổ Electron và Vite. API/Worker được Electron khởi động qua utility process nếu có `.env`.

Không chạy đồng thời `npm run dev` hoặc `npm start` trên cùng các cổng 4300/4311. Nếu cổng đã có service, app sẽ nhận diện service đó là bên ngoài và không dừng nó lúc thoát.

## Bản macOS Apple Silicon

Trên máy Mac: `npm run desktop:build:mac`. Output dự kiến ở `release/desktop/`, gồm `.app` và `.dmg`. Bản này **chưa được build hoặc kiểm tra trên macOS** trong môi trường Windows hiện tại. Chưa ký mã/notarize; macOS có thể chặn bản tải từ Internet. Tính năng tự mở khi đăng nhập macOS cũng cần xác minh trên bản đã ký.

Ở bản đóng gói, cấu hình được đọc từ `config.env` trong thư mục dữ liệu Electron của ứng dụng (Cài đặt → Mở thư mục cấu hình). Sao chép giá trị tương ứng từ `.env.example`, lưu tên `config.env`, rồi khởi động lại ứng dụng. Profile Facebook ở thư mục con `profiles/<profile_key>` của cùng thư mục dữ liệu; không nằm trong gói `.app`.

API/Worker chỉ bind `127.0.0.1`. App chỉ quản lý tiến trình do chính nó khởi động. Đóng cửa sổ sẽ ẩn xuống tray theo tùy chọn; chọn “Thoát SIMI Automation” mới dừng API/Worker do app sở hữu. MySQL/n8n trong Docker không bị dừng lúc thoát.

## n8n

Ở trang Automation, “Thiết lập workflow n8n” chỉ mở thư mục chứa 5 JSON; **chưa tự import**. File JSON có `id` và `versionId` cố định, `active:false`. Hãy import trong n8n, kiểm tra tên/ID và Publish bằng tay sau khi xác minh cấu hình. Không import lại mù quáng vào n8n đã có workflow: hiện chưa chứng minh được thao tác import là idempotent. Trạng thái workflow trên giao diện được ghi “Chưa xác minh” vì app chưa có API key quản trị n8n.

Các volume Docker dùng cho MySQL/n8n không nằm trong app. Hãy sao lưu volume trước khi thay đổi dữ liệu hoặc workflow thật. Chưa xác minh live submit Facebook từ bản desktop.
