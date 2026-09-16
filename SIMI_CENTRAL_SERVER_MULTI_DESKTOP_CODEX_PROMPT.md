# SIMI Automation — Central Server + Multi Desktop Workers
## Master prompt for Codex

Hãy đọc toàn bộ source hiện tại trong project trước khi sửa. Không được viết lại từ đầu, không bịa schema/endpoint/workflow, không tạo mock data, không phá logic queue/idempotency/retry/UNKNOWN/DRY_RUN đang có.

Mục tiêu kiến trúc đã thay đổi và cần được áp dụng nhất quán:

```text
                    MAC MINI 24/7
                 CENTRAL SERVER
                        │
        ┌───────────────┼────────────────┐
        │               │                │
      MySQL            API              n8n
      Docker         Backend           Docker
                        │
                  Central Job Queue
                        │
                 HTTPS / WebSocket
                        │
        ┌───────────────┼────────────────┐
        │               │                │
        ▼               ▼                ▼
 Windows PC 1      Windows PC 2        Mac
 SIMI.exe          SIMI.exe            SIMI.app
    │                  │                  │
 Playwright         Playwright         Playwright
 Worker             Worker             Worker
    │                  │                  │
 FB01/FB02          FB03/FB04           FB05
```

Mac mini là server trung tâm 24/7.
Desktop app có thể cài trên nhiều máy.
Desktop app KHÔNG chạy MySQL/n8n/API riêng.
Mỗi desktop app chỉ gồm:
- Electron UI
- Playwright Worker
- Facebook profiles cục bộ
- Client kết nối Central API
- Local logs/device status

==================================================
1. PHÂN TÁCH SERVER VÀ DESKTOP CLIENT
==================================================

Tách kiến trúc thành 2 phần rõ ràng:

A. CENTRAL SERVER — chạy trên Mac mini

```text
server/
  api/
  n8n/
  db/
  docker/
```

Có thể giữ cấu trúc hiện tại nếu đổi folder gây rủi ro, nhưng logic phải rõ server/client.

Server chịu trách nhiệm:
- MySQL
- API
- job queue
- scheduling
- campaign
- posts
- comment templates
- worker registry
- account assignment
- n8n orchestration
- authentication
- audit log
- idempotency/locking
- retry policy

B. DESKTOP CLIENT

```text
apps/desktop/
apps/worker/
```

Desktop chịu trách nhiệm:
- UI
- đăng nhập Facebook local
- Playwright execution
- worker heartbeat
- nhận job từ server
- claim/execute/report
- local logs
- local Facebook profiles

Không chạy MySQL/n8n/API riêng trên desktop.

==================================================
2. CENTRAL SERVER TRÊN MAC MINI
==================================================

Mac mini production chạy 24/7:

```text
MySQL
API
n8n
Cloudflare Tunnel
```

Ưu tiên Docker Compose cho server services.

Ví dụ:

```text
docker-compose.server.yml
```

Services:
- mysql
- api
- n8n

Cloudflare Tunnel có thể chạy native hoặc container riêng.

Không public:
- MySQL
- n8n trực tiếp
- worker port

Chỉ public Central API qua Cloudflare Tunnel.

==================================================
3. CENTRAL API HOSTNAME
==================================================

Dùng hostname riêng, ví dụ:

```text
automation-api.simi.vn
```

hoặc nếu project đã dùng tên khác thì giữ naming hợp lý.

Cloudflare Tunnel route:

```text
automation-api.simi.vn
    ↓
http://127.0.0.1:4300
```

KHÔNG dùng public IP/port forwarding router.

Cloudflare Tunnel chỉ forward vào localhost Mac mini.

Ví dụ config:

```yaml
ingress:
  - hostname: automation-api.simi.vn
    service: http://127.0.0.1:4300
  - service: http_status:404
```

Nếu API chạy trong Docker và port host map 4300:4300 thì vẫn route:

```text
http://127.0.0.1:4300
```

Không expose MySQL 3306/3307 ra Internet.

==================================================
4. N8N
==================================================

n8n chỉ chạy trên Mac mini.

5 workflow hiện tại:

```text
01 Campaign Dispatcher
02 Manual Dispatcher
03 Failed Job Retry
04 Worker Watchdog
05 Session Check
```

Phải sửa flow để n8n KHÔNG gọi Browser Worker trực tiếp qua localhost:4311 nữa.

