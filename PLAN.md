# IMPLEMENTATION PLAN: Modular Webmail Quarantine Guard (Gmail Edition - Edge Manifest V3)

## 1. Mục tiêu kiến trúc (Architectural Goals)
Xây dựng một Microsoft Edge Extension (Manifest V3) để phát hiện, cảnh báo và cách ly email ngoài danh sách Whitelist trên **Gmail (`https://mail.google.com/*`)**, với mục tiêu cốt lõi là **Thiết kế dạng Module hóa (Modular Architecture - Adapter Pattern)** để có thể tái sử dụng 90% mã nguồn cho các hệ thống Webmail nội bộ doanh nghiệp trong tương lai.

- **Whitelist mặc định ban đầu:** `["google.com"]` (Lưu trong `chrome.storage.local`, cho phép thêm/xóa qua Popup UI). Mọi email có domain khác `@google.com` đều bị coi là External Mail.
- **Chiến lược Cách ly Kép (Dual Quarantine Strategy):**
  1. **Tại danh sách Inbox (Pre-open Quarantine):** Quét các dòng thư (`tr.zA`), đọc thuộc tính `[email]`. Nếu là mail ngoài: tô màu cảnh báo dòng thư, gắn nhãn `[EXTERNAL - QUARANTined]`, gửi System Notification, và chặn sự kiện click mở thư trực tiếp để bật Hộp thoại Hỏi ý kiến (Decision Modal).
  2. **Tại màn hình Đọc thư & Khung Cách ly (Sanitized HTML + Plain Text + Post-open Shield):** 
     - Hỗ trợ xem nội dung trong Sandbox (Phương án kết hợp: Cho phép chuyển đổi giữa chế độ **Sanitized HTML** đã gỡ bỏ link/script/ảnh/tệp đính kèm nhưng giữ bố cục bảng biểu VÀ chế độ **Plain Text** thuần túy).
     - Nếu thư được mở ra ở màn hình chi tiết của Gmail, lập tức phủ lớp khiên khóa (UI Shield Overlay) lên vùng nội dung (`.a3s.aiL`) và vùng đính kèm (`.hq.gt`) cho đến khi người dùng xác nhận an toàn.

---

## 2. Cấu trúc thư mục dự án (Modular Directory Structure)
Hãy khởi tạo đầy đủ toàn bộ các file theo đúng cấu trúc cây thư mục sau (không dùng bundler phức tạp, load các module theo thứ tự trong `manifest.json` thông qua namespace chung `window.MailGuard`):

```text
gmail-quarantine-guard/
├── manifest.json
├── background/
│   └── service-worker.js          # Quản lý Storage Whitelist & Chrome Notifications
├── src/
│   ├── core/                      # [REUSABLE CORE] - Giữ nguyên cho mọi dự án tương lai
│   │   ├── domain-validator.js    # Kiểm tra email thuộc Whitelist hay External
│   │   ├── content-sanitizer.js   # Bộ lọc khử độc HTML (Safe HTML + Plain Text + Link Extractor)
│   │   ├── quarantine-ui.js       # Render Modal 3 lựa chọn, Sandbox Viewer & UI Shield
│   │   └── orchestrator.js        # Bộ điều phối trung tâm kết nối Adapter với Core
│   ├── adapters/                  # [PLATFORM ADAPTER] - Thay thế khi đổi sang Webmail khác
│   │   └── gmail.adapter.js       # Chứa DOM Selectors và hành động tự động hóa riêng cho Gmail
│   └── main.js                    # Điểm khởi chạy (Khởi tạo Orchestrator với GmailAdapter)
├── styles/
│   └── quarantine.css             # Giao diện Modal, Badge, Row Highlight và Shield
└── popup/
    ├── popup.html                 # Giao diện quản lý danh sách Whitelist Domains
    └── popup.js                   # Logic thêm/xóa domain trong chrome.storage.local