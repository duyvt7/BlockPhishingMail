/**
 * @file main.js
 * @description Điểm khởi chạy của Extension.
 *
 * Vai trò: Khởi tạo GmailAdapter và Orchestrator, sau đó gọi init().
 * File này là "glue code" kết nối mọi thứ lại với nhau.
 *
 * Thứ tự khởi chạy (đảm bảo bởi manifest.json content_scripts):
 *   1. domain-validator.js    → window.MailGuard.DomainValidator
 *   2. content-sanitizer.js   → window.MailGuard.ContentSanitizer
 *   3. quarantine-ui.js       → window.MailGuard.QuarantineUI
 *   4. orchestrator.js        → window.MailGuard.Orchestrator
 *   5. gmail.adapter.js       → window.MailGuard.GmailAdapter
 *   6. main.js                → Khởi tạo và chạy
 */

(function (global) {
  'use strict';

  /**
   * Hàm khởi tạo chính.
   * Được bọc trong IIFE để không gây ô nhiễm global scope.
   */
  async function bootstrap() {
    // Kiểm tra xem đang chạy trên đúng trang Gmail không
    if (!window.location.hostname.includes('mail.google.com')) {
      console.warn('[QuarantineGuard] Không phải trang Gmail. Bỏ qua khởi tạo.');
      return;
    }

    // Kiểm tra tất cả các module đã được tải chưa
    const requiredModules = [
      'DomainValidator',
      'ContentSanitizer',
      'QuarantineUI',
      'Orchestrator',
      'GmailAdapter',
    ];

    const missing = requiredModules.filter((m) => !global.MailGuard?.[m]);
    if (missing.length > 0) {
      console.error('[QuarantineGuard] Thiếu các module:', missing.join(', '));
      return;
    }

    try {
      // Tạo Adapter cho Gmail
      const gmailAdapter = new global.MailGuard.GmailAdapter();

      // Tạo Orchestrator với Adapter
      const orchestrator = new global.MailGuard.Orchestrator(gmailAdapter);

      // Khởi tạo — tải Whitelist và bắt đầu quan sát DOM
      await orchestrator.init();

      // Lưu instance vào namespace để debug từ console
      global.MailGuard._orchestrator = orchestrator;

      console.log(
        '%c[QuarantineGuard] Đã khởi động thành công! 🛡',
        'color: #22c55e; font-weight: bold; font-size: 14px;'
      );
      console.log(
        '[QuarantineGuard] Whitelist hiện tại:',
        orchestrator.validator.getWhitelist()
      );

    } catch (err) {
      console.error('[QuarantineGuard] Lỗi nghiêm trọng khi khởi động:', err);
    }
  }

  // Đợi Gmail DOM được load hoàn toàn trước khi chạy
  // Gmail là SPA, nên document.readyState thường đã là 'complete' khi content script chạy
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    // DOM đã sẵn sàng, nhưng Gmail có thể vẫn đang khởi tạo
    // Dùng setTimeout nhỏ để đảm bảo Gmail đã render xong cấu trúc ban đầu
    setTimeout(bootstrap, 500);
  }

})(window);