Flow mới:

```text
n8n
→ Central API
→ mark job READY_FOR_WORKER / dispatchable
→ assigned_worker_id
```

Desktop Worker tự nhận job qua Central API.

n8n không random comment.
n8n không mở browser.
n8n không biết IP máy worker.
n8n không gọi trực tiếp worker port.

==================================================
5. WORKER REGISTRY
==================================================

Bổ sung worker registry nếu chưa có.

Bảng gợi ý:

```text
workers
-----------------------------
id
worker_key
device_name
os
app_version
status
last_seen_at
current_job_id
is_enabled
created_at
updated_at
```

Status:

```text
ONLINE
OFFLINE
BUSY
DISABLED
ERROR
```

Desktop app đăng ký worker với server khi mở.

Ví dụ:

```json
{
  "workerKey": "pc-sale-01",
  "deviceName": "PC Kinh Doanh 01",
  "os": "windows",
  "appVersion": "1.0.0"
}
```

Heartbeat khoảng 15–30 giây.

Server đánh OFFLINE nếu heartbeat quá hạn.

==================================================
6. ACCOUNT GẮN VỚI WORKER
==================================================

Mỗi Facebook account phải biết đang nằm trên máy nào.

Ví dụ:

```text
Facebook SIMI 01
→ assigned_worker_id = PC-SALE-01
→ profile_key = simi_fb_01
```

Không lưu Facebook cookie/session trên Central Server.

Cookie/profile chỉ tồn tại trên đúng Desktop Worker.

Nếu worker offline:
- không dispatch job cho account đó;
- job không mất;
- UI báo "Máy thực thi đang ngoại tuyến".

==================================================
7. JOB DISPATCH MODEL
==================================================

Không để Central Server gọi inbound vào PC nhân viên.

Desktop Worker chủ động outbound tới server.

Ưu tiên phase đầu:

```text
Long polling / polling 3–5 giây
```

sau đó có thể nâng cấp WebSocket.

Flow:

```text
Desktop Worker
→ GET /api/worker/jobs/next
→ server atomically claim job cho worker
→ trả job
→ worker execute Playwright
→ POST result
```

Hoặc:

```text
POST /api/worker/jobs/claim-next
```

Phải atomic.

Không cho 2 worker claim cùng job.

==================================================
8. WEBSOCKET
==================================================

Nếu triển khai WebSocket:
- desktop tạo outbound WSS tới server;
- server push notification "job available";
- desktop vẫn phải gọi claim endpoint atomic;
- không coi WebSocket message là claim.

Fallback polling phải tồn tại nếu WebSocket mất kết nối.

==================================================
9. DEVICE AUTH
==================================================

Không bundle một AUTOMATION_TOKEN chung vào tất cả file .exe/.app.

Tạo cơ chế device registration.

Lần đầu:

```text
Desktop App
→ nhập activation code / đăng nhập admin
→ server cấp device token riêng
→ lưu secure storage
```

Mỗi máy có:
- worker_key
- device_token riêng

Server có thể revoke từng device.

Không cần đổi token toàn hệ thống khi một máy ngừng sử dụng.

==================================================
10. SECURE STORAGE
==================================================

Desktop không lưu device token plaintext nếu có thể tránh.

Dùng Electron safeStorage / OS keychain phù hợp.

Facebook session vẫn nằm trong persistent Playwright profile local.

Không gửi cookie Facebook lên server.

==================================================
11. CLOUDFLARE
==================================================

Cloudflare chỉ dùng cho Central API.

Mục tiêu:

```text
Desktop App
→ HTTPS
→ automation-api.simi.vn
→ Cloudflare Tunnel
→ Mac mini :4300
```

Không public:
- :3307 MySQL
- :5678 n8n
- :4311 Worker

Nếu muốn admin n8n từ xa, có thể tùy chọn:

```text
n8n.simi.vn
→ Cloudflare Access
→ 127.0.0.1:5678
```

nhưng đây là optional và admin-only.

Không bắt buộc desktop client đi qua Cloudflare Access browser login.
API phải có app/device authentication riêng.

==================================================
12. DESKTOP APP
==================================================

Build:

Windows:

```text
SIMI-Automation-Setup-x64.exe
```

macOS Apple Silicon:

```text
SIMI-Automation-arm64.dmg
```

