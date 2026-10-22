# INCREMENTAL UPGRADE PLAN: Tái sử dụng Core từ bản Gmail và Mở rộng thêm POSCO Webmail Adapter

## 1. NGUYÊN TẮC THỰC THI BẮT BUỘC DÀNH CHO AI (STRICT REUSABILITY RULES)
Dự án hiện tại ĐÃ CÓ SẴN mã nguồn hoạt động cho bản Gmail. Yêu cầu AI tuyệt đối tuân thủ nguyên tắc **Tái sử dụng (Code Reuse)**:
1. **GIỮ NGUYÊN (DO NOT REWRITE):** Tuyệt đối KHÔNG viết lại từ đầu các module dùng chung đã có:
   - `src/core/content-sanitizer.js` (Giữ nguyên bộ máy khử độc HTML/Plain Text, chỉ thêm 1 dòng kiểm tra đuôi `.pdf` và giao thức `fastdown:`/`fexdown:` nếu chưa có).
   - `src/core/quarantine-ui.js` (Giữ nguyên 100% giao diện Modal 3 lựa chọn, Buồng đọc cách ly và Lớp khiên khóa chuột).
   - `src/adapters/adapter.interface.js` (Giữ nguyên).
   - `src/adapters/gmail.adapter.js` (GIỮ NGUYÊN KHÔNG XÓA để Extension vẫn chạy được trên Gmail ở máy cá nhân).
   - `styles/quarantine.css` (Giữ nguyên).
   - `popup/popup.html`, `popup/popup.css`, `popup/popup.js` (Giữ nguyên giao diện và logic đã viết, chỉ cập nhật danh sách domain mặc định).
2. **CHỈ TẠO MỚI 1 FILE DUY NHẤT:**
   - `src/adapters/posco.adapter.js` (Triển khai bộ kết nối DOM riêng cho POSCO Webmail dựa trên cùng Interface với `gmail.adapter.js`).
3. **CHỈ CẬP NHẬT NHẸ (PATCH/EXTEND) CÁC FILE CẤU HÌNH:**
   - `manifest.json`: Thêm quyền truy cập domain POSCO và nạp thêm file `posco.adapter.js` bên cạnh `gmail.adapter.js`.
   - `background/service-worker.js` & `src/core/storage-manager.js`: Bổ sung các domain của POSCO vào mảng Whitelist mặc định.
   - `src/core/domain-validator.js`: Thêm 1 điều kiện nhận diện dải IP nội bộ POSCO (`172.*.*.*`, `169.140.*.*`).
   - `src/main.js` & `src/core/orchestrator.js`: Tự động nhận diện trang web đang mở (`location.hostname`) — nếu là `mail.google.com` thì dùng `GmailAdapter`, nếu là hệ thống POSCO (`.nsf` / `posco`) thì dùng `PoscoAdapter`.

---

## 2. BẢNG PHÂN CÔNG TÁI SỬ DỤNG & CẬP NHẬT (MODIFICATION MATRIX)

