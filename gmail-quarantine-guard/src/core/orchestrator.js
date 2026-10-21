/**
 * @file orchestrator.js
 * @namespace window.MailGuard
 * @description [REUSABLE CORE] Bộ điều phối trung tâm (Orchestrator) kết nối:
 *   - Adapter (platform-specific): Cung cấp DOM selectors và hành động tự động hóa
 *   - Core Modules: DomainValidator, ContentSanitizer, QuarantineUI
 *
 * Luồng hoạt động:
 *   1. Khởi tạo với một Adapter cụ thể (vd: GmailAdapter)
 *   2. Tải Whitelist từ Service Worker
 *   3. Bắt đầu quan sát DOM thay đổi để phát hiện email mới trong Inbox
 *   4. Với mỗi hàng email được phát hiện: kiểm tra domain, nếu External thì kích hoạt cảnh báo
 *   5. Khi người dùng đọc email (view mode): tự động gắn Shield Overlay
 *
 * Pattern: Observer + Strategy (Adapter thay thế Strategy cho các Webmail khác nhau)
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  /**
   * @class Orchestrator
   * @description Bộ điều phối trung tâm của hệ thống Quarantine Guard.
   */
  class Orchestrator {
    /**
     * @param {object} adapter - Đối tượng Adapter của nền tảng Webmail (vd: GmailAdapter instance)
     */
    constructor(adapter) {
      /** @type {object} Adapter của nền tảng Webmail */
      this.adapter = adapter;

      /** @type {MailGuard.DomainValidator} */
      this.validator = new global.MailGuard.DomainValidator();

      /** @type {MailGuard.ContentSanitizer} */
      this.sanitizer = new global.MailGuard.ContentSanitizer();

      /** @type {MailGuard.QuarantineUI} */
      this.ui = new global.MailGuard.QuarantineUI();

      /** @type {MutationObserver|null} Observer theo dõi DOM */
      this._observer = null;

      /** @type {boolean} Trạng thái đã khởi tạo */
      this._initialized = false;

      /** @type {Set<HTMLElement>} Các hàng email đã được xử lý */
      this._processedRows = new WeakSet();

      /** @type {HTMLElement|null} Vùng nội dung email hiện đang được quan sát */
      this._currentContentArea = null;

      /** @type {boolean} Chế độ Shield đã kích hoạt hay chưa */
      this._shieldActive = false;
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    /**
     * Khởi chạy Orchestrator:
     * 1. Tải Whitelist
     * 2. Xử lý các email đang hiển thị trong Inbox
     * 3. Bắt đầu quan sát DOM
     * 4. Lắng nghe thay đổi Storage (Whitelist được cập nhật từ Popup)
     */
    async init() {
      if (this._initialized) return;

      console.log('[Orchestrator] Đang khởi tạo với adapter:', this.adapter.name);

      // Bước 1: Tải Whitelist
      await this.validator.loadWhitelist();

      // Bước 2: Xử lý Inbox hiện tại
      this._scanInboxRows();

      // Bước 3: Bắt đầu DOM Observer
      this._startObserver();

      // Bước 4: Lắng nghe khi Whitelist thay đổi từ Popup
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.whitelistDomains) {
          const newList = changes.whitelistDomains.newValue || [];
          this.validator.updateWhitelist(newList);
          console.log('[Orchestrator] Whitelist đã được cập nhật từ Popup:', newList);
          // Re-scan Inbox với Whitelist mới
          this._resetAndRescan();
        }
      });

      this._initialized = true;
      console.log('[Orchestrator] Đã khởi tạo thành công.');
    }

    // ============================================================
    // INBOX SCANNING
    // ============================================================

    /**
     * Quét tất cả các hàng email hiện có trong Inbox.
     */
    _scanInboxRows() {
      const rows = this.adapter.getInboxRows();
      console.log(`[Orchestrator] Quét ${rows.length} hàng email trong Inbox.`);
      for (const row of rows) {
        this._processInboxRow(row);
      }
    }

    /**
     * Xử lý một hàng email trong Inbox:
     * - Đọc địa chỉ người gửi
     * - Kiểm tra domain
     * - Nếu External: đánh dấu hàng + chặn click + gửi notification
     *
     * @param {HTMLElement} row - Element hàng email
     */
    _processInboxRow(row) {
      if (this._processedRows.has(row)) return;
      this._processedRows.add(row);

      const senderEmail = this.adapter.getSenderFromRow(row);
      if (!senderEmail) return;

      const { isInternal, domain } = this.validator.isInternal(senderEmail);

      if (!isInternal) {
        // Đánh dấu hàng là External trong UI
        const subject = this.adapter.getSubjectFromRow(row);
        this.ui.markRowAsExternal(row, domain);

        // Gửi System Notification (throttled: chỉ gửi lần đầu)
        if (!row.dataset.mgNotified) {
          row.dataset.mgNotified = 'true';
          this._sendNotification(senderEmail, subject, domain);
        }

        // Chặn click để hiển thị Decision Modal
        this._attachClickInterceptor(row, { sender: senderEmail, subject, domain });
      }
    }

    /**
     * Gắn event listener chặn click vào hàng email.
     * @param {HTMLElement} row
     * @param {object} emailInfo
     */
    _attachClickInterceptor(row, emailInfo) {
      if (row.dataset.mgIntercepted === 'true') return;
      row.dataset.mgIntercepted = 'true';

      row.addEventListener('click', (event) => {
        // Chỉ chặn click vào chính hàng email, không chặn checkbox
        const target = event.target;
        const isCheckbox = target.closest('[data-tooltip="Select"]') || target.type === 'checkbox';
        if (isCheckbox) return;

        event.stopImmediatePropagation();
        event.preventDefault();

        console.log('[Orchestrator] Đã chặn click vào email External:', emailInfo.sender);

        this.ui.showDecisionModal(emailInfo, {
          onViewSandbox: async () => {
            await this._openInSandbox(row, emailInfo);
          },
          onAllowOpen: () => {
            // Mở email như bình thường bằng cách mô phỏng click thật
            this.ui.showToast('⚠️ Đang mở email gốc. Hãy cẩn thận!', 'warning');
            this._removeClickInterceptor(row);
            this.adapter.openEmail(row);
          },
          onDelete: () => {
            this.adapter.deleteEmail(row);
            this.ui.showToast('🗑 Email đã được xóa.', 'success');
          },
          onCancel: () => {
            console.log('[Orchestrator] Người dùng đã hủy quyết định.');
          },
        });
      }, true); // capture phase
    }

    /**
     * Gỡ bỏ click interceptor khỏi một hàng email.
     * @param {HTMLElement} row
     */
    _removeClickInterceptor(row) {
      // Thay thế element bằng bản sao của nó để xóa tất cả listeners
      const clone = row.cloneNode(true);
      row.parentNode.replaceChild(clone, row);
    }

    /**
     * Mở và hiển thị email trong Sandbox Viewer.
     * @param {HTMLElement} row - Hàng email
     * @param {object} emailInfo - Thông tin email
     */
    async _openInSandbox(row, emailInfo) {
      this.ui.showToast('🔄 Đang tải nội dung email vào Sandbox...', 'info', 2000);

      try {
        // Lấy nội dung HTML thô của email qua Adapter
        const rawHTML = await this.adapter.fetchEmailHTML(row);

        const sanitizedHTML = this.sanitizer.sanitizeHTML(rawHTML);
        const plainText = this.sanitizer.toPlainText(rawHTML);
        const links = this.sanitizer.extractLinks(rawHTML);

        this.ui.showSandboxViewer(
          { sanitizedHTML, plainText, links },
          emailInfo,
          {
            onClose: () => {
              console.log('[Orchestrator] Sandbox Viewer đã đóng.');
            },
            onAllowOpen: () => {
              this.ui.showToast('⚠️ Đang mở email gốc...', 'warning');
              this._removeClickInterceptor(row);
              this.adapter.openEmail(row);
            },
          }
        );
      } catch (err) {
        console.error('[Orchestrator] Lỗi khi tải email vào Sandbox:', err);
        this.ui.showToast('❌ Không thể tải nội dung email vào Sandbox.', 'danger');
      }
    }

    // ============================================================
    // EMAIL VIEW MODE SHIELD
    // ============================================================

    /**
     * Kiểm tra xem trang có đang ở chế độ đọc email hay không.
     * Nếu có, kiểm tra người gửi và gắn Shield nếu là External.
     */
    async _checkAndApplyShield() {
      const contentArea = this.adapter.getEmailContentArea();
      if (!contentArea || contentArea === this._currentContentArea) return;

      this._currentContentArea = contentArea;
      this._shieldActive = false;
      this.ui.detachShield();

      const senderEmail = this.adapter.getCurrentEmailSender();
      if (!senderEmail) return;

      const { isInternal, domain } = this.validator.isInternal(senderEmail);

      if (!isInternal) {
        console.log('[Orchestrator] Đang xem email External:', senderEmail, '— Gắn Shield.');
        const subject = this.adapter.getCurrentEmailSubject();

        this._shieldActive = true;
        this.ui.attachShield(contentArea, { sender: senderEmail, subject, domain }, {
          onViewSandbox: async () => {
            const rawHTML = contentArea.innerHTML;
            const sanitizedHTML = this.sanitizer.sanitizeHTML(rawHTML);
            const plainText = this.sanitizer.toPlainText(rawHTML);
            const links = this.sanitizer.extractLinks(rawHTML);

            this.ui.showSandboxViewer(
              { sanitizedHTML, plainText, links },
              { sender: senderEmail, subject, domain },
              {
                onClose: () => this.ui.attachShield(contentArea, { sender: senderEmail, subject, domain }, {}),
                onAllowOpen: () => {
                  this.ui.detachShield();
                  this._shieldActive = false;
                },
              }
            );
          },
          onAllowAccess: () => {
            this._shieldActive = false;
            this.ui.showToast('⚠️ Shield đã bị gỡ. Hãy cẩn thận với nội dung email này!', 'warning');
          },
        });

        // Cũng gắn Shield lên vùng đính kèm nếu có
        const attachArea = this.adapter.getAttachmentArea();
        if (attachArea) {
          this.ui.attachShield(attachArea, { sender: senderEmail, subject, domain }, {
            onViewSandbox: () => { },
            onAllowAccess: () => {
              this.ui.showToast('⚠️ Vùng đính kèm đã được mở khóa. Hãy kiểm tra kỹ trước khi tải file!', 'warning');
            },
          });
        }
      }
    }

    // ============================================================
    // DOM OBSERVER
    // ============================================================

    /**
     * Bắt đầu MutationObserver để theo dõi DOM thay đổi.
     * Khi phát hiện hàng email mới (trong Inbox) hoặc vùng đọc email mới,
     * sẽ tự động kích hoạt quy trình kiểm tra.
     */
    _startObserver() {
      if (this._observer) {
        this._observer.disconnect();
      }

      // Debounce để tránh xử lý quá nhiều lần
      let scanTimer = null;
      let shieldTimer = null;

      this._observer = new MutationObserver((mutations) => {
        let hasNewRows = false;
        let hasViewChange = false;

        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            // Kiểm tra xem node mới có phải là hàng email Inbox không
            if (this.adapter.isInboxRow(node)) {
              hasNewRows = true;
            }
            // Kiểm tra xem có vùng đọc email mới xuất hiện không
            if (this.adapter.isEmailContentArea(node) || node.querySelector?.(this.adapter.contentAreaSelector)) {
              hasViewChange = true;
            }
          }
          // Theo dõi thuộc tính thay đổi (Gmail thay đổi class/aria khi chuyển view)
          if (mutation.type === 'attributes' && this.adapter.isViewTransition(mutation.target)) {
            hasViewChange = true;
          }
        }

        if (hasNewRows) {
          clearTimeout(scanTimer);
          scanTimer = setTimeout(() => this._scanInboxRows(), 200);
        }

        if (hasViewChange) {
          clearTimeout(shieldTimer);
          shieldTimer = setTimeout(() => this._checkAndApplyShield(), 300);
        }
      });

      const observeTarget = document.body;
      this._observer.observe(observeTarget, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-expanded', 'data-view'],
      });

      console.log('[Orchestrator] DOM Observer đã bắt đầu.');
    }

    /**
     * Reset trạng thái và quét lại Inbox (sau khi Whitelist thay đổi).
     */
    _resetAndRescan() {
      // Xóa toàn bộ các đánh dấu cũ
      const markedRows = document.querySelectorAll('[data-mg-marked="true"]');
      for (const row of markedRows) {
        this.ui.unmarkRow(row);
        delete row.dataset.mgMarked;
        delete row.dataset.mgIntercepted;
        delete row.dataset.mgNotified;
      }
      this._processedRows = new WeakSet();
      this._scanInboxRows();
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    /**
     * Gửi Chrome System Notification qua Service Worker.
     * @param {string} sender
     * @param {string} subject
     * @param {string} domain
     */
    _sendNotification(sender, subject, domain) {
      chrome.runtime.sendMessage({
        type: 'SEND_NOTIFICATION',
        payload: {
          title: `⚠️ Quarantine Guard: Email Ngoài Whitelist`,
          message: `Từ: ${sender}\nTiêu đề: ${subject || '(Không có tiêu đề)'}\nDomain: @${domain}`,
        },
      }).catch((err) => {
        console.warn('[Orchestrator] Không thể gửi notification:', err);
      });
    }

    // ============================================================
    // CLEANUP
    // ============================================================

    /**
     * Dừng Observer và dọn sạch UI.
     */
    destroy() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      this.ui.destroyModal();
      this.ui.destroySandboxViewer();
      this.ui.detachShield();
      this._initialized = false;
      console.log('[Orchestrator] Đã dừng và dọn sạch.');
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.Orchestrator = Orchestrator;

  console.log('[MailGuard] Orchestrator đã sẵn sàng.');
})(window);
