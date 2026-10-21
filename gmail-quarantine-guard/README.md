# 🛡 Webmail Quarantine Guard — Gmail Edition

**Microsoft Edge Extension (Manifest V3)** để phát hiện, cảnh báo và cách ly email ngoài danh sách Whitelist trên Gmail.

---

## Cấu trúc thư mục

```
gmail-quarantine-guard/
├── manifest.json                  # Manifest V3 — điểm vào của extension
├── background/
│   └── service-worker.js          # Quản lý Storage Whitelist & Chrome Notifications
├── src/
│   ├── core/                      # [REUSABLE CORE] — tái sử dụng 90% cho Webmail khác
│   │   ├── domain-validator.js    # Kiểm tra email vs Whitelist (có hỗ trợ subdomain)
│   │   ├── content-sanitizer.js   # Khử độc HTML: Safe HTML + Plain Text + Link Extractor
│   │   ├── quarantine-ui.js       # Decision Modal + Sandbox Viewer + Shield Overlay
│   │   └── orchestrator.js        # Bộ điều phối trung tâm (Observer + Strategy pattern)
│   ├── adapters/
│   │   └── gmail.adapter.js       # Gmail DOM selectors & automation (thay khi đổi platform)
│   └── main.js                    # Entry point — bootstrap Orchestrator + GmailAdapter
├── styles/
│   └── quarantine.css             # Dark mode glassmorphism UI
├── popup/
│   ├── popup.html                 # Whitelist manager UI
│   └── popup.js                   # Thêm/xóa domain logic
└── icons/
    ├── icon16.svg
    ├── icon48.svg
    └── icon128.svg
```

---

## Cài đặt vào Microsoft Edge

1. Mở Edge → Điều hướng tới `edge://extensions/`
2. Bật **Chế độ nhà phát triển** (Developer mode) — góc dưới trái
3. Nhấn **Tải tiện ích đã giải nén** (Load unpacked)
4. Chọn thư mục `gmail-quarantine-guard/`
5. Extension sẽ xuất hiện với icon 🛡 trên thanh công cụ

---

## Tính năng

### 1. Pre-open Quarantine (Tại Inbox)
- Quét hàng email `tr.zA`, đọc attribute `[email]` của người gửi
- Email từ domain ngoài Whitelist → tô đỏ hàng + gắn badge `⚠ EXTERNAL`
- Gửi Chrome System Notification
- Chặn click → hiện **Decision Modal** với 3 lựa chọn:
  - 🛡 Xem trong Sandbox (khuyến nghị)
  - ⚠️ Vẫn mở (chấp nhận rủi ro)
  - 🗑 Xóa thư

### 2. Sandbox Viewer
- **Sanitized HTML**: Loại bỏ script/link/ảnh nhưng giữ bố cục bảng
- **Plain Text**: Văn bản thuần túy không có thẻ HTML
- **Link Extractor**: Danh sách URL + phát hiện URL nghi ngờ

### 3. Post-open Shield (Tại màn hình Đọc thư)
- Tự động phủ **Shield Overlay** lên `.a3s.aiL` (nội dung) và `.hq.gt` (đính kèm)
- Người dùng phải xác nhận trước khi xem nội dung thật

### 4. Popup — Quản lý Whitelist
- Thêm/xóa domain với validation
- Domain mặc định `google.com` được bảo vệ (không xóa được)
- Thay đổi có hiệu lực tức thì nhờ `chrome.storage.onChanged`

---

## Mở rộng sang Webmail khác

Chỉ cần tạo một file Adapter mới (ví dụ: `src/adapters/outlook.adapter.js`) triển khai đúng interface:

```javascript
class OutlookAdapter {
  get name() { return 'OutlookAdapter'; }
  get contentAreaSelector() { return '.ReadingPaneContent'; }
  getInboxRows() { ... }
  getSenderFromRow(row) { ... }
  // ... các phương thức khác
}
```

Sau đó trong `main.js`, thay:
```javascript
const adapter = new window.MailGuard.OutlookAdapter();
```

90% mã nguồn (core/) được tái sử dụng hoàn toàn.

---

## Whitelist mặc định

- `google.com` (và mọi subdomain như `mail.google.com`)
- Lưu trong `chrome.storage.local`
- Quản lý qua Popup UI hoặc DevTools Console: `MailGuard._orchestrator.validator.getWhitelist()`
