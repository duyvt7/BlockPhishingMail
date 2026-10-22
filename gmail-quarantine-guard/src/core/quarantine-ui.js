/**
 * @file quarantine-ui.js
 * @namespace window.MailGuard
 * @description [REUSABLE CORE] Render và quản lý toàn bộ UI của hệ thống cách ly:
 *   1. **Decision Modal**: Hộp thoại 3 lựa chọn khi người dùng click vào email ngoài Whitelist
 *   2. **Sandbox Viewer**: Khung xem nội dung an toàn với chuyển đổi Sanitized HTML / Plain Text
 *   3. **UI Shield Overlay**: Lớp khiên phủ lên vùng nội dung khi email đã mở trong Gmail
 *
 * Tất cả các element được tạo ra bằng DOM API (không dùng innerHTML với data người dùng)
 * để đảm bảo an toàn XSS hoàn toàn.
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  // ============================================================
  // HELPER - Tạo element với attributes an toàn
  // ============================================================

  /**
   * Tạo một DOM element với class, attributes và text content.
   * @param {string} tag - Tên thẻ HTML
   * @param {object} [opts] - Tùy chọn: { className, id, attrs, text, children }
   * @returns {HTMLElement}
   */
  function el(tag, opts = {}) {
    const element = document.createElement(tag);
    if (opts.className) element.className = opts.className;
    if (opts.id) element.id = opts.id;
    if (opts.text != null) element.textContent = opts.text;
    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) {
        element.setAttribute(k, v);
      }
    }
    if (opts.children) {
      for (const child of opts.children) {
        if (child) element.appendChild(child);
      }
    }
    return element;
  }

  // ============================================================
  // CLASS QuarantineUI
  // ============================================================

  /**
   * @class QuarantineUI
   * @description Quản lý toàn bộ vòng đời của các UI Component cách ly.
   */
  class QuarantineUI {
    constructor() {
      /** @type {HTMLElement|null} Decision Modal hiện tại */
      this._modal = null;
      /** @type {HTMLElement|null} Backdrop của Modal */
      this._backdrop = null;
      /** @type {HTMLElement|null} Shield Overlay hiện tại */
      this._shield = null;
      /** @type {HTMLElement|null} Sandbox Viewer Panel */
      this._sandboxPanel = null;
    }

    // ----------------------------------------------------------
    // 1. DECISION MODAL
    // ----------------------------------------------------------

    /**
     * Hiển thị Hộp thoại Quyết định (Decision Modal) khi người dùng click vào email ngoài Whitelist.
     *
     * @param {object} emailInfo - Thông tin email
     * @param {string} emailInfo.sender - Địa chỉ người gửi
     * @param {string} emailInfo.subject - Tiêu đề email
     * @param {string} emailInfo.domain - Domain của người gửi
     * @param {object} callbacks - Hàm callback cho từng lựa chọn
     * @param {Function} callbacks.onViewSandbox - Callback "Xem trong Sandbox"
     * @param {Function} callbacks.onAllowOpen - Callback "Cho phép mở"
     * @param {Function} callbacks.onDelete - Callback "Xóa thư"
     * @param {Function} callbacks.onCancel - Callback "Hủy"
     */
    showDecisionModal(emailInfo, callbacks) {
      this.destroyModal();

      // Backdrop
      this._backdrop = el('div', { className: 'mg-backdrop' });
      this._backdrop.addEventListener('click', () => {
        if (callbacks.onCancel) callbacks.onCancel();
        this.destroyModal();
      });

      // Tiêu đề & Icon cảnh báo
      const warningIcon = el('div', { className: 'mg-modal-icon', text: '⚠️' });

      const titleEl = el('h2', {
        className: 'mg-modal-title',
        text: 'Cảnh báo: Email Ngoài Danh Sách An Toàn',
      });

      const senderEl = el('div', {
        className: 'mg-modal-sender',
        children: [
          el('span', { className: 'mg-modal-label', text: 'Người gửi: ' }),
          el('span', { className: 'mg-modal-value mg-value-danger', text: emailInfo.sender || 'Không rõ' }),
        ],
      });

      const domainEl = el('div', {
        className: 'mg-modal-domain-row',
        children: [
          el('span', { className: 'mg-modal-label', text: 'Domain: ' }),
          el('span', { className: 'mg-badge mg-badge-external', text: `@${emailInfo.domain || 'unknown'}` }),
        ],
      });

      const subjectEl = el('div', {
        className: 'mg-modal-subject',
        children: [
          el('span', { className: 'mg-modal-label', text: 'Tiêu đề: ' }),
          el('span', { className: 'mg-modal-value', text: emailInfo.subject || '(Không có tiêu đề)' }),
        ],
      });

      const warningText = el('p', {
        className: 'mg-modal-warning-text',
        text: 'Email này đến từ một domain KHÔNG thuộc danh sách an toàn (Whitelist). '
          + 'Việc mở email có thể dẫn đến rủi ro bảo mật (lừa đảo, phần mềm độc hại). '
          + 'Hãy chọn hành động phù hợp:',
      });

      // Các nút hành động
      const btnSandbox = el('button', {
        className: 'mg-btn mg-btn-primary',
        id: 'mg-btn-sandbox',
        text: '🛡 Xem trong Sandbox (Khuyên dùng)',
        attrs: { title: 'Xem nội dung email đã được khử độc an toàn, không có link độc hay tracker' },
      });
      btnSandbox.addEventListener('click', () => {
        if (callbacks.onViewSandbox) callbacks.onViewSandbox();
        this.destroyModal();
      });

      const btnWhitelist = el('button', {
        className: 'mg-btn mg-btn-success mg-btn-row-item',
        id: 'mg-btn-whitelist',
        text: '⭐ Tin cậy',
        attrs: { title: `Thêm @${emailInfo.domain || 'domain'} vào danh sách an toàn (Whitelist)` },
      });
      btnWhitelist.addEventListener('click', () => {
        if (callbacks.onAddToWhitelist) callbacks.onAddToWhitelist(emailInfo.domain);
        this.destroyModal();
      });

      const btnDelete = el('button', {
        className: 'mg-btn mg-btn-danger mg-btn-row-item',
        id: 'mg-btn-delete',
        text: '🗑 Xóa thư',
        attrs: { title: 'Đánh dấu và xóa email nguy hiểm này' },
      });
      btnDelete.addEventListener('click', () => {
        if (callbacks.onDelete) callbacks.onDelete();
        this.destroyModal();
      });

      const btnAllow = el('button', {
        className: 'mg-btn mg-btn-warning mg-btn-row-item',
        id: 'mg-btn-allow',
        text: '⚠️ Mở email',
        attrs: { title: 'Mở email trực tiếp — KHÔNG khuyến nghị (Chấp nhận rủi ro)' },
      });
      btnAllow.addEventListener('click', () => {
        if (callbacks.onAllowOpen) callbacks.onAllowOpen();
        this.destroyModal();
      });

      const buttonRow = el('div', {
        className: 'mg-modal-button-row',
        children: [btnWhitelist, btnDelete, btnAllow],
      });

      const btnCancel = el('button', {
        className: 'mg-btn mg-btn-ghost',
        id: 'mg-btn-cancel',
        text: '✕ Hủy',
      });
      btnCancel.addEventListener('click', () => {
        if (callbacks.onCancel) callbacks.onCancel();
        this.destroyModal();
      });

      const actionsEl = el('div', {
        className: 'mg-modal-actions',
        children: [btnSandbox, buttonRow, btnCancel],
      });

      // Dòng chú thích dưới cùng
      const footerEl = el('p', {
        className: 'mg-modal-footer-note',
        text: `💡 Bấm "⭐ Tin cậy" để thêm @${emailInfo.domain || 'domain'} vào Whitelist và mở thư trực tiếp.`,
      });

      this._modal = el('div', {
        className: 'mg-modal',
        id: 'mg-decision-modal',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mg-modal-title' },
        children: [warningIcon, titleEl, senderEl, domainEl, subjectEl, warningText, actionsEl, footerEl],
      });

      document.body.appendChild(this._backdrop);
      document.body.appendChild(this._modal);

      // Focus vào nút an toàn nhất (Sandbox)
      requestAnimationFrame(() => {
        btnSandbox.focus();
        this._modal.classList.add('mg-modal-enter');
      });
    }

    /**
     * Đóng và dọn sạch Decision Modal.
     */
    destroyModal() {
      if (this._modal) {
        this._modal.remove();
        this._modal = null;
      }
      if (this._backdrop) {
        this._backdrop.remove();
        this._backdrop = null;
      }
    }

    // ----------------------------------------------------------
    // 2. SANDBOX VIEWER
    // ----------------------------------------------------------

    /**
     * Hiển thị Sandbox Viewer để xem email đã được khử độc.
     *
     * @param {object} content - Nội dung đã xử lý
     * @param {string} content.sanitizedHTML - HTML đã khử độc
     * @param {string} content.plainText - Văn bản thuần túy
     * @param {Array}  content.links - Danh sách link đã trích xuất
     * @param {object} emailInfo - Thông tin email (sender, subject, domain)
     * @param {object} callbacks
     * @param {Function} callbacks.onClose - Callback khi đóng
     * @param {Function} callbacks.onAllowOpen - Callback khi người dùng quyết định mở hẳn
     */
    showSandboxViewer(content, emailInfo, callbacks) {
      this.destroySandboxViewer();
      this.destroyModal();

      // Panel container
      this._sandboxPanel = el('div', {
        className: 'mg-sandbox-panel',
        id: 'mg-sandbox-panel',
        attrs: { role: 'document' },
      });

      // Header
      const headerTitle = el('h3', {
        className: 'mg-sandbox-title',
        text: '🛡 Sandbox Viewer — Nội dung đã được Khử Độc',
      });

      const senderInfo = el('div', {
        className: 'mg-sandbox-info',
        children: [
          el('span', { className: 'mg-modal-label', text: 'Từ: ' }),
          el('span', { className: 'mg-value-danger', text: emailInfo.sender || '' }),
          el('span', { className: 'mg-modal-label', text: '  |  Tiêu đề: ' }),
          el('span', { text: emailInfo.subject || '(Không có tiêu đề)' }),
        ],
      });

      const closeBtn = el('button', {
        className: 'mg-sandbox-close',
        text: '✕',
        attrs: { title: 'Đóng Sandbox', 'aria-label': 'Đóng Sandbox Viewer' },
      });
      closeBtn.addEventListener('click', () => {
        if (callbacks.onClose) callbacks.onClose();
        this.destroySandboxViewer();
      });

      const header = el('div', {
        className: 'mg-sandbox-header',
        children: [
          el('div', { className: 'mg-sandbox-header-left', children: [headerTitle, senderInfo] }),
          closeBtn,
        ],
      });

      // Tab chuyển đổi chế độ xem
      const tabHTML = el('button', {
        className: 'mg-tab mg-tab-active',
        id: 'mg-tab-html',
        text: '🔍 Sanitized HTML',
        attrs: { 'data-tab': 'html' },
      });
      const tabText = el('button', {
        className: 'mg-tab',
        id: 'mg-tab-text',
        text: '📄 Plain Text',
        attrs: { 'data-tab': 'text' },
      });
      const tabLinks = el('button', {
        className: 'mg-tab',
        id: 'mg-tab-links',
        text: `🔗 Links (${content.links ? content.links.length : 0})`,
        attrs: { 'data-tab': 'links' },
      });

      const tabBar = el('div', {
        className: 'mg-tab-bar',
        children: [tabHTML, tabText, tabLinks],
      });

      // Content panes
      const paneHTML = el('div', {
        className: 'mg-content-pane mg-pane-active',
        id: 'mg-pane-html',
      });
      // ContentSanitizer đã lọc sạch toàn bộ thẻ/thuộc tính nguy hiểm
      paneHTML.innerHTML = content.sanitizedHTML || '<p>(Không có nội dung)</p>';

      const paneText = el('div', {
        className: 'mg-content-pane',
        id: 'mg-pane-text',
      });
      const preEl = el('pre', {
        className: 'mg-plain-text',
        text: content.plainText || '(Không có nội dung văn bản)',
      });
      paneText.appendChild(preEl);

      // Link list pane
      const paneLinks = el('div', {
        className: 'mg-content-pane',
        id: 'mg-pane-links',
      });

      if (!content.links || content.links.length === 0) {
        paneLinks.appendChild(el('p', {
          className: 'mg-no-links',
          text: '✅ Không phát hiện link nào trong email này.',
        }));
      } else {
        const linkList = el('ul', { className: 'mg-link-list' });
        for (const link of content.links) {
          const suspiciousClass = link.isSuspicious ? 'mg-link-suspicious' : '';
          const linkItem = el('li', {
            className: `mg-link-item ${suspiciousClass}`,
            children: [
              el('span', {
                className: 'mg-link-type',
                text: `[${link.type === 'media' ? 'MEDIA' : 'LINK'}]`,
              }),
              el('span', {
                className: 'mg-link-text',
                text: link.text || link.href,
              }),
              el('code', {
                className: 'mg-link-href',
                text: link.href,
              }),
              link.isSuspicious
                ? el('span', { className: 'mg-link-warning', text: '⚠️ NGHI NGỜ' })
                : null,
            ],
          });
          linkList.appendChild(linkItem);
        }
        const summary = el('p', {
          className: 'mg-links-summary',
          text: `Tổng cộng: ${content.links.length} link được phát hiện. `
            + `${content.links.filter((l) => l.isSuspicious).length} link nghi ngờ.`,
        });
        paneLinks.appendChild(summary);
        paneLinks.appendChild(linkList);
      }

      const contentArea = el('div', {
        className: 'mg-sandbox-content',
        children: [paneHTML, paneText, paneLinks],
      });

      // Tab click handlers
      const tabs = [
        { btn: tabHTML, pane: paneHTML, id: 'html' },
        { btn: tabText, pane: paneText, id: 'text' },
        { btn: tabLinks, pane: paneLinks, id: 'links' },
      ];

      for (const tabInfo of tabs) {
        tabInfo.btn.addEventListener('click', () => {
          for (const t of tabs) {
            t.btn.classList.remove('mg-tab-active');
            t.pane.classList.remove('mg-pane-active');
          }
          tabInfo.btn.classList.add('mg-tab-active');
          tabInfo.pane.classList.add('mg-pane-active');
        });
      }

      // Footer actions
      const whitelistBtn = el('button', {
        className: 'mg-btn mg-btn-success',
        id: 'mg-sandbox-whitelist-btn',
        text: '⭐ Tin cậy',
        attrs: { title: `Thêm @${emailInfo.domain || 'domain'} vào danh sách an toàn (Whitelist)` },
      });
      whitelistBtn.addEventListener('click', () => {
        if (callbacks.onAddToWhitelist) callbacks.onAddToWhitelist(emailInfo.domain);
        this.destroySandboxViewer();
      });

      const deleteBtn = el('button', {
        className: 'mg-btn mg-btn-danger',
        id: 'mg-sandbox-delete-btn',
        text: '🗑 Xóa thư',
        attrs: { title: 'Xóa email này và đóng Sandbox' },
      });
      deleteBtn.addEventListener('click', () => {
        if (callbacks.onDelete) callbacks.onDelete();
        this.destroySandboxViewer();
      });

      const allowBtn = el('button', {
        className: 'mg-btn mg-btn-warning',
        id: 'mg-sandbox-allow-btn',
        text: '⚠️ Mở email',
        attrs: { title: 'Chuyển sang xem email gốc không qua Sandbox (Chấp nhận rủi ro)' },
      });
      allowBtn.addEventListener('click', () => {
        if (callbacks.onAllowOpen) callbacks.onAllowOpen();
        this.destroySandboxViewer();
      });

      const footerActions = el('div', {
        className: 'mg-sandbox-footer-actions',
        children: [whitelistBtn, deleteBtn, allowBtn],
      });

      const sandboxFooter = el('div', {
        className: 'mg-sandbox-footer',
        children: [
          el('span', {
            className: 'mg-sandbox-footer-note',
            text: '🛡 Đây là phiên bản đã khử độc. Mọi link, ảnh và script đã bị vô hiệu hóa.',
          }),
          footerActions,
        ],
      });

      this._sandboxPanel.appendChild(header);
      this._sandboxPanel.appendChild(tabBar);
      this._sandboxPanel.appendChild(contentArea);
      this._sandboxPanel.appendChild(sandboxFooter);

      document.body.appendChild(this._sandboxPanel);

      requestAnimationFrame(() => {
        this._sandboxPanel.classList.add('mg-sandbox-enter');
      });
    }

    /**
     * Đóng và dọn sạch Sandbox Viewer.
     */
    destroySandboxViewer() {
      if (this._sandboxPanel) {
        this._sandboxPanel.remove();
        this._sandboxPanel = null;
      }
    }

    // ----------------------------------------------------------
    // 3. UI SHIELD OVERLAY
    // ----------------------------------------------------------

    /**
     * Gắn lớp khiên (Shield Overlay) lên một element (vùng nội dung email đã mở).
     * Người dùng phải xác nhận trước khi nội dung gốc hiển thị.
     *
     * @param {HTMLElement} targetElement - Element cần phủ khiên lên
     * @param {object} emailInfo - Thông tin email
     * @param {object} callbacks
     * @param {Function} callbacks.onViewSandbox - Callback "Xem Sandbox"
     * @param {Function} callbacks.onAllowAccess - Callback "Cho phép truy cập"
     */
    attachShield(targetElement, emailInfo, callbacks) {
      this.detachShield();

      if (!targetElement) return;

      // Đảm bảo element cha có position relative
      const parentStyle = window.getComputedStyle(targetElement);
      if (parentStyle.position === 'static') {
        targetElement.style.position = 'relative';
      }

      const shieldContent = el('div', { className: 'mg-shield-content' });

      const lockIcon = el('div', { className: 'mg-shield-icon', text: '🔒' });
      const shieldTitle = el('h3', {
        className: 'mg-shield-title',
        text: 'Nội dung bị chặn bởi Quarantine Guard',
      });
      const shieldDesc = el('p', {
        className: 'mg-shield-desc',
        text: `Email từ ${emailInfo.domain || 'domain không xác định'} đang bị cách ly. `
          + 'Nội dung thật sự chưa được hiển thị. Hãy chọn hành động:',
      });

      const shieldBtnSandbox = el('button', {
        className: 'mg-btn mg-btn-primary mg-btn-sm',
        text: '🛡 Xem trong Sandbox',
      });
      shieldBtnSandbox.addEventListener('click', () => {
        if (callbacks.onViewSandbox) callbacks.onViewSandbox();
      });

      const shieldBtnAllow = el('button', {
        className: 'mg-btn mg-btn-warning mg-btn-sm',
        text: '⚠️ Cho phép xem',
        attrs: { title: 'Gỡ khiên và hiển thị nội dung gốc' },
      });
      shieldBtnAllow.addEventListener('click', () => {
        if (callbacks.onAllowAccess) callbacks.onAllowAccess();
        this.detachShield();
      });

      const shieldActions = el('div', {
        className: 'mg-shield-actions',
        children: [shieldBtnSandbox, shieldBtnAllow],
      });

      shieldContent.appendChild(lockIcon);
      shieldContent.appendChild(shieldTitle);
      shieldContent.appendChild(shieldDesc);
      shieldContent.appendChild(shieldActions);

      this._shield = el('div', {
        className: 'mg-shield-overlay',
        id: 'mg-shield-overlay',
        children: [shieldContent],
      });

      targetElement.appendChild(this._shield);
    }

    /**
     * Gỡ bỏ Shield Overlay.
     */
    detachShield() {
      if (this._shield) {
        this._shield.remove();
        this._shield = null;
      }
    }

    // ----------------------------------------------------------
    // UTILITY
    // ----------------------------------------------------------

    /**
     * Hiển thị một thông báo nhỏ (toast) ở góc màn hình.
     * @param {string} message - Nội dung thông báo
     * @param {'info'|'success'|'warning'|'danger'} [type='info'] - Loại thông báo
     * @param {number} [duration=4000] - Thời gian hiển thị (ms)
     */
    showToast(message, type = 'info', duration = 4000) {
      const toast = el('div', {
        className: `mg-toast mg-toast-${type}`,
        text: message,
      });
      document.body.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.add('mg-toast-show');
        setTimeout(() => {
          toast.classList.remove('mg-toast-show');
          setTimeout(() => toast.remove(), 300);
        }, duration);
      });
    }

    /**
     * Gắn badge cảnh báo vào một element hàng email trong Inbox.
     * @param {HTMLElement} rowElement - Element hàng email (tr.zA)
     * @param {string} senderDomain - Domain của người gửi
     */
    markRowAsExternal(rowElement, senderDomain) {
      if (!rowElement || rowElement.dataset.mgMarked === 'true') return;

      rowElement.classList.add('mg-external-row');
      rowElement.dataset.mgMarked = 'true';

      // Tìm vị trí tốt nhất để gắn badge: ô tiêu đề hoặc cột người gửi
      const targetCell = rowElement.querySelector('.bog') ||
                         rowElement.querySelector('td.subject') ||
                         rowElement.querySelector('.y6') ||
                         rowElement.querySelector('td.tLft') ||
                         rowElement.querySelector('td.yX') ||
                         rowElement.querySelector('td:nth-child(5)') ||
                         rowElement.querySelector('td:nth-child(4)') ||
                         rowElement;

      if (targetCell && !rowElement.querySelector('.mg-external-badge')) {
        const badge = el('span', {
          className: 'mg-external-badge',
          text: `⚠ EXTERNAL @${senderDomain || '?'}`,
          attrs: { title: `Email từ domain ngoài Whitelist: @${senderDomain}` },
        });
        targetCell.insertBefore(badge, targetCell.firstChild);
      }
    }

    /**
     * Xóa badge cảnh báo khỏi một hàng email.
     * @param {HTMLElement} rowElement
     */
    unmarkRow(rowElement) {
      if (!rowElement) return;
      rowElement.classList.remove('mg-external-row');
      rowElement.dataset.mgMarked = '';
      const badge = rowElement.querySelector('.mg-external-badge');
      if (badge) badge.remove();
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.QuarantineUI = QuarantineUI;

  console.log('[MailGuard] QuarantineUI đã sẵn sàng.');
})(window);
