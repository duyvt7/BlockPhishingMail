/**
 * @file main.js
 * @description Điểm khởi chạy của Extension.
 *
 * Vai trò: Tự động nhận diện nền tảng Webmail (Gmail hoặc POSCO) dựa trên URL,
 * khởi tạo Adapter phù hợp và truyền vào Orchestrator.
 *
 * Thứ tự khởi chạy (đảm bảo bởi manifest.json content_scripts):
 *   1. domain-validator.js    → window.MailGuard.DomainValidator
 *   2. content-sanitizer.js   → window.MailGuard.ContentSanitizer
 *   3. quarantine-ui.js       → window.MailGuard.QuarantineUI
 *   4. orchestrator.js        → window.MailGuard.Orchestrator
 *   5. gmail.adapter.js       → window.MailGuard.GmailAdapter     (chỉ trên Gmail)
 *      HOẶC posco.adapter.js  → window.MailGuard.PoscoAdapter     (chỉ trên POSCO)
 *   6. main.js                → Khởi tạo và chạy
 */

(function (global) {
  'use strict';

  /**
   * Nhận diện nền tảng Webmail dựa trên URL hiện tại.
   * @returns {'gmail'|'posco'|null}
   */
  function detectPlatform() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    const href = window.location.href;

    // Gmail
    if (hostname.includes('mail.google.com')) {
      return 'gmail';
    }

    // POSCO Webmail: URL chứa .nsf, hoặc hostname chứa 'posco', hoặc thuộc dải IP nội bộ
    if (
      pathname.includes('.nsf') ||
      hostname.includes('posco') ||
      hostname.includes('poscoway') ||
      hostname.includes('steel-n.com') ||
      hostname.includes('postown.net') ||
      hostname.includes('easythanks-planet.com') ||
      /^172\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^169\.140\.\d+\.\d+$/.test(hostname)
    ) {
      return 'posco';
    }

    return null;
  }

  /**
   * Hàm khởi tạo chính.
   * Được bọc trong IIFE để không gây ô nhiễm global scope.
   */
  async function bootstrap() {
    if (global.MailGuard._orchestrator) {
      console.warn('[QuarantineGuard] Orchestrator đã tồn tại, bỏ qua khởi tạo trùng lặp.');
      return;
    }

    const platform = detectPlatform();

    if (!platform) {
      console.warn('[QuarantineGuard] Không nhận diện được nền tảng Webmail. Bỏ qua khởi tạo.');
      return;
    }

    // Kiểm tra các module Core đã được tải chưa
    const coreModules = [
      'DomainValidator',
      'ContentSanitizer',
      'QuarantineUI',
      'Orchestrator',
    ];

    const missingCore = coreModules.filter((m) => !global.MailGuard?.[m]);
    if (missingCore.length > 0) {
      console.error('[QuarantineGuard] Thiếu các module Core:', missingCore.join(', '));
      return;
    }

    // Chọn Adapter dựa trên platform
    let adapter;

    if (platform === 'gmail') {
      if (!global.MailGuard.GmailAdapter) {
        console.error('[QuarantineGuard] GmailAdapter chưa được tải.');
        return;
      }
      adapter = new global.MailGuard.GmailAdapter();
    } else if (platform === 'posco') {
      if (!global.MailGuard.PoscoAdapter) {
        console.error('[QuarantineGuard] PoscoAdapter chưa được tải.');
        return;
      }
      adapter = new global.MailGuard.PoscoAdapter();
    }

    try {
      // Tạo Orchestrator với Adapter đã chọn
      const orchestrator = new global.MailGuard.Orchestrator(adapter);

      // Khởi tạo — tải Whitelist và bắt đầu quan sát DOM
      await orchestrator.init();

      // Lưu instance vào namespace để debug từ console
      global.MailGuard._orchestrator = orchestrator;

      console.log(
        `%c[QuarantineGuard] Đã khởi động thành công trên ${platform.toUpperCase()}! 🛡`,
        'color: #22c55e; font-weight: bold; font-size: 14px;'
      );
      console.log(
        '[QuarantineGuard] Adapter:', adapter.name
      );
      console.log(
        '[QuarantineGuard] Whitelist hiện tại:',
        orchestrator.validator.getWhitelist()
      );

    } catch (err) {
      console.error('[QuarantineGuard] Lỗi nghiêm trọng khi khởi động:', err);
    }
  }

  // Đợi DOM được load hoàn toàn trước khi chạy
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    // DOM đã sẵn sàng, dùng setTimeout nhỏ để đảm bảo render xong cấu trúc ban đầu
    setTimeout(bootstrap, 500);
  }

})(window);

