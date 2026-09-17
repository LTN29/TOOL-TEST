# SIMI Automation Desktop

Desktop là ứng dụng cài riêng trên macOS/Windows. Gói cài chứa giao diện, Worker và Chromium của Playwright. MySQL, API và n8n chỉ chạy trên Central Server; máy Desktop không cần Docker, Node.js, mã nguồn hay file .env để sử dụng bản đã cài.

## Tạo bộ cài

Build trên đúng hệ điều hành đích. Trong repo, chạy `npm run install:all` rồi:

- Mac Apple Silicon: `npm run desktop:build:mac`
- Windows x64: `npm run desktop:build:win`

Script tải Chromium vào thư mục build riêng, build giao diện và đóng gói tại `release/desktop/`. Mac tạo .dmg; Windows tạo bộ cài NSIS .exe. Bản Mac chưa ký mã/notarize. Chưa có kết quả build thực tế trên Mac mini trong môi trường Windows này.

## Dùng app sau khi cài

1. Trên một máy đã đăng ký (ví dụ Mac mini), mở **Cài đặt → Thêm máy khác**. Nhập hostname HTTPS của Cloudflare Tunnel đang trỏ tới API `127.0.0.1:4300`, rồi bấm **Tạo mã kết nối**. Địa chỉ localhost chỉ dùng nếu máy mới cũng là chính Mac mini.
2. Mở SIMI Automation trên máy mới. Dán duy nhất mã vừa tạo, bấm **Kết nối và mở app**. Mã hết hạn sau 10 phút, chỉ dùng một lần; không chia sẻ công khai. App tự nhận tên máy, tạo Worker riêng, lưu device token bằng secure storage và tự khởi động Worker. Những lần mở sau vào thẳng ứng dụng.
3. Trong mục **Facebook**, gán tài khoản cho đúng máy Worker, rồi đăng nhập Facebook trên chính máy đó. Profile nằm trong thư mục dữ liệu của app và không chuyển lên Central Server.

Máy đầu tiên chưa có thiết bị để tạo mã: dùng quy trình đăng ký bằng `DEVICE_ACTIVATION_CODE` một lần trong **Cài đặt → Thiết lập thủ công (nâng cao)**. Mã kích hoạt gốc không phải mã để phân phát cho mọi máy. Server cần áp dụng migration 005 bằng `bash scripts/server-start.sh` trước khi tạo mã kết nối. Bản Desktop cũ chưa có màn hình nhập mã cần cài bản mới một lần.

Trước khi cài bản mới, thoát hẳn phiên `desktop:dev` hoặc Worker cũ đang giữ cổng 4311. App không chiếm quyền hay dừng tiến trình ngoài app. Khi đóng cửa sổ, tùy chọn chạy nền giữ Worker tiếp tục hoạt động; **Thoát SIMI Automation** mới dừng Worker do app khởi động.

Central Server bind `127.0.0.1:4300`; Cloudflare Tunnel trên Mac mini có thể chuyển tiếp HTTPS từ máy khác vào cổng này mà không cần mở port công khai. Khi Access policy dùng **Service Auth**, tại lần kết nối đầu tiên nhập `CF-Access-Client-Id` và `CF-Access-Client-Secret` của Service Token trong app. Hai giá trị chỉ đi qua Electron main process, được lưu bằng OS secure storage và được thêm vào tất cả request tới Central API; chúng không nằm trong React, settings JSON hay Git. Sau khi đăng ký, Worker dùng Device Token cho heartbeat, claim job, progress/guard và report result. Kiểm tra tunnel đang trỏ đúng API bằng `https://comment.simi.vn/health` trên Windows trước khi tạo mã. App giữ `DRY_RUN=true`; chưa tự bật gửi bình luận thật hoặc Publish n8n workflow. Kiểm tra heartbeat và một job chạy thử trước khi dùng nhiều máy.

## Cập nhật trong app (từ phiên bản 0.2.0)

Sau khi đã đăng ký thiết bị, app tự kiểm tra bản mới lúc mở và mỗi 6 giờ; mục **Cài đặt → Cập nhật ứng dụng** cũng có nút kiểm tra. Khi có bản mới, app tải bộ cài từ **Central API đã đăng ký**, kiểm tra kích thước và SHA-256, rồi chỉ mở bộ cài khi người dùng bấm xác nhận. Đây chưa phải cập nhật im lặng. Bản 0.1.0 chưa có trình cập nhật nên phải cài đè 0.2.0 một lần. Cấu hình, device token và profile nằm trong thư mục dữ liệu người dùng, ngoài gói app.

Central Server đọc các file phát hành từ thư mục `updates/` (không đưa vào Git), chỉ cho device token hợp lệ tải. Sau khi build, trên **máy chủ Mac mini**:

```bash
node scripts/publish-desktop-update.mjs darwin arm64 release/desktop/SIMI-Automation-0.2.0-arm64.dmg
```

Với bản Windows, chép file `SIMI-Automation-0.2.0-x64.exe` từ máy build Windows sang Mac mini, rồi chạy:

```bash
node scripts/publish-desktop-update.mjs win32 x64 /duong-dan-den/SIMI-Automation-0.2.0-x64.exe
```

Lệnh tạo manifest `latest-<platform>-<arch>.json` và tính SHA-256. API container mount thư mục này chỉ đọc; cập nhật file phát hành không cần build lại server, nhưng lần đầu thêm mount cần chạy lại `bash scripts/server-start.sh`. Mỗi bản mới phải tăng `apps/desktop/package.json` version, build lại bộ cài và publish trên Mac mini. Desktop ở máy khác cần URL **HTTPS** tới Central API; update từ HTTP mạng LAN bị từ chối.

macOS auto-install thực thụ cần Apple Developer code signing; DMG hiện chưa ký nên app chỉ mở DMG để người dùng thay app thủ công. Windows hiện mở bộ cài NSIS sau khi xác minh SHA-256; để phát hành rộng rãi nên ký Authenticode, tránh cảnh báo SmartScreen và tăng bảo đảm nguồn gốc.