| Tên file trong dự án hiện tại | Hành động | Nội dung giữ lại & Nội dung thêm vào |
| :--- | :--- | :--- |
| `src/core/quarantine-ui.js` | 🔒 **GIỮ NGUYÊN 100%** | Dùng lại toàn bộ hàm vẽ Badge, Modal 3 lựa chọn, Sandbox Viewer & Detail Shield. |
| `src/adapters/gmail.adapter.js` | 🔒 **GIỮ NGUYÊN 100%** | Giữ nguyên để tiếp tục sử dụng và kiểm thử trên Gmail. |
| `styles/quarantine.css` | 🔒 **GIỮ NGUYÊN 100%** | Dùng lại toàn bộ CSS hiện có. |
| `src/core/content-sanitizer.js` | ➕ **Mở rộng nhẹ** | Giữ nguyên hàm khử độc cũ. Chỉ bổ sung nhận diện giao thức nội bộ POSCO (`fssoexcast:`, `fastdown:`, `fexdown:`, `n3ae00-front:`, `m8a-jnlp:`) và cảnh báo link `.pdf` (do policy `AlwaysOpenPdfExternally`). |
| `src/core/domain-validator.js` | ➕ **Mở rộng nhẹ** | Giữ nguyên hàm kiểm tra domain cũ. Chỉ thêm kiểm tra Regex cho 2 dải IP nội bộ: `/^172\.\d+\.\d+\.\d+$/` và `/^169\.140\.\d+\.\d+$/`. |
| `src/core/storage-manager.js` & `background/service-worker.js` | ➕ **Cập nhật hằng số** | Giữ nguyên các hàm đọc/ghi `chrome.storage.local` (đảm bảo không dùng `window.localStorage` vì policy `ClearBrowsingDataOnExit: true`). Cập nhật mảng `DEFAULT_WHITELIST` thành: `["google.com", "posco.vn", "posco.net", "posco.com", "posco.co.kr", "poscoway.net", "steel-n.com", "postown.net", "easythanks-planet.com"]`. |
| `manifest.json` | 🔧 **Bổ sung cấu hình** | Giữ nguyên cấu hình cho `mail.google.com`. Thêm các domain POSCO vào `host_permissions` và `matches`, thêm `"all_frames": true`, và chèn `"src/adapters/posco.adapter.js"` vào mảng `js`. |
| `src/core/orchestrator.js` & `src/main.js` | 🔧 **Nâng cấp bộ chọn Adapter** | Trong `main.js`: Kiểm tra `if (location.hostname.includes('google.com'))` -> khởi tạo `new GmailAdapter()`, ngược lại khởi tạo `new PoscoAdapter()`. Trong `orchestrator.js`: Hỗ trợ `await this.adapter.extractRowData(row)` để tương thích với cả hàm đồng bộ (Gmail) và bất đồng bộ (POSCO). |
| `src/adapters/posco.adapter.js` | 🆕 **TẠO MỚI HOÀN TOÀN** | File mới duy nhất cần viết đầy đủ để nối dữ liệu của POSCO Webmail vào `orchestrator.js` cũ. |

---

## 3. ĐẶC TẢ CHI TIẾT CHO FILE MỚI DUY NHẤT: `src/adapters/posco.adapter.js`

Hãy viết file `src/adapters/posco.adapter.js` tuân thủ **chính xác tên các hàm (Method Signatures)** mà `gmail.adapter.js` và `orchestrator.js` hiện tại đang sử dụng, để khi cắm vào `Orchestrator` thì mọi tính năng Modal, Khử độc, Cách ly của Core tự động chạy ngay lập tức:

### 3.1. `getInboxRows()`
- Trả về danh sách các dòng thư trong bảng Inbox của POSCO:
  `Array.from(document.querySelectorAll('table#mailList_inbox tbody tr')).filter(tr => tr.querySelector('input[type="checkbox"][name]'))`

### 3.2. `async extractRowData(row)`
Phải trả về một Object có cấu trúc các trường (fields) **giống hệt** như `gmail.adapter.js` trả về để `orchestrator.js` và `quarantine-ui.js` hiểu được:
- **Lấy `id` (`docId`):** `row.querySelector('input[type="checkbox"][name]')?.getAttribute('name')` (Ví dụ: `C786CFD2B643E77D49258E8A000A8B45`).
- **Lấy `subject`:** Từ `row.querySelector('td.subject a')?.getAttribute('title') || row.querySelector('td.subject a')?.innerText.trim()`.
- **Kiểm tra biểu tượng nhóm nội bộ (`ico-gr`):** `const hasInternalGrIcon = !!row.querySelector('td.ico-gr');` (Biểu tượng chữ `Gr` / `그룹`).
- **Lấy `senderName` / `senderEmail`:**
  - Đọc text ở cột người gửi: `const senderCellText = row.querySelector('td.tLft span.td-name')?.innerText.trim() || '';`
  - **Cơ chế Quét ngầm (Background Fetch có Cache theo `id`):**
    1. Tách đường dẫn `.nsf` (ví dụ `/363/mail4/202154.nsf`) từ thuộc tính `onclick="btn_OnClick('/363/mail4/202154.nsf','C786...', '', this)"` của thẻ `<a>` tiêu đề (hoặc từ `location.pathname`).
    2. Gọi `fetch(`${location.origin}${nsfPath}/0/${id}?OpenDocument`, { credentials: 'include' })` và lưu kết quả vào `this.cache.set(id, data)` để mỗi dòng chỉ tải ngầm đúng 1 lần.
    3. Trong mã HTML trả về từ `fetch`:
       - Tìm địa chỉ email người gửi quanh vùng `id="write_send_info"`, `_form.getFromDisplayInfo()`, hoặc chuỗi `<email@domain.com>` bằng Regex `/<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/`.
       - Trích xuất phần nội dung HTML trong `div.write-content` gán vào thuộc tính `snippet` / `rawHtml` trả về cho `Orchestrator` (nhờ vậy hộp thoại "Đọc nội dung cách ly" đã có sẵn của Core sẽ hiển thị được toàn bộ nội dung thư ngay ngoài Inbox!).
    4. **Dự phòng an toàn (Fallback):**
       - Nếu `senderCellText` ngoài Inbox đã có dạng `@domain` (như `antispam@posco.com`), dùng trực tiếp địa chỉ đó.
       - Nếu có biểu tượng nội bộ `hasInternalGrIcon === true` (`td.ico-gr`), gán `senderEmail = "internal@posco.net"`.
       - Nếu không có biểu tượng `td.ico-gr` và chưa lấy được đuôi email qua fetch, gán `senderEmail = "unverified@external.mail"` để kích hoạt cơ chế cách ly hỏi người dùng của Core.