Desktop UI có:

```text
Tổng quan
Bài viết
Tài khoản Facebook
Nội dung bình luận
Lịch chạy
Hàng chờ
Máy thực thi
Automation
Nhật ký
Cài đặt
```

==================================================
13. DESKTOP FIRST RUN
==================================================

Flow:

```text
Cài SIMI Automation
↓
Mở app
↓
Nhập Server URL
automation-api.simi.vn
↓
Đăng ký thiết bị
↓
Server cấp device token
↓
worker ONLINE
↓
Login Facebook account
↓
READY
```

Server URL mặc định có thể là:

```text
https://automation-api.simi.vn
```

nhưng phải configurable.

==================================================
14. FACEBOOK LOGIN LOCAL
==================================================

Desktop có:

```text
[Đăng nhập Facebook]
```

Flow:

```text
Electron
→ Playwright
→ mở browser local
→ user login
→ user bấm "Hoàn tất đăng nhập"
→ context.close()
→ save profile local
→ verify session
→ report READY về server
```

Không bắt user mở terminal.

==================================================
15. PROFILE STORAGE
==================================================

Windows:

```text
%APPDATA%/SIMI Automation/profiles/
```

macOS:

```text
~/Library/Application Support/SIMI Automation/profiles/
```

Dùng Electron:

```js
app.getPath('userData')
```

Không lưu profile trong app bundle.

==================================================
16. CENTRAL UI DATA
==================================================

Desktop UI lấy business data từ Central API:

- campaigns
- posts
- templates
- jobs
- workers
- accounts
- schedules
- history

Không giữ DB riêng trên desktop.

==================================================
17. MÁY THỰC THI
==================================================

Thêm page:

```text
Máy thực thi
```

Ví dụ:

```text
PC-KINH-DOANH-01    ● Online
Windows 11
App 1.0.0
2 tài khoản Facebook
Job hiện tại: #1034

PC-KINH-DOANH-02    ● Online
Windows 11
3 tài khoản Facebook
Đang rảnh

MAC-MINI-WORKER     ● Online
macOS
1 tài khoản Facebook
Đang rảnh
```

Actions:
- Disable worker
- Revoke device
- Rename
- xem accounts
- xem current job
- xem last heartbeat

==================================================
18. MAC MINI CŨNG CÓ THỂ LÀ WORKER
==================================================

Optional:

Mac mini có thể cài Desktop Worker riêng hoặc chạy worker service riêng.

Ví dụ:

```text
MAC-MINI-WORKER
```

để giữ một số account quan trọng chạy 24/7.

Nhưng Central Server và Worker logic phải tách biệt.

==================================================
19. NEXT JOB
==================================================

Desktop dashboard phải biết:

```text
Lần chạy tiếp theo
15:20
Facebook SIMI 01
UNIQ VIETNAM
"Nội dung đã chốt trước..."
Worker: PC-KINH-DOANH-01
```

Nếu worker offline:

```text
⚠ Máy thực thi đang ngoại tuyến
```

==================================================
20. JOB DETERMINISTIC
==================================================

Khi schedule phải chốt:

```text
account_id
assigned_worker_id
post_id
campaign_id
scheduled_at
template_id
comment_text snapshot
status
idempotency_key
```

n8n không random lại comment.

Worker không random comment.

==================================================
21. JOB STATE
==================================================

Giữ state machine chặt:

```text
PENDING
READY_FOR_WORKER
RUNNING
SUCCESS
FAILED
UNKNOWN
PAUSED
CANCELLED
```

UNKNOWN không auto retry.

SUCCESS không execute lại.

Claim phải atomic.

==================================================
22. OFFLINE WORKER
==================================================

Nếu Worker OFFLINE:
- không mark FAILED;
- job giữ nguyên;
- UI báo waiting for worker;
- khi worker ONLINE lại thì có thể tiếp tục.

Không auto chuyển job sang worker khác nếu Facebook profile không tồn tại trên máy khác.

==================================================
23. API ENDPOINTS
==================================================

Audit endpoint hiện tại trước.

Có thể bổ sung:

```text
POST /api/devices/register
POST /api/devices/activate
POST /api/workers/heartbeat

POST /api/worker/jobs/claim-next
POST /api/worker/jobs/:id/progress
POST /api/worker/jobs/:id/result

GET /api/workers
GET /api/workers/:id
GET /api/jobs/upcoming
```

