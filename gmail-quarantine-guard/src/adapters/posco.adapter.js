/**
 * @file posco.adapter.js
 * @namespace window.MailGuard
 * @description [PLATFORM ADAPTER] Adapter cho POSCO Webmail (Lotus Notes / HCL Domino .nsf)
 *
 * Chứa toàn bộ kiến thức về DOM của POSCO Webmail:
 *   - Selectors cho hàng email Inbox (table#mailList_inbox tbody tr)
 *   - Cách đọc địa chỉ người gửi, tiêu đề email từ DOM (bao gồm Background Fetch + Cache)
 *   - Cách chặn / khôi phục inline onclick/ondblclick
 *   - Cách nhận diện Màn hình Đọc Chi Tiết (div.write-content)
 *   - Tự động hóa Báo cáo Phishing qua Spam Center
 *
 * ⚠️ LƯU Ý: File này tuân thủ chính xác Method Signatures mà orchestrator.js đang gọi,
 * để khi cắm vào Orchestrator thì mọi tính năng Modal, Khử độc, Cách ly tự chạy ngay.
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
  // HELPER: Trích xuất đường dẫn .nsf từ DOM
  // ============================================================

  /**
   * Tìm đường dẫn .nsf từ onclick attribute hoặc location.pathname.
   * Ví dụ: "/363/mail4/202154.nsf" từ onclick="btn_OnClick('/363/mail4/202154.nsf','C786...','',this)"
   * @returns {string|null}
   */
  function _extractNsfPath() {
    // 1. Ưu tiên lấy từ onclick hoặc data-orig-onclick của link tiêu đề bất kỳ trong Inbox
    const subjectLink = document.querySelector(`${POSCO_SELECTORS.INBOX_TABLE} ${POSCO_SELECTORS.SUBJECT_CELL}`) ||
                        document.querySelector('a[onclick*=".nsf"], a[data-orig-onclick*=".nsf"]');
    if (subjectLink) {
      const onclick = subjectLink.getAttribute('onclick') || subjectLink.dataset?.origOnclick || '';
      const match = onclick.match(/['"]([^'"]*\.nsf)['"]/i);
      if (match) {
        let p = match[1];
        if (!p.startsWith('/')) p = '/' + p;
        return p;
      }
    }
    // 2. Thử lấy từ query param dn= (chuẩn XML_Inbox của Domino)
    try {
      const params = new URLSearchParams(location.search);
      const dn = params.get('dn');
      if (dn && dn.includes('.nsf')) {
        const m = dn.match(/(\/[^?#&]*\.nsf)/i);
        if (m) return m[1];
      }
    } catch (_) {}

    // 3. Fallback: lấy từ location.pathname
    if (location.pathname && location.pathname.includes('.nsf')) {
      const m = location.pathname.match(/(\/[^?#&]*\.nsf)/i);
      if (m) return m[1];
    }

    return null;
  }

  // ============================================================
  // CLASS PoscoAdapter
  // ============================================================

  /**
   * @class PoscoAdapter
   * @description Adapter cho nền tảng POSCO Webmail (HCL Domino / Lotus Notes).
   *
   * Interface chuẩn (tương thích orchestrator.js):
   *   - name: string
   *   - contentAreaSelector: string
   *   - getInboxRows(): HTMLElement[]
   *   - getSenderFromRow(row): string|null           ← gọi extractRowData nội bộ
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
   *
   * Mở rộng riêng cho POSCO:
   *   - extractRowData(row): Promise<object>          ← async fetch + cache
   *   - getRowClickTargets(row): HTMLElement[]
   *   - lockRow(row): void
   *   - openRowNormally(row): void
   *   - getOpenDetailView(): object|null
   *   - reportPhishingFromInbox(row): void
   *   - reportPhishingFromDetail(): void
   */
  class PoscoAdapter {
    constructor() {
      /** @type {string} Tên adapter (để debug) */
      this.name = 'PoscoAdapter';
      this.isPosco = true;

      /** @type {string} Selector của vùng nội dung email */
      this.contentAreaSelector = POSCO_SELECTORS.EMAIL_CONTENT_AREA;

      /** @type {Map<string, object>} Cache dữ liệu fetch theo docId — mỗi thư chỉ tải 1 lần */
      this._cache = new Map();

      /** @type {string|null} Đường dẫn .nsf đã tìm được */
      this._nsfPath = null;
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
      ).filter(tr => tr.querySelector(POSCO_SELECTORS.INBOX_ROW_CHECKBOX));
    }

    /**
     * Kiểm tra xem hàng thư có biểu tượng nhóm nội bộ (Gr / 그룹) thật sự hay không.
     * Lưu ý: Mọi hàng thư đều có ô <td class="ico-gr"> trong bảng HTML,
     * nên chỉ coi là có icon Gr nếu ô đó thực sự chứa ảnh, icon hoặc text "Gr"/"그룹".
     * @param {HTMLElement} row
     * @returns {boolean}
     */
    /**
     * Trích xuất email người gửi trực tiếp từ các thuộc tính hoặc text của hàng Inbox nếu có.
     * Kiểm tra: innerText, title, data-email, data-user, email, alt trên ô người gửi và các thẻ con.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    _extractSenderFromRowDOM(row) {
      if (!row) return null;
      const senderCell = row.querySelector(POSCO_SELECTORS.SENDER_CELL) || row.querySelector('td.tLft');
      if (!senderCell) return null;

      const candidates = [
        senderCell.innerText,
        senderCell.textContent,
        senderCell.getAttribute('title'),
        senderCell.getAttribute('data-email'),
        senderCell.getAttribute('data-user'),
        senderCell.getAttribute('email'),
        ...Array.from(senderCell.querySelectorAll('*')).flatMap(el => [
          el.getAttribute('title'),
          el.getAttribute('data-email'),
          el.getAttribute('data-user'),
          el.getAttribute('email'),
          el.getAttribute('alt')
        ])
      ];

      for (const val of candidates) {
        if (val && typeof val === 'string' && val.includes('@')) {
          const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match) return match[0].toLowerCase().trim();
        }
      }
      return null;
    }

    /**
     * Đọc địa chỉ email người gửi từ một hàng email.
     *
     * Do POSCO không hiển thị email đầy đủ ngay trên hàng Inbox,
     * hàm này cố gắng đọc nhanh từ cache hoặc DOM trước, nếu không được thì trả về
     * "unverified@external.mail" để kích hoạt cách ly an toàn.
     *
     * Phiên bản đầy đủ hơn là extractRowData() (async, có fetch).
     *
     * @param {HTMLElement} row - Hàng email <tr>
     * @returns {string|null}
     */
    getSenderFromRow(row) {
      if (!row) return null;

      const docId = this._getDocId(row);

      // Nếu đã có cache (đã fetch trước đó), trả về luôn
      if (docId && this._cache.has(docId)) {
        return this._cache.get(docId).senderEmail || null;
      }

      // Đọc nhanh từ DOM attributes/text
      const domEmail = this._extractSenderFromRowDOM(row);
      if (domEmail) return domEmail;

      // Tuyệt đối KHÔNG tự ý giả định là internal@posco.net khi chưa xác thực!
      // Trả về unverified@external.mail để bảo vệ an toàn
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
    // ASYNC DATA EXTRACTION (Background Fetch + Cache)
    // ----------------------------------------------------------

    /**
     * [MỞ RỘNG] Quét ngầm để lấy đầy đủ thông tin một dòng thư.
     * Trả về Object cùng cấu trúc mà orchestrator.js / quarantine-ui.js cần.
     *
     * Cơ chế Cache: mỗi docId chỉ fetch đúng 1 lần rồi lưu vào this._cache.
     *
     * @param {HTMLElement} row - Hàng email <tr>
     * @returns {Promise<{id:string, subject:string, senderName:string, senderEmail:string, snippet:string, rawHtml:string, hasInternalGrIcon:boolean}>}
     */
    async extractRowData(row) {
      const docId = this._getDocId(row);
      if (!docId) {
        return this._buildFallbackData(row, null);
      }

      // Trả cache nếu đã có
      if (this._cache.has(docId)) {
        return this._cache.get(docId);
      }

      const subject = this.getSubjectFromRow(row);
      const senderCellText = row.querySelector(POSCO_SELECTORS.SENDER_CELL)?.innerText.trim() || '';

      // 1. Kiểm tra nhanh nếu DOM của hàng đã có email đầy đủ (trong text hoặc title/data-*)
      const domEmail = this._extractSenderFromRowDOM(row);
      if (domEmail) {
        const data = {
          id: docId,
          subject,
          senderName: senderCellText || domEmail,
          senderEmail: domEmail,
          snippet: '',
          rawHtml: '',
        };
        this._cache.set(docId, data);
        return data;
      }

      // 2. Background Fetch tới tài liệu Domino để lấy header thực tế (INetFrom / From)
      try {
        const nsfPath = this._getNsfPath(row);
        if (!nsfPath) {
          return this._buildFallbackData(row, docId);
        }

        const url = `${location.origin}${nsfPath}/0/${docId}?OpenDocument`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          console.warn(`[PoscoAdapter] Fetch thất bại cho docId=${docId}: HTTP ${response.status}`);
          return this._buildFallbackData(row, docId);
        }

        const html = await response.text();
        const currentUserId = this._getCurrentUserId();

        // Trích xuất email người gửi chính xác (đã lọc bỏ SendTo và current user)
        const senderEmail = this._extractSenderEmailFromHTML(html, currentUserId) || 'unverified@external.mail';
        const senderName = senderCellText || senderEmail;

        // Trích xuất nội dung thư từ Domino HTML
        const rawHtml = this._extractBodyFromDominoHTML(html);
        let snippet = '';
        if (rawHtml) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = rawHtml;
          snippet = (tempDiv.textContent || '').trim().substring(0, 200);
        }

        const data = {
          id: docId,
          subject,
          senderName,
          senderEmail,
          snippet,
          rawHtml,
        };
        this._cache.set(docId, data);
        return data;

      } catch (err) {
        console.error(`[PoscoAdapter] Lỗi khi fetch dữ liệu cho docId=${docId}:`, err);
        return this._buildFallbackData(row, docId);
      }
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
     * POSCO Webmail thay đổi nội dung trang khi điều hướng giữa Inbox và Detail.
     * @param {Element} node
     * @returns {boolean}
     */
    isViewTransition(node) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      // Theo dõi sự xuất hiện/thay đổi của các container chính
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
     * Trích xuất từ div#write_send_info (ví dụ: "Nguyen Ngoc Tram Anh <anh.nnt@posco.net>").
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
      // POSCO thường có tiêu đề trong input#subject hoặc div.subject-view
      const subjectInput = document.querySelector('input#subject, div.subject-view, td.subject-text');
      return subjectInput
        ? (subjectInput.value || subjectInput.innerText || '').trim()
        : '';
    }

    /**
     * [MỞ RỘNG] Nhận diện toàn bộ Màn hình Đọc Chi Tiết.
     * Trả về cấu trúc Object để orchestrator.js gọi processDetailView / applyDetailViewShield.
     *
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
    // EMAIL ACTIONS
    // ----------------------------------------------------------


    /**
     * Mở email bằng cách gọi lại onclick gốc.
     * Được gọi sau khi người dùng chọn "Cho phép mở" trong Modal.
     * @param {HTMLElement} row
     */
    openEmail(row) {
      this.openRowNormally(row);
    }

    /**
     * Xóa email / Báo cáo Phishing thông qua Spam Center.
     * @param {HTMLElement} row
     */
    deleteEmail(row) {
      this.reportPhishingFromInbox(row);
    }

    // ----------------------------------------------------------
    // CHẶN & KHÔI PHỤC SỰ KIỆN MỞ THƯ (3.3)
    // ----------------------------------------------------------

    /**
     * Lấy tất cả phần tử có inline onclick/ondblclick trên hàng thư.
     * @param {HTMLElement} row
     * @returns {HTMLElement[]}
     */
    getRowClickTargets(row) {
      if (!row) return [];
      const targets = [];
      // Link tiêu đề (td.subject a)
      const subjectLink = row.querySelector(POSCO_SELECTORS.SUBJECT_CELL);
      if (subjectLink) targets.push(subjectLink);
      // Nút mở cửa sổ mới
      const newWinBtn = row.querySelector(POSCO_SELECTORS.NEW_WINDOW_BUTTON);
      if (newWinBtn) targets.push(newWinBtn);
      // Bất kỳ phần tử nào có onclick hoặc data-orig-onclick chứa "btn_OnClick" hoặc "btn_OnDbClick"
      row.querySelectorAll('[onclick*="btn_OnClick"], [onclick*="btn_OnDbClick"], [ondblclick*="btn_OnDbClick"], [data-orig-onclick*="btn_OnClick"], [data-orig-ondblclick*="btn_OnDbClick"]').forEach(el => {
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
        // Lưu onclick gốc
        const origOnclick = el.getAttribute('onclick');
        if (origOnclick) {
          el.dataset.origOnclick = origOnclick;
          el.removeAttribute('onclick');
        }
        // Lưu ondblclick gốc
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
     * Được gọi khi người dùng bấm "✅ Là Email Công việc (Mở bình thường)" trên Modal.
     * @param {HTMLElement} row
     */
    openRowNormally(row) {
      if (!row) return;

      const targets = this.getRowClickTargets(row);
      for (const el of targets) {
        // Khôi phục onclick
        if (el.dataset.origOnclick) {
          el.setAttribute('onclick', el.dataset.origOnclick);
          try {
            el.onclick = new Function('event', el.dataset.origOnclick);
          } catch (_) {}
          delete el.dataset.origOnclick;
        }
        // Khôi phục ondblclick
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
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        subjectLink.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
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
     * Xóa email (chuẩn interface của Orchestrator).
     * @param {HTMLElement} row
     */
    deleteEmail(row) {
      this.reportPhishingFromInbox(row);
    }

    /**
     * Lấy nội dung HTML thô của email để đưa vào Sandbox Viewer.
     * Ưu tiên:
     * 1. Cache từ extractRowData (nếu đã có rawHtml hợp lệ)
     * 2. Trực tiếp từ DOM nếu đang mở xem thư chi tiết (xử lý cả iframe và loại bỏ shield)
     * 3. Background Fetch tới URL OpenDocument của Domino và trích xuất body
     * @param {HTMLElement} row
     * @returns {Promise<string>}
     */
    /**
     * Lấy nội dung HTML thô của email để đưa vào Sandbox Viewer.
     * Ưu tiên:
     * 1. Cache từ extractRowData (nếu đã có rawHtml chứa nội dung text thực tế)
     * 2. Trực tiếp từ DOM nếu đang mở xem thư chi tiết và có nội dung văn bản thực tế
     * 3. Background Fetch tới URL OpenDocument của Domino và trích xuất body an toàn
     * @param {HTMLElement|string} row - Hàng email hoặc docId
     * @returns {Promise<string>}
     */
    async fetchEmailHTML(row) {
      const docId = (typeof row === 'string')
        ? row
        : (this._getDocId(row) || row?.dataset?.id || row?.dataset?.docid);

      // 1. Kiểm tra cache nếu đã có rawHtml thật sự có nội dung text
      if (docId && this._cache.has(docId)) {
        const cached = this._cache.get(docId);
        if (cached && cached.rawHtml && cached.rawHtml.trim()) {
          const textOnly = cached.rawHtml.replace(/<[^>]+>/g, '').trim();
          if (textOnly.length > 0) {
            return cached.rawHtml;
          }
        }
      }

      // 2. Nếu đang mở thư chi tiết trên DOM và có nội dung văn bản thực tế
      const openDOMHTML = this._extractContentFromOpenDOM();
      if (openDOMHTML && openDOMHTML.replace(/<[^>]+>/g, '').trim().length > 0) {
        if (docId && this._cache.has(docId)) {
          this._cache.get(docId).rawHtml = openDOMHTML;
        }
        return openDOMHTML;
      }

      // 3. Tải tài liệu Domino qua OpenDocument
      if (docId) {
        const nsfPath = this._getNsfPath(row);
        if (nsfPath) {
          const urlCandidates = [
            `${location.origin}${nsfPath}/0/${docId}?OpenDocument`,
            `${location.origin}${nsfPath}/XML_Inbox/${docId}?OpenDocument`,
            `${location.origin}${nsfPath}/($Inbox)/${docId}?OpenDocument`
          ];

          for (const url of urlCandidates) {
            try {
              console.log('[PoscoAdapter] Đang tải email từ:', url);
              const response = await fetch(url, { credentials: 'include' });
              if (response.ok) {
                const html = await response.text();
                if (html && html.trim().length > 0) {
                  const bodyHtml = this._extractBodyFromDominoHTML(html);
                  const bodyText = (bodyHtml || '').replace(/<[^>]+>/g, '').trim();
                  if (bodyText.length > 0) {
                    if (docId && this._cache.has(docId)) {
                      this._cache.get(docId).rawHtml = bodyHtml;
                    }
                    return bodyHtml;
                  }
                  if (docId && this._cache.has(docId)) {
                    this._cache.get(docId).rawHtml = html;
                  }
                  return html;
                }
              }
            } catch (e) {
              console.warn('[PoscoAdapter] Lỗi khi fetch từ ' + url + ':', e);
            }
          }
        }
      }

      // 4. Fallback: hiển thị thông tin email nếu không lấy được body
      const subject = this.getSubjectFromRow(row) || '';
      const sender = this.getSenderFromRow(row) || '';
      return `<div style="padding: 16px; font-family: sans-serif;">
        <p><strong>Người gửi:</strong> ${sender}</p>
        <p><strong>Tiêu đề:</strong> ${subject || '(Không có tiêu đề)'}</p>
        <p style="color: #64748b; font-style: italic;">(Không thể tải nội dung chi tiết từ Domino server cho mã tài liệu: ${docId || 'N/A'})</p>
      </div>`;
    }

    /**
     * Trích xuất nội dung email trực tiếp từ các element hoặc iframe đang mở trên DOM.
     * Chỉ trả về khi thực sự có nội dung văn bản (tránh trả về cấu trúc khung rỗng).
     * @returns {string}
     */
    _extractContentFromOpenDOM() {
      // 1. Kiểm tra tất cả iframe trên trang
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body) {
            const text = (doc.body.textContent || '').trim();
            if (text.length > 5 && !/^(about:blank|javascript:)/i.test(doc.location?.href || '')) {
              return doc.body.innerHTML;
            }
          }
        } catch (_) {}
      }

      // 2. Kiểm tra các container cụ thể của POSCO Webmail
      const candidates = [
        'div.write-content',
        'div.write_content',
        'div#write_content',
        'div.view-content',
        'div.view_content',
        'div#viewContent',
        'div.mail-content',
        'div#mail_content',
        'td.viewContent',
        'div#mailBodyArea',
        'div#mailViewArea',
        'div#bodyArea',
        'div#docBody'
      ];

      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) {
          const clone = el.cloneNode(true);
          const shield = clone.querySelector('#mg-shield-overlay, .mg-shield-overlay');
          if (shield) shield.remove();
          const text = (clone.textContent || '').trim();
          if (text.length > 5) {
            return clone.innerHTML;
          }
        }
      }

      return '';
    }

    /**
     * Trích xuất HTML từ DOM của vùng hiển thị email (xử lý cả iframe và loại bỏ shield overlay).
     * @param {HTMLElement} contentArea
     * @returns {string}
     */
    _extractContentAreaHTML(contentArea) {
      if (!contentArea) return '';
      // Kiểm tra nếu có iframe bên trong
      const iframe = contentArea.tagName === 'IFRAME' ? contentArea : contentArea.querySelector('iframe');
      if (iframe) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body && doc.body.innerHTML.trim()) {
            return doc.body.innerHTML;
          }
        } catch (_) {}
      }
      // Clone element và loại bỏ shield overlay nếu đang gắn trên đó
      const clone = contentArea.cloneNode(true);
      const shield = clone.querySelector('#mg-shield-overlay, .mg-shield-overlay');
      if (shield) shield.remove();
      return clone.innerHTML;
    }

    /**
     * Trích xuất nội dung thân email từ HTML trả về của Domino NSF (?OpenDocument).
     * Sử dụng DOMParser chuẩn để đảm bảo không bị cắt ngắn bởi các thẻ div lồng nhau hoặc bảng HTML.
     * @param {string} html
     * @returns {string}
     */
    _extractBodyFromDominoHTML(html) {
      if (!html || !html.trim()) return '';

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Loại bỏ các thẻ script, style, noscript, input, button, select, link
        doc.querySelectorAll('script, style, noscript, input, button, select, link').forEach(el => el.remove());

        // 2. Thử tìm container nội dung email cụ thể theo các class/id chuẩn của POSCO Webmail và Domino
        const candidates = [
          '.write-content',
          '.write_content',
          '#write-content',
          '#write_content',
          '.view-content',
          '.view_content',
          '#viewContent',
          '#view_content',
          '.mail-content',
          '.mail_content',
          '#mail_content',
          '#mailBodyArea',
          '#mailViewArea',
          '#mailBody',
          '#bodyArea',
          '#docBody',
          'td.viewContent',
          'span#Body',
          'div#Body',
          'td#Body',
          '[name="Body"]',
          '.mail-view-wrap'
        ];

        for (const sel of candidates) {
          const el = doc.querySelector(sel);
          if (el) {
            const text = (el.textContent || '').trim();
            if (text.length > 0) {
              return el.innerHTML.trim();
            }
          }
        }

        // 3. Nếu không tìm thấy qua container cụ thể, loại bỏ các bảng header rồi lấy form/body
        doc.querySelectorAll('#write_send_info, .mail-header, .header-table, .mail_head').forEach(el => el.remove());

        const tables = doc.querySelectorAll('table');
        for (const tbl of tables) {
          const text = (tbl.textContent || '').trim();
          if (/^(?:From|보낸사람|SendTo|INetFrom|Date|Subject):/i.test(text) && text.length < 300) {
            tbl.remove();
          }
        }

        const form = doc.querySelector('form');
        const target = form || doc.body;
        if (target) {
          const text = (target.textContent || '').trim();
          if (text.length > 0) {
            return target.innerHTML.trim();
          }
        }

        return html;
      } catch (e) {
        console.warn('[PoscoAdapter] DOMParser error, using fallback:', e);
        let content = html;
        content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        content = content.replace(/<input[^>]*>/gi, '');
        return content.trim();
      }
    }

    // ----------------------------------------------------------
    // BÁO CÁO PHISHING (3.5)
    // ----------------------------------------------------------

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
        // Bước 1: Bỏ tích tất cả checkbox đang checked trong bảng Inbox
        const allChecked = document.querySelectorAll(
          `${POSCO_SELECTORS.INBOX_TABLE} input[type="checkbox"]:checked`
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
          console.log('[PoscoAdapter] Đã click nút Spam Center.');

          // Bước 4: Đợi hộp thoại Spam Center hiện ra (tối đa 3 giây)
          this._waitForSpamCenterDialog();
        } else {
          console.warn('[PoscoAdapter] Không tìm thấy nút Spam Center trên toolbar.');
        }

      } catch (err) {
        console.error('[PoscoAdapter] Lỗi khi báo cáo Phishing:', err);
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
          console.log('[PoscoAdapter] Đã click nút Spam Center (Detail View).');
          this._waitForSpamCenterDialog();
        } else {
          console.warn('[PoscoAdapter] Không tìm thấy nút Spam Center trong Detail View.');
        }
      } catch (err) {
        console.error('[PoscoAdapter] Lỗi khi báo cáo Phishing từ Detail:', err);
      }
    }

    // ----------------------------------------------------------
    // PRIVATE HELPERS
    // ----------------------------------------------------------

    /**
     * Lấy docId từ checkbox name của hàng email.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    /**
     * Lấy docId từ checkbox hoặc onclick link của hàng email.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    /**
     * Lấy docId từ checkbox hoặc onclick / data-orig-onclick của hàng email.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    _getDocId(row) {
      if (!row) return null;

      const isUnid = str => typeof str === 'string' && /^[0-9a-fA-F]{16,32}$/i.test(str.trim());

      // 1. Thử lấy từ checkbox
      const cb = row.querySelector(POSCO_SELECTORS.INBOX_ROW_CHECKBOX) || row.querySelector('input[type="checkbox"]');
      if (cb) {
        const val = cb.getAttribute('value');
        if (isUnid(val)) return val.trim();
        const name = cb.getAttribute('name');
        if (isUnid(name)) return name.trim();
        if (val && val !== 'on' && val !== '1' && val !== '0' && val.length >= 8) {
          return val.trim();
        }
        if (name && name !== 'checkAll' && name !== 'selectAll' && !name.startsWith('$$')) {
          return name.trim();
        }
      }

      // 2. Thử lấy từ onclick hoặc data-orig-onclick của link tiêu đề hoặc các clickables
      const subjectLink = row.querySelector(POSCO_SELECTORS.SUBJECT_CELL);
      const links = [
        subjectLink,
        ...Array.from(row.querySelectorAll('a, [onclick], [data-orig-onclick]'))
      ];

      for (const el of links) {
        if (!el) continue;
        const onclickText = el.getAttribute('onclick') || el.dataset?.origOnclick || '';
        if (!onclickText) continue;

        // btn_OnClick('/...nsf', 'DOC_ID', ...)
        const btnMatch = onclickText.match(/btn_OnClick\([^,]+,\s*['"]([0-9a-fA-F]{8,32})['"]/i);
        if (btnMatch && btnMatch[1].trim()) return btnMatch[1].trim();

        // opendoc('DOC_ID') / openMail('DOC_ID')
        const openDocMatch = onclickText.match(/(?:openMail|openDoc|readMail|viewMail|opendoc)\s*\(\s*['"]([^'"]+)['"]/i);
        if (openDocMatch && openDocMatch[1].trim()) return openDocMatch[1].trim();

        // 32-hex character Domino UNID
        const unidMatch = onclickText.match(/\b([0-9a-fA-F]{32})\b/);
        if (unidMatch) return unidMatch[1];
      }

      // 3. Thử lấy từ dataset hoặc id của row
      if (row.dataset) {
        if (isUnid(row.dataset.id)) return row.dataset.id;
        if (isUnid(row.dataset.docid)) return row.dataset.docid;
        if (row.dataset.id) return row.dataset.id;
        if (row.dataset.docid) return row.dataset.docid;
      }
      if (row.id) {
        const m = row.id.match(/[0-9a-fA-F]{16,32}/);
        if (m) return m[0];
      }

      return null;
    }

    /**
     * Lấy ID tài khoản người dùng hiện tại từ URL NSF.
     * Ví dụ: /363/mail4/202154.nsf -> "202154"
     * @returns {string|null}
     */
    _getCurrentUserId() {
      const path = this._nsfPath || location.pathname || location.href;
      const m = path.match(/\/(\d+)\.nsf/i);
      return m ? m[1] : null;
    }

    /**
     * Tìm đường dẫn .nsf (cache lại sau lần tìm đầu tiên).
     * Tránh lỗi ghép URL kép domain.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    _getNsfPath(row) {
      if (this._nsfPath) return this._nsfPath;

      // 1. Lấy từ link tiêu đề hoặc onclick / data-orig-onclick trong hàng
      const subjectLink = row?.querySelector(POSCO_SELECTORS.SUBJECT_CELL);
      const clickables = [
        subjectLink,
        row,
        ...Array.from(row?.querySelectorAll('a, [onclick], [data-orig-onclick]') || [])
      ];

      for (const el of clickables) {
        if (!el) continue;
        const onclick = el.getAttribute('onclick') || el.dataset?.origOnclick || '';
        const match = onclick.match(/['"]([^'"]*\.nsf)['"]/i);
        if (match) {
          let p = match[1];
          if (!p.startsWith('/')) p = '/' + p;
          this._nsfPath = p;
          return this._nsfPath;
        }
      }

      // 2. Fallback: lấy an toàn từ location (tránh dính domain/hostname)
      // Thử query param dn= trước (chuẩn của Domino XML_Inbox)
      try {
        const params = new URLSearchParams(location.search);
        const dn = params.get('dn');
        if (dn && dn.includes('.nsf')) {
          const m = dn.match(/(\/[^?#&]*\.nsf)/i);
          if (m) {
            this._nsfPath = m[1];
            return this._nsfPath;
          }
        }
      } catch (_) {}

      // Thử location.pathname
      if (location.pathname && location.pathname.includes('.nsf')) {
        const m = location.pathname.match(/(\/[^?#&]*\.nsf)/i);
        if (m) {
          this._nsfPath = m[1];
          return this._nsfPath;
        }
      }

      // Thử parse location.href qua URL object
      try {
        const u = new URL(location.href);
        if (u.pathname && u.pathname.includes('.nsf')) {
          const m = u.pathname.match(/(\/[^?#&]*\.nsf)/i);
          if (m) {
            this._nsfPath = m[1];
            return this._nsfPath;
          }
        }
        const dn = u.searchParams.get('dn');
        if (dn && dn.includes('.nsf')) {
          const m = dn.match(/(\/[^?#&]*\.nsf)/i);
          if (m) {
            this._nsfPath = m[1];
            return this._nsfPath;
          }
        }
      } catch (_) {}

      return null;
    }

    /**
     * Trích xuất email từ chuỗi text (ví dụ: "Nguyen Ngoc Tram Anh <anh.nnt@posco.net>").
     * @param {string} text
     * @returns {string|null}
     */
    _extractEmailFromText(text) {
      if (!text) return null;
      const decoded = text
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

      const angleMatch = decoded.match(/<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/);
      if (angleMatch) return angleMatch[1].toLowerCase().trim();

      const plainMatch = decoded.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (plainMatch) return plainMatch[1].toLowerCase().trim();

      return null;
    }

    /**
     * Phân tích giá trị của trường người gửi trong Domino (email hoặc Notes hierarchical name).
     * @param {string} val
     * @returns {string|null}
     */
    _parseSenderFieldValue(val) {
      if (!val) return null;
      const email = this._extractEmailFromText(val);
      if (email) return email;

      // Nếu là định dạng nội bộ Notes: CN=Nguyen Ngoc Tram Anh/OU=.../O=POSCO hoặc /O=POSCO
      if (/(\/O=POSCO|\/POSCO|O=POSCO)/i.test(val)) {
        return 'internal@posco.net';
      }

      return null;
    }

    /**
     * Trích xuất email người gửi từ HTML response của fetch Domino (?OpenDocument).
     * Tuyệt đối tránh nhầm lẫn với SendTo / CopyTo (địa chỉ người nhận là chính user POSCO).
     *
     * @param {string} html
     * @param {string|null} currentUserId
     * @returns {string|null}
     */
    _extractSenderEmailFromHTML(html, currentUserId = null) {
      if (!html) return null;

      const senderFieldNames = 'INetFrom|InternetFrom|SMTPOriginator|AltFrom|_InternetFrom|From|Sender|ReplyTo';

      // 1. Thẻ input ẩn chuẩn của Domino: name="..." value="..."
      const inputPatternA = new RegExp(
        `<input[^>]+name\\s*=\\s*["'](?:${senderFieldNames})["'][^>]+value\\s*=\\s*["']([^"']+)["']`,
        'i'
      );
      const matchA = html.match(inputPatternA);
      if (matchA && matchA[1]) {
        const parsed = this._parseSenderFieldValue(matchA[1]);
        if (parsed) return parsed;
      }

      // 1b. Thẻ input ẩn đảo ngược thuộc tính: value="..." name="..."
      const inputPatternB = new RegExp(
        `<input[^>]+value\\s*=\\s*["']([^"']+)["'][^>]+name\\s*=\\s*["'](?:${senderFieldNames})["']`,
        'i'
      );
      const matchB = html.match(inputPatternB);
      if (matchB && matchB[1]) {
        const parsed = this._parseSenderFieldValue(matchB[1]);
        if (parsed) return parsed;
      }

      // 2. Vùng container write_send_info / send_info
      const sendInfoMatch = html.match(/id\s*=\s*["'](?:write_send_info|send_info|fromArea|senderInfo)["'][^>]*>([\s\S]*?)<\/(?:div|td|span)>/i);
      if (sendInfoMatch) {
        const parsed = this._parseSenderFieldValue(sendInfoMatch[1]);
        if (parsed) return parsed;
      }

      // 3. Bảng / Label hiển thị: 보낸사람 / From / Sender / Người gửi
      const headerMatch = html.match(
        /(?:보낸사람|From|Sender|Người gửi)\s*[:：]?\s*<\/(?:th|td|span|div|b|strong)>\s*<(?:td|span|div)[^>]*>([\s\S]*?)<\/(?:td|span|div)>/i
      ) || html.match(
        /(?:보낸사람|From|Sender|Người gửi)\s*[:：]?\s*([\s\S]{1,200}?)(?:<\/td>|<\/div>|<br|\n)/i
      );
      if (headerMatch && headerMatch[1]) {
        const parsed = this._parseSenderFieldValue(headerMatch[1]);
        if (parsed) return parsed;
      }

      // 4. Biến JavaScript: sFrom, sINetFrom, senderEmail, fromEmail
      const jsVarMatch = html.match(/(?:sFrom|sINetFrom|senderEmail|fromEmail|c_sFrom)\s*=\s*["']([^"']+)["']/i);
      if (jsVarMatch && jsVarMatch[1]) {
        const parsed = this._parseSenderFieldValue(jsVarMatch[1]);
        if (parsed) return parsed;
      }

      // 5. Hàm getFromDisplayInfo
      const displayInfoMatch = html.match(/getFromDisplayInfo\s*\(\s*\)\s*[\s\S]*?["']([^"']*@[^"']+)["']/i);
      if (displayInfoMatch) return displayInfoMatch[1].toLowerCase().trim();

      // 6. Generic regex an toàn: Tìm tất cả email trong tài liệu nhưng LOẠI TRỪ:
      //    - Email của chính tài khoản người nhận (currentUserId@posco...)
      //    - Email nằm trong thẻ SendTo, CopyTo, BlindCopyTo
      const allEmails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const candidate of allEmails) {
        const lower = candidate.toLowerCase().trim();
        if (currentUserId && lower.startsWith(currentUserId.toLowerCase() + '@')) {
          continue;
        }
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const isRecipient = new RegExp(`(?:SendTo|CopyTo|BlindCopyTo|DeliveredTo|recipient|받는사람|수신)[^>]*["']?[^"'>]*${escaped}`, 'i').test(html);
        if (!isRecipient) {
          return lower;
        }
      }

      return null;
    }

    /**
     * Tạo dữ liệu fallback an toàn khi không thể fetch.
     * @param {HTMLElement} row
     * @param {string|null} docId
     * @returns {object}
     */
    _buildFallbackData(row, docId) {
      const subject = this.getSubjectFromRow(row);
      const senderCellText = row?.querySelector(POSCO_SELECTORS.SENDER_CELL)?.innerText.trim() || '';

      const domEmail = this._extractSenderFromRowDOM(row);
      const senderEmail = domEmail || 'unverified@external.mail';

      const data = {
        id: docId || '',
        subject,
        senderName: senderCellText || 'Không rõ',
        senderEmail,
        snippet: '',
        rawHtml: '',
      };

      if (docId) {
        this._cache.set(docId, data);
      }
      return data;
    }

    /**
     * Đợi hộp thoại Spam Center hiện ra rồi tự động:
     * - Tích chọn radio thứ 2 ("Delete Spam & Rules & Report")
     * - Làm nổi bật nút OK
     * Timeout tối đa 3 giây.
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
            console.log('[PoscoAdapter] Đã chọn radio "Delete Spam & Rules & Report".');
          }

          // Tìm và làm nổi bật nút OK
          const allButtons = document.querySelectorAll('button, input[type="button"], a.btn');
          for (const btn of allButtons) {
            const text = (btn.textContent || btn.value || '').trim().toLowerCase();
            if (text === 'ok' || text === 'xác nhận' || text === 'confirm') {
              btn.style.outline = '3px solid #ef4444';
              btn.style.outlineOffset = '2px';
              btn.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.6)';
              console.log('[PoscoAdapter] Đã làm nổi bật nút OK. Chờ người dùng xác nhận.');
              break;
            }
          }

          clearInterval(interval);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.warn('[PoscoAdapter] Timeout: Không tìm thấy hộp thoại Spam Center sau 3 giây.');
        }
      }, 100);
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.PoscoAdapter = PoscoAdapter;

  console.log('[MailGuard] PoscoAdapter đã sẵn sàng.');
})(window);
