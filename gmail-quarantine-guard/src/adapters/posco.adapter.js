/**
 * @file posco.adapter.js
 * @namespace window.MailGuard
 * @description [PLATFORM ADAPTER] Adapter cho POSCO Webmail (Lotus Notes / HCL Domino .nsf)
 *
 * Chứa kiến thức về DOM của POSCO Webmail:
 *   - Selectors cho hàng email Inbox (table#mailList_inbox tbody tr)
 *   - Nhận diện hàng Inbox và cấu trúc tiêu đề, tên người gửi
 *   - Chặn / khôi phục inline onclick/ondblclick trên các liên kết
 *   - Nhận diện Màn hình Đọc Chi Tiết (div.write-content, #mailBodyArea, v.v.)
 *
 * Các chức năng mạng chuyên sâu và báo cáo đã được tách thành các module con:
 *   - PoscoDominoFetcher (src/adapters/posco-domino-fetcher.js): HTTP fetch, cache, và trích xuất HTML Domino
 *   - PoscoSpamReporter (src/adapters/posco-spam-reporter.js): Tự động hóa báo cáo Spam Center
 *
 * Phiên bản selector: POSCO Webmail (HCL Domino NSF) 2024-2025
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  // ============================================================
  // POSCO WEBMAIL DOM SELECTORS
  // ============================================================

  const POSCO_SELECTORS = {
    /** Bảng Inbox chính */
    INBOX_TABLE: 'table#mailList_inbox',

    /** Hàng email trong Inbox — mỗi hàng có checkbox với name = docId */
    INBOX_ROW_CHECKBOX: 'input[type="checkbox"][name]',

    /** Cột tiêu đề */
    SUBJECT_CELL: 'td.subject a',

    /** Cột người gửi (tên hiển thị) */
    SENDER_CELL: 'td.tLft span.td-name',

    /** Biểu tượng nhóm nội bộ (Gr / 그룹) */
    INTERNAL_GROUP_ICON: 'td.ico-gr',

    /** Nút mở thư trong cửa sổ mới */
    NEW_WINDOW_BUTTON: 'a.btn_newwin[onclick*="opendoc"]',

    /** Vùng nội dung thư khi đọc chi tiết (hỗ trợ nhiều container giao diện POSCO/Domino) */
    EMAIL_CONTENT_AREA: '#mailBodyArea, #mailViewArea, .mail-view-wrap, div.view-content, div.mail-content, div#viewContent, div#bodyArea, div.write-content',

    /** Vùng thông tin người gửi khi đọc chi tiết */
    SENDER_INFO: 'div#write_send_info',

    /** Vùng đính kèm khi đọc chi tiết */
    ATTACHMENT_AREA: 'div#attach_layer',
  };

  // ============================================================
  // CLASS PoscoAdapter
  // ============================================================

  /**
   * @class PoscoAdapter
   * @description Adapter cho nền tảng POSCO Webmail (HCL Domino / Lotus Notes).
   */
  class PoscoAdapter {
    constructor() {
      /** @type {string} Tên adapter (để debug và nhận diện) */
      this.name = 'PoscoAdapter';
      this.isPosco = true;

      /** @type {string} Selector của vùng nội dung email */
      this.contentAreaSelector = POSCO_SELECTORS.EMAIL_CONTENT_AREA;

      // Khởi tạo các module con phụ trách mạng và tự động hóa
      const FetcherClass = global.MailGuard.PoscoDominoFetcher;
      this.fetcher = FetcherClass ? new FetcherClass(POSCO_SELECTORS) : null;

      const SpamReporterClass = global.MailGuard.PoscoSpamReporter;
      this.spamReporter = SpamReporterClass ? new SpamReporterClass(POSCO_SELECTORS) : null;

      if (!this.fetcher) {
        console.warn('[PoscoAdapter] PoscoDominoFetcher chưa được nạp!');
      }
      if (!this.spamReporter) {
        console.warn('[PoscoAdapter] PoscoSpamReporter chưa được nạp!');
      }
    }

    /**
     * Proxy cache để tương thích ngược nếu có module truy cập `adapter._cache`.
     */
    get _cache() {
      return this.fetcher ? this.fetcher._cache : new Map();
    }

    // ----------------------------------------------------------
    // INBOX SCANNING
    // ----------------------------------------------------------

    /**
     * Lấy tất cả hàng email trong Inbox hiện tại.
     * Chỉ trả về các <tr> có checkbox mang thuộc tính name (= docId).
     * @returns {HTMLElement[]}
     */
    getInboxRows() {
      return Array.from(
        document.querySelectorAll(`${POSCO_SELECTORS.INBOX_TABLE} tbody tr`)
      ).filter((tr) => tr.querySelector(POSCO_SELECTORS.INBOX_ROW_CHECKBOX));
    }

    /**
     * Đọc địa chỉ email người gửi từ một hàng email.
     * Cố gắng đọc nhanh từ cache hoặc DOM trước, nếu chưa có thì trả về
     * "unverified@external.mail" để kích hoạt cách ly an toàn.
     *
     * @param {HTMLElement} row - Hàng email <tr>
     * @returns {string|null}
     */
    getSenderFromRow(row) {
      if (!row) return null;

      const docId = this._getDocId(row);

      // Nếu đã có cache từ fetcher, trả về luôn
      if (docId && this.fetcher && this.fetcher._cache.has(docId)) {
        return this.fetcher._cache.get(docId).senderEmail || null;
      }

      // Đọc nhanh từ DOM attributes/text
      const domEmail = this._extractSenderFromRowDOM(row);
      if (domEmail) return domEmail;

      // Tuyệt đối KHÔNG tự ý giả định là internal@posco.net khi chưa xác thực!
      return 'unverified@external.mail';
    }

    /**
     * Đọc tiêu đề email từ hàng email.
     * @param {HTMLElement} row
     * @returns {string}
     */
    getSubjectFromRow(row) {
      if (!row) return '';
      const subjectLink = row.querySelector(
        'td.subject a, a[onclick*="btn_OnClick"], a[data-orig-onclick*="btn_OnClick"], a[onclick*="opendoc"], a[data-orig-onclick*="opendoc"], td.title a, td.tLft a, a.mail_title, td a'
      );
      if (subjectLink) {
        const title = subjectLink.getAttribute('title') || subjectLink.innerText || subjectLink.textContent || '';
        if (title.trim()) return title.trim();
      }
      const subjectCell = row.querySelector('td.subject, td.title');
      if (subjectCell) {
        return (subjectCell.getAttribute('title') || subjectCell.innerText || subjectCell.textContent || '').trim();
      }
      return '';
    }

    /**
     * Kiểm tra xem một DOM node có phải là hàng email Inbox POSCO không.
     * @param {Node} node
     * @returns {boolean}
     */
    isInboxRow(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.tagName === 'TR') {
        return !!node.querySelector(POSCO_SELECTORS.INBOX_ROW_CHECKBOX) &&
               !!node.closest(POSCO_SELECTORS.INBOX_TABLE);
      }
      return !!node.querySelector?.(`${POSCO_SELECTORS.INBOX_TABLE} tbody tr`) ||
             !!node.querySelector?.(POSCO_SELECTORS.INBOX_ROW_CHECKBOX);
    }

    // ----------------------------------------------------------
    // ASYNC DATA EXTRACTION (Delegates to PoscoDominoFetcher)
    // ----------------------------------------------------------

    /**
     * Quét ngầm để lấy đầy đủ thông tin một dòng thư (ủy quyền cho PoscoDominoFetcher).
     * @param {HTMLElement} row - Hàng email <tr>
     * @returns {Promise<{id:string, subject:string, senderName:string, senderEmail:string, snippet:string, rawHtml:string}>}
     */
    async extractRowData(row) {
      const subject = this.getSubjectFromRow(row);
      const senderCellText = row.querySelector(POSCO_SELECTORS.SENDER_CELL)?.innerText.trim() || '';

      if (this.fetcher) {
        return this.fetcher.extractRowData(row, subject, senderCellText);
      }

      // Fallback nếu fetcher chưa sẵn sàng
      const docId = this._getDocId(row);
      const domEmail = this._extractSenderFromRowDOM(row);
      return {
        id: docId || '',
        subject,
        senderName: senderCellText || 'Không rõ',
        senderEmail: domEmail || 'unverified@external.mail',
        snippet: '',
        rawHtml: '',
      };
    }

    // ----------------------------------------------------------
    // EMAIL VIEW MODE (Đọc chi tiết)
    // ----------------------------------------------------------

    /**
     * Kiểm tra xem một DOM node có phải là vùng nội dung email POSCO không.
     * @param {Node} node
     * @returns {boolean}
     */
    isEmailContentArea(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.(POSCO_SELECTORS.EMAIL_CONTENT_AREA) || false;
    }

    /**
     * Kiểm tra xem một node có đại diện cho chuyển view hay không.
     * @param {Element} node
     * @returns {boolean}
     */
    isViewTransition(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches?.('#mailBodyArea, #mailViewArea, .mail-view-wrap, .write-content') || false;
    }

    /**
     * Lấy vùng nội dung email đang được đọc.
     * @returns {HTMLElement|null}
     */
    getEmailContentArea() {
      const candidates = [
        '#mailBodyArea',
        '#mailViewArea',
        '.mail-view-wrap',
        'div.view-content',
        'div#viewContent',
        'div.mail-content',
        'div#mail_content',
        'div#bodyArea',
        'div#docBody',
        'td.viewContent',
        'div.write-content',
        'iframe#mailBody',
        'iframe[name*="mail"]'
      ];

      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return document.querySelector(POSCO_SELECTORS.EMAIL_CONTENT_AREA);
    }

    /**
     * Lấy vùng đính kèm của email đang được đọc.
     * @returns {HTMLElement|null}
     */
    getAttachmentArea() {
      return document.querySelector(POSCO_SELECTORS.ATTACHMENT_AREA);
    }

    /**
     * Lấy email người gửi khi đang đọc chi tiết.
     * @returns {string|null}
     */
    getCurrentEmailSender() {
      const sendInfo = document.querySelector(POSCO_SELECTORS.SENDER_INFO);
      if (!sendInfo) return null;
      const text = sendInfo.innerText || '';
      return this._extractEmailFromText(text);
    }

    /**
     * Lấy tiêu đề email khi đang đọc chi tiết.
     * @returns {string}
     */
    getCurrentEmailSubject() {
      const subjectInput = document.querySelector('input#subject, div.subject-view, td.subject-text');
      return subjectInput
        ? (subjectInput.value || subjectInput.innerText || '').trim()
        : '';
    }

    /**
     * Nhận diện toàn bộ Màn hình Đọc Chi Tiết.
     * @returns {{ bodyElement: HTMLElement, sendInfo: HTMLElement, attachmentElement: HTMLElement|null, senderEmail: string }|null}
     */
    getOpenDetailView() {
      const bodyElement = document.querySelector(POSCO_SELECTORS.EMAIL_CONTENT_AREA);
      const sendInfo = document.querySelector(POSCO_SELECTORS.SENDER_INFO);

      if (!bodyElement || !sendInfo) return null;

      const senderEmail = this._extractEmailFromText(sendInfo.innerText || '');
      const attachmentElement = document.querySelector(POSCO_SELECTORS.ATTACHMENT_AREA);

      return {
        bodyElement,
        sendInfo,
        attachmentElement,
        senderEmail: senderEmail || 'unverified@external.mail',
      };
    }

    // ----------------------------------------------------------
    // CHẶN & KHÔI PHỤC SỰ KIỆN MỞ THƯ
    // ----------------------------------------------------------

    /**
     * Lấy tất cả phần tử có inline onclick/ondblclick trên hàng thư.
     * @param {HTMLElement} row
     * @returns {HTMLElement[]}
     */
    getRowClickTargets(row) {
      if (!row) return [];
      const targets = [];
      const subjectLink = row.querySelector(POSCO_SELECTORS.SUBJECT_CELL);
      if (subjectLink) targets.push(subjectLink);

      const newWinBtn = row.querySelector(POSCO_SELECTORS.NEW_WINDOW_BUTTON);
      if (newWinBtn) targets.push(newWinBtn);

      row.querySelectorAll(
        '[onclick*="btn_OnClick"], [onclick*="btn_OnDbClick"], [ondblclick*="btn_OnDbClick"], [data-orig-onclick*="btn_OnClick"], [data-orig-ondblclick*="btn_OnDbClick"]'
      ).forEach((el) => {
        if (!targets.includes(el)) targets.push(el);
      });
      return targets;
    }

    /**
     * Khóa cứng dòng thư: lưu onclick/ondblclick gốc rồi xóa attribute.
     * @param {HTMLElement} row
     */
    lockRow(row) {
      if (!row || row.dataset.mgPoscoLocked === 'true') return;

      const targets = this.getRowClickTargets(row);
      for (const el of targets) {
        const origOnclick = el.getAttribute('onclick');
        if (origOnclick) {
          el.dataset.origOnclick = origOnclick;
          el.removeAttribute('onclick');
        }
        const origOndblclick = el.getAttribute('ondblclick');
        if (origOndblclick) {
          el.dataset.origOndblclick = origOndblclick;
          el.removeAttribute('ondblclick');
        }
      }

      row.dataset.mgPoscoLocked = 'true';
    }

    /**
     * Khôi phục onclick/ondblclick gốc và mở thư.
     * @param {HTMLElement} row
     */
    openRowNormally(row) {
      if (!row) return;

      const targets = this.getRowClickTargets(row);
      for (const el of targets) {
        if (el.dataset.origOnclick) {
          el.setAttribute('onclick', el.dataset.origOnclick);
          try {
            el.onclick = new Function('event', el.dataset.origOnclick);
          } catch (_) {}
          delete el.dataset.origOnclick;
        }
        if (el.dataset.origOndblclick) {
          el.setAttribute('ondblclick', el.dataset.origOndblclick);
          try {
            el.ondblclick = new Function('event', el.dataset.origOndblclick);
          } catch (_) {}
          delete el.dataset.origOndblclick;
        }
      }

      row.dataset.mgPoscoLocked = 'false';

      // Click vào link tiêu đề để mở thư
      const subjectLink = row.querySelector(POSCO_SELECTORS.SUBJECT_CELL) || row;
      ['mousedown', 'mouseup', 'click'].forEach((type) => {
        subjectLink.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      });
      if (typeof subjectLink.click === 'function') {
        subjectLink.click();
      }
    }

    /**
     * Mở email (chuẩn interface của Orchestrator).
     * @param {HTMLElement} row
     */
    openEmail(row) {
      this.openRowNormally(row);
    }

    /**
     * Xóa email / Báo cáo Phishing (chuẩn interface của Orchestrator).
     * @param {HTMLElement} row
     */
    deleteEmail(row) {
      this.reportPhishingFromInbox(row);
    }

    /**
     * Lấy nội dung HTML thô của email để đưa vào Sandbox Viewer.
     * Ủy quyền cho PoscoDominoFetcher.
     * @param {HTMLElement|string} row - Hàng email hoặc docId
     * @returns {Promise<string>}
     */
    async fetchEmailHTML(row) {
      const subject = typeof row === 'object' ? this.getSubjectFromRow(row) : '';
      const sender = typeof row === 'object' ? this.getSenderFromRow(row) : '';

      if (this.fetcher) {
        return this.fetcher.fetchEmailHTML(row, subject, sender);
      }

      return `<div style="padding: 16px; font-family: sans-serif;">
        <p><strong>Người gửi:</strong> ${sender || 'Không rõ'}</p>
        <p><strong>Tiêu đề:</strong> ${subject || '(Không có tiêu đề)'}</p>
      </div>`;
    }

    /**
     * Trích xuất HTML của contentArea (ủy quyền cho fetcher).
     * @param {HTMLElement} contentArea
     * @returns {string}
     */
    _extractContentAreaHTML(contentArea) {
      if (this.fetcher) {
        return this.fetcher.extractContentAreaHTML(contentArea);
      }
      return contentArea ? contentArea.innerHTML : '';
    }

    // ----------------------------------------------------------
    // BÁO CÁO PHISHING (Ủy quyền cho PoscoSpamReporter)
    // ----------------------------------------------------------

    /**
     * Tự động hóa Báo cáo Phishing từ Inbox.
     * @param {HTMLElement} row
     */
    reportPhishingFromInbox(row) {
      if (this.spamReporter) {
        this.spamReporter.reportPhishingFromInbox(row);
      } else {
        console.warn('[PoscoAdapter] PoscoSpamReporter không khả dụng.');
      }
    }

    /**
     * Tự động hóa Báo cáo Phishing từ Màn hình Đọc Chi Tiết.
     */
    reportPhishingFromDetail() {
      if (this.spamReporter) {
        this.spamReporter.reportPhishingFromDetail();
      } else {
        console.warn('[PoscoAdapter] PoscoSpamReporter không khả dụng.');
      }
    }

    // ----------------------------------------------------------
    // PRIVATE HELPERS (Tương thích ngược)
    // ----------------------------------------------------------

    /**
     * Lấy docId từ checkbox hoặc clickables của hàng.
     * @param {HTMLElement} row
     * @returns {string|null}
     * @private
     */
    _getDocId(row) {
      return this.fetcher ? this.fetcher.getDocId(row) : null;
    }

    /**
     * Lấy đường dẫn NSF từ link hoặc location.
     * @param {HTMLElement} [row]
     * @returns {string|null}
     * @private
     */
    _getNsfPath(row) {
      return this.fetcher ? this.fetcher.getNsfPath(row) : null;
    }

    /**
     * Trích xuất sender trực tiếp từ DOM.
     * @param {HTMLElement} row
     * @returns {string|null}
     * @private
     */
    _extractSenderFromRowDOM(row) {
      return this.fetcher ? this.fetcher.extractSenderFromRowDOM(row) : null;
    }

    /**
     * Trích xuất email từ text.
     * @param {string} text
     * @returns {string|null}
     * @private
     */
    _extractEmailFromText(text) {
      return this.fetcher ? this.fetcher.extractEmailFromText(text) : null;
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.PoscoAdapter = PoscoAdapter;

  console.log('[MailGuard] PoscoAdapter đã sẵn sàng (Modularized).');
})(window);