Tên endpoint có thể khác nếu source hiện tại có convention riêng.

Không tạo duplicate endpoint vô nghĩa.

==================================================
24. API BASE URL DESKTOP
==================================================

Desktop không gọi localhost API.

Production desktop gọi:

```text
https://automation-api.simi.vn
```

Dev có thể dùng:

```text
http://127.0.0.1:4300
```

Tạo config rõ:

```text
SERVER_URL
```

Không hard-code rải rác.

==================================================
25. SERVER DEPLOYMENT
==================================================

Tạo script cho Mac mini:

```text
scripts/server-install-mac.sh
scripts/server-start.sh
scripts/server-stop.sh
scripts/server-update.sh
scripts/server-status.sh
```

server-update.sh phải:

```text
git fetch
git pull --ff-only
npm install / docker build nếu cần
run migrations
restart server services an toàn
health check
```

Không xóa DB.
Không reset volume.
Không prune volume.

==================================================
26. GIT DEPLOY FLOW
==================================================

Development:

```text
Windows/Dev
→ git commit
→ git push
```

Mac mini:

```text
cd ~/Desktop/TOOL-TEST
git pull --ff-only
./scripts/server-update.sh
```

Hoặc `server-update.sh` tự pull nếu thiết kế như vậy.

Không build production bằng copy thủ công từng file.

==================================================
27. DATABASE MIGRATION
==================================================

Mọi schema change:
- migration mới;
- idempotent nếu phù hợp;
- không sửa destructive init.sql cho DB đang chạy;
- không drop data.

Migration cần cho:
- workers
- device auth
- account-worker assignment
- job assigned_worker_id
- heartbeat fields
- indexes

==================================================
28. N8N WORKFLOW IMPORT
==================================================

Fix lỗi workflow_entity.id hiện tại.

Workflow JSON:
- stable id;
- stable version metadata phù hợp;
- không random mỗi import.

Không hack SQLite.

Có script:

```text
scripts/setup-n8n.sh
```

để:
- kiểm tra n8n container;
- kiểm tra 5 workflow;
- import nếu cần;
- không tạo duplicate nếu có thể;
- báo trạng thái rõ.

==================================================
29. SERVER HEALTH
==================================================

Có endpoint:

```text
GET /health
```

response tối thiểu:

```json
{
  "ok": true,
  "database": true,
  "n8n": true,
  "version": "..."
}
```

Có worker stats nếu cần.

==================================================
30. DESKTOP CONNECTION STATUS
==================================================

Desktop header:

```text
Server      ● Online
Worker      ● Online
Facebook    ● Ready
```

Nếu mất Internet/server:
- app không crash;
- queue UI read-only nếu cần;
- worker không tự thực thi job chưa claim;
- reconnect exponential backoff.

==================================================
31. SECURITY
==================================================

Central API:
- validate input;
- rate limit auth endpoints;
- device token;
- revoke support;
- audit device actions.

Không trust worker-supplied account_id tùy ý.
Server phải verify worker được phép execute account đó.

==================================================
32. LIVE SAFETY
==================================================

Giữ:
- DRY_RUN
- LIVE mode
- idempotency
- duplicate protection
- UNKNOWN
- cooldown
- account daily limit
- post lock
- retry rules

Không tự chuyển tất cả sang LIVE trong migration.

==================================================
33. PERFORMANCE
==================================================

Desktop không polling toàn app.

Gợi ý:
- heartbeat: 15–30s
- job claim polling fallback: 3–5s
- dashboard: 10–15s
- system status: 30s
- countdown local

TanStack Query nếu phù hợp.

==================================================
34. SERVER N8N KHÔNG PHỤ THUỘC DESKTOP UI
==================================================

Nếu desktop app đóng:
- Central Server vẫn chạy;
- n8n vẫn chạy;
- MySQL vẫn chạy;
- jobs không mất.

Nếu một worker khác online thì worker đó vẫn hoạt động.

==================================================
35. BUILD OUTPUT
==================================================

Windows:

```text
dist-desktop/
SIMI-Automation-Setup-x64.exe
```

Mac:

```text
dist-desktop/
SIMI-Automation-arm64.dmg
```

Không bundle Central Server vào desktop installer.

==================================================
36. CLOUDFLARE FILE
==================================================

