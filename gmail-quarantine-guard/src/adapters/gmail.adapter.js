/**
 * @file gmail.adapter.js
 * @namespace window.MailGuard
 * @description [PLATFORM ADAPTER] Adapter cho Gmail (https://mail.google.com)
 *
 * Chứa toàn bộ kiến thức về DOM của Gmail:
 *   - Selectors cho hàng email Inbox, vùng nội dung, vùng đính kèm
 *   - Cách đọc địa chỉ người gửi, tiêu đề email từ DOM
 *   - Cách thực thi hành động: mở email, xóa email
 *   - Cách lấy HTML thô của email để đưa vào Sandbox
 *
 * ⚠️ LƯU Ý: Các selector Gmail có thể thay đổi theo phiên bản.
 * Đây là file DUY NHẤT cần thay đổi khi Gmail cập nhật UI hoặc
 * khi chuyển sang nền tảng Webmail khác (OWA, Roundcube, v.v.)
 *
 * Phiên bản selector: Gmail Web 2024-2025
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  // ============================================================
  // GMAIL DOM SELECTORS
  // ============================================================

  /**
   * Tập hợp các selector DOM của Gmail.
   * Được tách riêng để dễ cập nhật khi Gmail thay đổi UI.
   */
  const GMAIL_SELECTORS = {
    /**
     * Hàng email trong danh sách Inbox.
     * Gmail dùng class 'zA' cho các hàng email chưa đọc và đã đọc.
     * Thêm 'yO' (đã đọc) và 'zE' (chưa đọc) để tham khảo.
     */
    INBOX_ROW: 'tr.zA',

    /**
     * Attribute chứa địa chỉ email người gửi trên hàng email.
     * Gmail gán attribute 'email' vào thẻ span của tên người gửi.
     */
    SENDER_IN_ROW: 'td.yX [email], td.yX span[data-hovercard-id], .zF',

    /**
     * Selector của ô tiêu đề email trong hàng Inbox.
     * .bog là class chứa subject snippet trong Gmail.
     */
    SUBJECT_IN_ROW: '.bog',

    /**
     * Vùng nội dung chính của email khi đang đọc.
     * .a3s.aiL là container nội dung email trong chế độ đọc.
     */
    EMAIL_CONTENT_AREA: '.a3s.aiL',

    /**
     * Vùng hiển thị file đính kèm.
     * .hq.gt là container chứa các file đính kèm trong Gmail.
     */
    ATTACHMENT_AREA: '.hq.gt',

    /**
     * Selector của địa chỉ người gửi khi đang đọc email.
     */
    CURRENT_SENDER: '.gD[email], .go[email], span.gD',

    /**
     * Selector của tiêu đề email khi đang đọc.
     */
    CURRENT_SUBJECT: 'h2.hP',

    /**
     * Container chứa toàn bộ vùng email được mở để đọc.
     */
    EMAIL_VIEW_CONTAINER: '.gs',

    /**
     * Nút Xóa (Delete/Trash) trong thanh công cụ Gmail.
     */
    DELETE_BUTTON: '[data-tooltip="Delete"], [aria-label="Delete"]',

    /**
     * Nút More actions (để tìm Delete khi không có nút thẳng)
     */
    MORE_ACTIONS_BUTTON: '[data-tooltip="More"], [aria-label="More"]',
  };

  // ============================================================
  // CLASS GmailAdapter
  // ============================================================

  /**
   * @class GmailAdapter
   * @description Adapter cho nền tảng Gmail. Cung cấp các phương thức
   * platform-specific được Orchestrator gọi qua interface chuẩn.
   *
   * Interface chuẩn mà mọi Adapter phải triển khai:
   *   - name: string
   *   - contentAreaSelector: string
   *   - getInboxRows(): HTMLElement[]
   *   - getSenderFromRow(row): string|null
   *   - getSubjectFromRow(row): string
   *   - isInboxRow(node): boolean
   *   - isEmailContentArea(node): boolean
   *   - isViewTransition(node): boolean
   *   - getEmailContentArea(): HTMLElement|null
   *   - getAttachmentArea(): HTMLElement|null
   *   - getCurrentEmailSender(): string|null
   *   - getCurrentEmailSubject(): string
   *   - fetchEmailHTML(row): Promise<string>
   *   - openEmail(row): void
   *   - deleteEmail(row): void
   */
  class GmailAdapter {
    constructor() {
      /** @type {string} Tên của Adapter (để debug) */
      this.name = 'GmailAdapter';

      /** @type {string} Selector của vùng nội dung email */
      this.contentAreaSelector = GMAIL_SELECTORS.EMAIL_CONTENT_AREA;
    }

    // ----------------------------------------------------------
    // INBOX SCANNING
    // ----------------------------------------------------------

    /**
     * Lấy tất cả các hàng email trong Inbox hiện tại.
     * @returns {HTMLElement[]}
     */
    getInboxRows() {
      return Array.from(document.querySelectorAll(GMAIL_SELECTORS.INBOX_ROW));
    }

    /**
     * Đọc địa chỉ email người gửi từ một hàng email.
     *
     * Gmail lưu email trong nhiều nơi:
     *   1. Attribute [email] của span người gửi (.zF hoặc .yX span)
     *   2. Attribute [data-hovercard-id] (thường là email)
     *
     * @param {HTMLElement} row - Hàng email (tr.zA)
     * @returns {string|null} Địa chỉ email hoặc null nếu không tìm được
     */
    getSenderFromRow(row) {
      if (!row) return null;

      // 1. Quét tất cả các phần tử ứng viên trong cột người gửi (td.yX) và hàng
      const candidateElements = [
        ...row.querySelectorAll('td.yX [email], td.yX [data-hovercard-id], td.yX span, td.yX div, [email], [data-hovercard-id], .zF, .yP, .bA4')
      ];

      for (const el of candidateElements) {
        // Kiểm tra các thuộc tính có thể chứa email
        for (const attr of ['email', 'data-hovercard-id', 'title', 'aria-label', 'name', 'data-tooltip']) {
          const val = el.getAttribute(attr);
          if (val && val.includes('@')) {
            const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) return match[0].toLowerCase().trim();
          }
        }

        // Kiểm tra textContent
        const text = (el.textContent || '').trim();
        if (text.includes('@')) {
          const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match) return match[0].toLowerCase().trim();
        }
      }

      // 2. Quét toàn bộ HTML của ô người gửi (td.yX)
      const senderTd = row.querySelector('td.yX') || row;
      const tdHtml = senderTd.innerHTML || '';
      const emailMatch = tdHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        return emailMatch[0].toLowerCase().trim();
      }

      return null;
    }

    /**
     * Đọc tiêu đề email từ một hàng email.
     * @param {HTMLElement} row
     * @returns {string}
     */
    getSubjectFromRow(row) {
      if (!row) return '';
      const subjectEl = row.querySelector(GMAIL_SELECTORS.SUBJECT_IN_ROW);
      return subjectEl ? subjectEl.textContent.trim() : '';
    }

    /**
     * Kiểm tra xem một DOM node có phải là hàng email Inbox không.
     * @param {Node} node
     * @returns {boolean}
     */
    isInboxRow(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.(GMAIL_SELECTORS.INBOX_ROW) || !!node.querySelector?.(GMAIL_SELECTORS.INBOX_ROW);
    }

    // ----------------------------------------------------------
    // EMAIL VIEW MODE
    // ----------------------------------------------------------

    /**
     * Kiểm tra xem một DOM node có phải là vùng nội dung email không.
     * @param {Node} node
     * @returns {boolean}
     */
    isEmailContentArea(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.(GMAIL_SELECTORS.EMAIL_CONTENT_AREA) || false;
    }

    /**
     * Kiểm tra xem một node có đại diện cho việc chuyển view không.
     * Gmail dùng class thay đổi trên các container khi người dùng điều hướng.
     * @param {Element} node
     * @returns {boolean}
     */
    isViewTransition(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      // Gmail thay đổi class trên .nH (main pane) và .BltHke khi chuyển view
      return node.matches?.('.nH, .BltHke, .aeF') || false;
    }

    /**
     * Lấy vùng nội dung của email đang được đọc.
     * Trả về null nếu không đang ở chế độ đọc email.
     * @returns {HTMLElement|null}
     */
    getEmailContentArea() {
      return document.querySelector(GMAIL_SELECTORS.EMAIL_CONTENT_AREA);
    }

    /**
     * Lấy vùng đính kèm của email đang được đọc.
     * @returns {HTMLElement|null}
     */
    getAttachmentArea() {
      return document.querySelector(GMAIL_SELECTORS.ATTACHMENT_AREA);
    }

    /**
     * Lấy địa chỉ email người gửi của email đang được đọc.
     * @returns {string|null}
     */
    getCurrentEmailSender() {
      // 1. Kiểm tra phần tử người gửi chính
      const senderEl = document.querySelector(GMAIL_SELECTORS.CURRENT_SENDER);
      if (senderEl) {
        for (const attr of ['email', 'data-hovercard-id', 'title', 'aria-label']) {
          const val = senderEl.getAttribute(attr);
          if (val && val.includes('@')) {
            const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) return match[0].toLowerCase().trim();
          }
        }
        const text = senderEl.textContent.trim();
        if (text.includes('@')) {
          const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match) return match[0].toLowerCase().trim();
        }
      }

      // 2. Quét vùng header email (gE, adn, gs, gD, go)
      const headerArea = document.querySelector('.gE, .adn, .gs');
      if (headerArea) {
        const candidate = headerArea.querySelector('[email], [data-hovercard-id], span.go, span.gD');
        if (candidate) {
          const val = candidate.getAttribute('email') || candidate.getAttribute('data-hovercard-id') || candidate.textContent;
          if (val && val.includes('@')) {
            const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) return match[0].toLowerCase().trim();
          }
        }
      }

      return null;
    }

    /**
     * Lấy tiêu đề của email đang được đọc.
     * @returns {string}
     */
    getCurrentEmailSubject() {
      const subjectEl = document.querySelector(GMAIL_SELECTORS.CURRENT_SUBJECT);
      return subjectEl ? subjectEl.textContent.trim() : '';
    }

    // ----------------------------------------------------------
    // EMAIL ACTIONS
    // ----------------------------------------------------------

    /**
     * Lấy HTML thô của email từ DOM để đưa vào Sandbox.
     *
     * Chiến lược:
     *   1. Mở email bằng cách click vào hàng
     *   2. Đợi vùng nội dung xuất hiện
     *   3. Lấy innerHTML của vùng nội dung
     *   4. Đóng email (điều hướng trở lại Inbox)
     *   5. Fallback snippet nếu timeout.
     *
     * @param {HTMLElement} row - Hàng email
     * @returns {Promise<string>} HTML thô của email
     */
    async fetchEmailHTML(row) {
      return new Promise((resolve) => {
        // Cho phép click này đi qua click interceptor
        row.dataset.mgAllowingClick = 'true';

        const timeout = setTimeout(() => {
          if (observer) observer.disconnect();
          delete row.dataset.mgAllowingClick;
          const snippet = row.querySelector('.y2')?.textContent?.trim() || '';
          const subject = this.getSubjectFromRow(row) || '';
          console.warn('[GmailAdapter] Timeout khi tải nội dung email, sử dụng snippet fallback.');
          resolve(
            `<div style="padding: 12px; font-family: sans-serif;">` +
            `<p style="color: #64748b;">(Không thể tải trước toàn bộ DOM chi tiết từ Gmail trong nền. Hiển thị nội dung xem trước:)</p>` +
            `<h3 style="margin: 8px 0;">${subject}</h3>` +
            `<div style="padding: 12px; background: rgba(0,0,0,0.05); border-radius: 6px; line-height: 1.5;">${snippet || '(Không có nội dung tóm tắt)'}</div>` +
            `</div>`
          );
        }, 8000);

        // Observer để đợi vùng nội dung email xuất hiện
        const observer = new MutationObserver(() => {
          const contentArea = document.querySelector(GMAIL_SELECTORS.EMAIL_CONTENT_AREA);
          if (contentArea && contentArea.innerHTML.trim()) {
            clearTimeout(timeout);
            observer.disconnect();
            delete row.dataset.mgAllowingClick;
            const html = contentArea.innerHTML;

            // Điều hướng trở lại Inbox sau khi lấy được HTML
            setTimeout(() => {
              window.history.back();
            }, 100);

            resolve(html);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Click vào hàng email để mở nó
        const clickTarget = row.querySelector('.bog, .y6, td:nth-child(4), td:nth-child(5)') || row;
        ['mousedown', 'mouseup', 'click'].forEach(type => {
          clickTarget.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          }));
        });
        if (typeof clickTarget.click === 'function') {
          clickTarget.click();
        }
      });
    }

    /**
     * Mở email bằng cách mô phỏng click vào hàng email.
     * Được gọi sau khi người dùng chọn "Cho phép mở" trong Modal.
     * @param {HTMLElement} row
     */
    openEmail(row) {
      if (!row) return;
      row.dataset.mgAllowingClick = 'true';
      const clickTarget = row.querySelector('.bog, .y6, td:nth-child(4), td:nth-child(5)') || row;
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        clickTarget.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
        }));
      });
      if (typeof clickTarget.click === 'function') {
        clickTarget.click();
      }
    }

    /**
     * Xóa email (chuyển vào Thùng rác).
     * Gmail: Chọn hàng (click checkbox) rồi click nút Delete.
     * @param {HTMLElement} row
     */
    deleteEmail(row) {
      if (!row) return;

      try {
        // Chọn email bằng checkbox
        const checkbox = row.querySelector('td.oZ-x3 .T-KT, [type="checkbox"], .oZ-x3');
        if (checkbox) {
          checkbox.click();

          // Đợi một chút rồi click nút Delete
          setTimeout(() => {
            // Tìm nút Delete trong toolbar
            const deleteBtn = document.querySelector(GMAIL_SELECTORS.DELETE_BUTTON);
            if (deleteBtn) {
              deleteBtn.click();
              console.log('[GmailAdapter] Đã xóa email.');
            } else {
              // Thử phím tắt '#' để xóa trong Gmail
              document.dispatchEvent(new KeyboardEvent('keydown', {
                key: '#',
                keyCode: 51,
                which: 51,
                bubbles: true,
              }));
            }
          }, 300);
        }
      } catch (err) {
        console.error('[GmailAdapter] Lỗi khi xóa email:', err);
      }
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.GmailAdapter = GmailAdapter;

  console.log('[MailGuard] GmailAdapter đã sẵn sàng.');
})(window);
