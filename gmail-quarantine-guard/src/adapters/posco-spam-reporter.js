/**
 * @file posco-spam-reporter.js
 * @namespace window.MailGuard.PoscoSpamReporter
 * @description [POSCO SUB-MODULE] Tự động hóa quy trình Báo cáo Phishing / Spam qua Spam Center trên POSCO Webmail.
 *
 * Chịu trách nhiệm:
 *   - Điều khiển checkbox trên bảng Inbox (bỏ chọn tất cả và chọn đúng hàng cần báo cáo)
 *   - Tìm kiếm và kích hoạt nút "Spam Center" trên thanh công cụ
 *   - Lắng nghe và tự động tương tác với hộp thoại Spam Center (chọn "Delete Spam & Rules & Report", highlight nút OK)
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  /**
   * @class PoscoSpamReporter
   */
  class PoscoSpamReporter {
    /**
     * @param {object} selectors - DOM selectors từ PoscoAdapter
     */
    constructor(selectors = {}) {
      this.selectors = selectors;
    }

    /**
     * Tự động hóa Báo cáo Phishing từ Inbox.
     * 1. Bỏ tích tất cả checkbox khác
     * 2. Tích đúng checkbox của dòng thư hiện tại
     * 3. Tìm nút "Spam Center" và click
     * 4. Đợi hộp thoại Spam Center, tự động chọn "Delete Spam & Rules & Report"
     *
     * @param {HTMLElement} row
     */
    reportPhishingFromInbox(row) {
      if (!row) return;

      try {
        const inboxTable = this.selectors.INBOX_TABLE || 'table#mailList_inbox';

        // Bước 1: Bỏ tích tất cả checkbox đang checked trong bảng Inbox
        const allChecked = document.querySelectorAll(
          `${inboxTable} input[type="checkbox"]:checked`
        );
        for (const cb of allChecked) {
          cb.checked = false;
        }

        // Bước 2: Tích chọn đúng checkbox của dòng thư hiện tại
        const targetCheckbox = row.querySelector('input[type="checkbox"]');
        if (targetCheckbox) {
          targetCheckbox.checked = true;
        }

        // Bước 3: Tìm nút "Spam Center" trên thanh công cụ và click
        const toolbarButtons = document.querySelectorAll('a, button, input[type="button"]');
        let spamCenterBtn = null;
        for (const btn of toolbarButtons) {
          const text = (btn.textContent || btn.value || '').trim();
          if (text.includes('Spam Center') || text.includes('spam center') || text.includes('SpamCenter')) {
            spamCenterBtn = btn;
            break;
          }
        }

        if (spamCenterBtn) {
          spamCenterBtn.click();
          console.log('[PoscoSpamReporter] Đã click nút Spam Center.');

          // Bước 4: Đợi hộp thoại Spam Center hiện ra (tối đa 3 giây)
          this._waitForSpamCenterDialog();
        } else {
          console.warn('[PoscoSpamReporter] Không tìm thấy nút Spam Center trên toolbar.');
        }
      } catch (err) {
        console.error('[PoscoSpamReporter] Lỗi khi báo cáo Phishing:', err);
      }
    }

    /**
     * Tự động hóa Báo cáo Phishing từ Màn hình Đọc Chi Tiết.
     * Logic tương tự nhưng tìm checkbox / nút trên giao diện đọc thư.
     */
    reportPhishingFromDetail() {
      try {
        // Tìm nút "Spam Center" trong giao diện Detail
        const toolbarButtons = document.querySelectorAll('a, button, input[type="button"]');
        let spamCenterBtn = null;
        for (const btn of toolbarButtons) {
          const text = (btn.textContent || btn.value || '').trim();
          if (text.includes('Spam Center') || text.includes('spam center') || text.includes('SpamCenter')) {
            spamCenterBtn = btn;
            break;
          }
        }

        if (spamCenterBtn) {
          spamCenterBtn.click();
          console.log('[PoscoSpamReporter] Đã click nút Spam Center (Detail View).');
          this._waitForSpamCenterDialog();
        } else {
          console.warn('[PoscoSpamReporter] Không tìm thấy nút Spam Center trong Detail View.');
        }
      } catch (err) {
        console.error('[PoscoSpamReporter] Lỗi khi báo cáo Phishing từ Detail:', err);
      }
    }

    /**
     * Đợi hộp thoại Spam Center hiện ra rồi tự động:
     * - Tích chọn radio thứ 2 ("Delete Spam & Rules & Report")
     * - Làm nổi bật nút OK
     * Timeout tối đa 3 giây.
     * @private
     */
    _waitForSpamCenterDialog() {
      let attempts = 0;
      const maxAttempts = 30; // 30 × 100ms = 3 giây

      const interval = setInterval(() => {
        attempts++;

        // Tìm hộp thoại Spam Center (thường là div modal hoặc layer mới xuất hiện)
        const radios = document.querySelectorAll('input[type="radio"]');
        // Spam Center dialog thường có ≥2 radio buttons
        if (radios.length >= 2) {
          // Tích chọn radio thứ 2 (Delete Spam & Rules & Report)
          const secondRadio = radios[1];
          if (secondRadio && !secondRadio.checked) {
            secondRadio.checked = true;
            // Dispatch change event để UI POSCO nhận biết
            secondRadio.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[PoscoSpamReporter] Đã chọn radio "Delete Spam & Rules & Report".');
          }

          // Tìm và làm nổi bật nút OK
          const allButtons = document.querySelectorAll('button, input[type="button"], a.btn');
          for (const btn of allButtons) {
            const text = (btn.textContent || btn.value || '').trim().toLowerCase();
            if (text === 'ok' || text === 'xác nhận' || text === 'confirm') {
              btn.style.outline = '3px solid #ef4444';
              btn.style.outlineOffset = '2px';
              btn.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.6)';
              console.log('[PoscoSpamReporter] Đã làm nổi bật nút OK. Chờ người dùng xác nhận.');
              break;
            }
          }

          clearInterval(interval);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.warn('[PoscoSpamReporter] Timeout: Không tìm thấy hộp thoại Spam Center sau 3 giây.');
        }
      }, 100);
    }
  }

  global.MailGuard.PoscoSpamReporter = PoscoSpamReporter;
  console.log('[MailGuard] PoscoSpamReporter đã sẵn sàng.');
})(window);