Tạo:

```text
deploy/cloudflare/central-api.example.yml
```

Ví dụ:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/simi/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: automation-api.simi.vn
    service: http://127.0.0.1:4300
  - service: http_status:404
```

Không hard-code tunnel credential thật vào Git.

==================================================
37. CLOUDFLARE DNS/TUNNEL DOCUMENTATION
==================================================

Tạo:

```text
HUONG_DAN_SERVER_MAC_MINI.md
```

Bao gồm:

1. git clone/pull
2. env
3. Docker
4. MySQL
5. n8n
6. migration
7. API
8. Cloudflare Tunnel
9. hostname mapping
10. health checks
11. update/rollback

Cloudflare service phải map:

```text
automation-api.simi.vn
→ http://127.0.0.1:4300
```

==================================================
38. ENV SPLIT
==================================================

Tách env rõ:

Server:

```text
.env.server
```

Desktop:

```text
.env.desktop.example
```

Không commit secret thật.

Desktop installer không chứa DB password.

==================================================
39. SERVER STARTUP
==================================================

Mac boot:

```text
Docker Desktop
↓
MySQL + n8n + API
↓
Cloudflare Tunnel
↓
Central Server ONLINE
```

Tạo setup/autostart hợp lý.

Không phụ thuộc Terminal mở.

==================================================
40. ACCEPTANCE CRITERIA
==================================================

Chỉ coi là đạt khi:

```text
✅ Mac mini chạy MySQL/API/n8n 24/7
✅ API chỉ public qua Cloudflare Tunnel
✅ MySQL không public
✅ n8n không public hoặc chỉ admin-protected
✅ Desktop Windows kết nối được server
✅ Desktop Mac kết nối được server
✅ Mỗi desktop đăng ký thành worker riêng
✅ Worker heartbeat cập nhật
✅ Worker offline được phát hiện
✅ Facebook account gắn đúng worker
✅ Job không được cấp cho worker sai
✅ Claim atomic
✅ Không duplicate comment
✅ n8n không gọi worker trực tiếp
✅ n8n không random comment
✅ Desktop Worker tự nhận job outbound
✅ Device token có thể revoke
✅ Facebook profile chỉ nằm local
✅ Git pull + server-update trên Mac hoạt động
✅ Cloudflare route hostname → 127.0.0.1:4300 hoạt động
```

==================================================
41. PHASE IMPLEMENTATION
==================================================

PHASE 1
Audit current architecture

PHASE 2
Central Server worker registry + device auth

PHASE 3
Account → worker assignment

PHASE 4
Outbound worker claim/heartbeat API

PHASE 5
Refactor n8n to central dispatch only

PHASE 6
Desktop client connects Central API

PHASE 7
Facebook login/profile local

PHASE 8
Worker execution/progress/result

PHASE 9
Cloudflare Tunnel production config

PHASE 10
Mac server scripts + git deployment

PHASE 11
Windows/macOS installer

Không nhảy phase nếu phase trước chưa test.

==================================================
42. BÁO CÁO CUỐI
==================================================

Phải báo:

```text
FILES ADDED
FILES CHANGED
MIGRATIONS
API ENDPOINTS
DB TABLES/FIELDS
N8N CHANGES
DESKTOP CHANGES
DEVICE AUTH
WORKER HEARTBEAT
JOB CLAIM FLOW
CLOUDFLARE CONFIG
MAC SERVER DEPLOY COMMANDS
GIT UPDATE COMMANDS
WINDOWS BUILD COMMAND
MAC BUILD COMMAND
TESTS RUN
TESTS NOT RUN
KNOWN ISSUES
ROLLBACK
```

Không được chỉ nói "done".

==================================================
43. QUY TRÌNH DEPLOY MONG MUỐN
==================================================

Dev:

```bash
git add .
git commit -m "..."
git push
```

Mac mini:

```bash
cd ~/Desktop/TOOL-TEST
git pull --ff-only
./scripts/server-update.sh
```

Cloudflare:

```text
automation-api.simi.vn
→ Tunnel
→ 127.0.0.1:4300
```

Desktop Windows/Mac:

```text
SIMI Automation
→ https://automation-api.simi.vn
→ register worker
→ heartbeat
→ claim job
→ Playwright
→ Facebook
→ report result
```

Đây là kiến trúc cuối cùng cần triển khai.