### 3.3. Chặn và Khôi phục sự kiện mở thư (`getRowClickTargets(row)` / `lockRow` / `openRowNormally(row)`)
- Trên dòng thư của POSCO, sự kiện mở thư nằm trong thuộc tính inline `onclick="btn_OnClick(...)"`, `ondblclick="btn_OnDbClick(...)"` của thẻ `td.subject a` và nút `a.btn_newwin[onclick*="opendoc"]`.
- Khi dòng thư bị Core đánh dấu cách ly:
  - Lưu `onclick` và `ondblclick` gốc vào `el.dataset.origOnclick` / `el.dataset.origOndblclick` rồi gọi `el.removeAttribute('onclick')` và `el.removeAttribute('ondblclick')` để khóa cứng không cho trang web tự mở thư.
- Khi người dùng bấm nút **"✅ Là Email Công việc (Mở bình thường)"** trên Modal (gọi `openRowNormally(row)`):
  - Khôi phục lại `onclick` và `ondblclick` từ `dataset`, sau đó gọi `.click()` vào link tiêu đề để mở thư.

### 3.4. Nhận diện Màn hình Đọc Chi Tiết (`getOpenDetailView()`)
- Tìm khung nội dung thư: `const bodyElement = document.querySelector('div.write-content');`
- Tìm vùng người gửi: `const sendInfo = document.querySelector('div#write_send_info');`
- Tìm vùng đính kèm: `const attachmentElement = document.querySelector('div#attach_layer');`
- Nếu `bodyElement` và `sendInfo` tồn tại: trích xuất địa chỉ email từ `sendInfo.innerText` (ví dụ `"Nguyen Ngoc Tram Anh <anh.nnt@posco.net>"`) và trả về đúng cấu trúc Object mà hàm `processDetailView()` trong `orchestrator.js` đang dùng để kích hoạt lớp khiên `applyDetailViewShield` sẵn có!

### 3.5. Tự động hóa Báo cáo Phishing (`reportPhishingFromInbox(row)` & `reportPhishingFromDetail()`)
- Khi người dùng bấm nút **"🚨 Xác nhận Phishing"** trên Modal sẵn có của Core:
  1. Bỏ tích tất cả các checkbox khác trong `table#mailList_inbox input[type="checkbox"]:checked`.
  2. Tích chọn đúng checkbox của dòng thư hiện tại (`row.querySelector('input[type="checkbox"]')`).
  3. Tìm nút có chữ `Spam Center` trên thanh công cụ và gọi `.click()`.
  4. Đợi hộp thoại `Spam Center` hiện ra (tối đa 3 giây), tự động tích chọn nút radio thứ 2 (`Delete Spam & Rules & Report`) và làm nổi bật nút `OK` (hoặc tự động bấm `OK` nếu cài đặt cho phép).

---

## 4. HƯỚNG DẪN THỰC THI CHO ANTIGRAVITY
1. Kiểm tra các file hiện có trong workspace. **Giữ nguyên toàn bộ code đang chạy tốt của các module Core, UI, CSS, Popup và GmailAdapter.**
2. Tạo mới file `src/adapters/posco.adapter.js` khớp 100% với cấu trúc gọi hàm của `orchestrator.js` hiện tại.
3. Thực hiện các chỉnh sửa nhỏ (patch) trên `manifest.json`, `storage-manager.js`, `domain-validator.js`, `content-sanitizer.js`, `orchestrator.js` và `main.js` theo đúng Bảng phân công ở Mục 2.