# Thiết lập Central Server trên Mac mini — bản chuẩn bị, chưa mở Internet

Kiến trúc mới đặt MySQL, API và n8n trên Mac mini; mỗi máy cài SIMI Desktop chỉ giữ Worker và profile Facebook của chính máy đó. **Source hiện tại chưa hoàn tất device auth, account→worker assignment và outbound claim. Không mở Cloudflare Tunnel, không Publish workflow 01/02/03 và không chuyển `DRY_RUN=false` ở giai đoạn này.** Bộ cài desktop trước đây vẫn bundle API nên chưa dùng cho kiến trúc nhiều máy.

## 1. Điều kiện trước khi cài

- Mac mini bật liên tục, kết nối mạng ổn định; cài Git và [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/). Mở Docker Desktop một lần, hoàn tất điều khoản và xác nhận `docker info` chạy được.
- Bật “Start Docker Desktop when you sign in” trong Docker Desktop Settings nếu muốn các container `restart: unless-stopped` tự trở lại sau khi đăng nhập macOS. Đây là khởi động sau **đăng nhập**, không phải cam kết chạy ngay từ lúc boot chưa đăng nhập. [Tài liệu Docker](https://docs.docker.com/desktop/settings-and-maintenance/settings/).
- Có quyền truy cập Git repo. Chọn một thư mục lưu code cố định; ví dụ `~/Desktop/TOOL-TEST`. Không copy riêng từng file khi cập nhật.

## 2. Lần đầu trên Mac mini

```bash
git clone <URL_REPO_CUA_BAN> ~/Desktop/TOOL-TEST
cd ~/Desktop/TOOL-TEST
bash scripts/server-install-mac.sh
bash scripts/server-start.sh
bash scripts/server-status.sh
```

Nếu đã clone repo, bỏ qua `git clone`, chạy các lệnh còn lại trong thư mục repo thực. `server-install-mac.sh` chỉ tạo `.env.server` nếu chưa tồn tại, đặt quyền `600`, sinh mật khẩu/khóa ngẫu nhiên và **không ghi đè** file cũ. Kiểm tra `DRY_RUN=true`; giữ file này ngoài Git và sao lưu khóa n8n an toàn. `docker-compose.server.yml` chạy MySQL, API, n8n; host chỉ bind lần lượt `127.0.0.1:3307`, `127.0.0.1:4300`, `127.0.0.1:5678`. API trong container nghe `0.0.0.0` để n8n trong cùng Docker network truy cập, nhưng host không công khai cổng.

`server-start.sh` build API, chờ MySQL, chạy migrations 001–003, khởi động n8n rồi kiểm tra `GET /health`. Migration không drop bảng/volume. Với volume MySQL mới, `db/init.sql` được MySQL áp dụng lúc khởi tạo; volume cũ được giữ nguyên. Trước khi chuyển DB đang dùng thật sang Compose mới, hãy sao lưu riêng MySQL và n8n data; script không tự xóa hoặc reset volume.

## 3. Kiểm tra và vận hành

```bash
curl -fsS http://127.0.0.1:4300/health
curl -fsS http://127.0.0.1:5678/healthz
bash scripts/server-status.sh
```

`/health` của API xác nhận kết nối MySQL và trả `ok`, `database`, `version`; trạng thái n8n xem riêng qua `/healthz`. Không coi Docker `Running` là đủ nếu hai health check trên chưa qua.

Để dừng **chỉ** ba container của stack (giữ volume):

```bash
bash scripts/server-stop.sh
```

Để cập nhật sau khi code được commit/push từ máy phát triển:

```bash
cd ~/Desktop/TOOL-TEST
bash scripts/server-update.sh
```

Script từ chối working tree có sửa đổi, dùng `git pull --ff-only`, build lại API, chạy migration idempotent và kiểm tra health. Không `git reset --hard`, không prune volume. Nếu bạn đã `git pull --ff-only` thủ công, chạy `bash scripts/server-start.sh` thay cho `server-update.sh` cũng được.

## 4. n8n workflow

Năm JSON nằm trong `n8n/`, có ID/versionId ổn định và `active:false`. **Chưa chạy import tự động.** Kiểm tra n8n ở `http://127.0.0.1:5678` ngay trên Mac mini. Các workflow 01/02 hiện vẫn chứa đường gọi Worker trực tiếp `:4311`; chưa phù hợp với nhiều desktop. Giữ chúng chưa Publish cho đến khi n8n chỉ đánh dấu job sẵn sàng và desktop Worker tự outbound claim. Workflow 04/05 cũng còn logic health/session kiểu cũ, cần refactor trước khi bật.

## 5. Cloudflare Tunnel — chỉ cấu hình sau khi auth hoàn thiện

Mẫu [central-api.example.yml](deploy/cloudflare/central-api.example.yml) định tuyến `automation-api.simi.vn` → `http://127.0.0.1:4300`; đây **không** phải xác nhận hostname đã tồn tại. Không trỏ tunnel vào API hiện tại: API mới chỉ có `AUTOMATION_TOKEN` chung và chưa cấp/revoke token riêng từng máy. Không expose MySQL, n8n hay Worker. Khi device auth và kiểm tra phân quyền đã xong, tạo named tunnel, DNS route và cấu hình theo [Cloudflare Tunnel cho macOS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/macos/). Giữ credential ngoài Git.

## 6. Bộ cài desktop Mac/Windows

**Chưa phát hành bộ cài theo kiến trúc mới.** Cần tách API/n8n/MySQL khỏi `apps/desktop`, thêm Server URL + đăng ký thiết bị + token riêng trong secure storage, và đổi Worker sang polling/claim outbound. Sau đó trên Mac Apple Silicon mới chạy `npm run install:all` và `npm run desktop:build:mac` để tạo `.dmg` trong `release/desktop/`, rồi kiểm tra cài/mở/profile/login/tray thực tế. [electron-builder hỗ trợ DMG arm64](https://www.electron.build/docs/architecture/); bản tải cho người khác còn cần ký/notarize phù hợp. Không coi file `.dmg` cũ nếu có là client nhiều máy.

## 7. Khi gặp sự cố / rollback

1. Chạy `bash scripts/server-status.sh` và `docker compose --env-file .env.server -f docker-compose.server.yml logs --tail=100 api n8n mysql`.
2. Giữ `DRY_RUN=true`; không bấm chạy thật khi API/DB/Worker chưa đồng bộ.
3. Nếu cập nhật code lỗi, ghi lại commit tốt trước đó (`git rev-parse HEAD`), dừng stack bằng `bash scripts/server-stop.sh`, chuyển code về commit tốt bằng một thao tác Git có chủ đích trên working tree sạch, rồi chạy `bash scripts/server-start.sh`. Không tự rollback schema đã có dữ liệu; cần khôi phục từ backup khi migration không tương thích.
4. Không dùng `docker compose down -v`; lệnh đó xóa volume dữ liệu.

## Việc còn thiếu trước khi vận hành đa máy

Migration worker/device/account/job; device registration + revoke; atomic claim theo worker; Worker polling outbound; n8n dispatch-only; UI kết nối Central API; build/test `.dmg` trên Mac mini; sau cùng mới mở Tunnel. Không có bước nào trong tài liệu này được phép hiểu là các phần đó đã hoàn tất.
