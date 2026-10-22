# FINAL IMPLEMENTATION & MIGRATION PLAN: POSCO Webmail Quarantine Guard (Enterprise Edge Policy Compliant)

## 1. MỤC TIÊU CẬP NHẬT (OBJECTIVES)
Chuyển đổi và nâng cấp Extension từ bản thử nghiệm sang bản chính thức dành riêng cho hệ thống **Webmail nội bộ POSCO (HCL Domino `.nsf`)**, tuân thủ tuyệt đối các chính sách bảo mật trình duyệt (**Microsoft Edge Enterprise Policies**) trên máy trạm của POSCO.

- **Nguyên tắc:** Tận dụng lại cấu trúc Modular (`src/core/`, `src/adapters/`, `popup/`, `styles/`), cập nhật danh sách Whitelist theo đúng hệ sinh thái POSCO và bổ sung các cơ chế tương thích với `edge://policy` của thiết bị.

---

## 2. THÔNG SỐ CẤU HÌNH THEO MICROSOFT EDGE POLICIES CỦA POSCO

### 2.1. Danh sách Whitelist Domains Mặc định (`DEFAULT_WHITELIST_DOMAINS`)
Trích xuất trực tiếp từ `LegacySameSiteCookieBehaviorEnabledForDomainList` và `OverrideSecurityRestrictionsOnInsecureOrigin` của POSCO:
```javascript
const DEFAULT_WHITELIST_DOMAINS = [
  "posco.vn",
  "posco.net",
  "posco.com",
  "posco.co.kr",
  "poscoway.net",
  "steel-n.com",
  "postown.net",
  "easythanks-planet.com"
];