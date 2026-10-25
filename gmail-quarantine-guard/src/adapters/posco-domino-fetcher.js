/**
 * @file posco-domino-fetcher.js
 * @namespace window.MailGuard.PoscoDominoFetcher
 * @description [POSCO SUB-MODULE] Quản lý tương tác mạng và phân tích cú pháp Domino NSF cho POSCO Webmail.
 *
 * Chịu trách nhiệm:
 *   - Xác định đường dẫn cơ sở dữ liệu NSF (.nsf) và mã tài liệu (UNID/docId)
 *   - Fetch dữ liệu tài liệu ngầm (background fetch) qua HTTP / XML_Inbox / OpenDocument
 *   - Phân tích cú pháp HTML Domino để trích xuất header (INetFrom / From) và thân email (Body)
 *   - Quản lý bộ nhớ đệm (Cache) theo docId để tối ưu hiệu năng
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  /**
   * @class PoscoDominoFetcher
   */
  class PoscoDominoFetcher {
    /**
     * @param {object} selectors - DOM selectors từ PoscoAdapter
     */
    constructor(selectors = {}) {
      this.selectors = selectors;

      /** @type {Map<string, object>} Cache dữ liệu fetch theo docId — mỗi thư chỉ tải 1 lần */
      this._cache = new Map();

      /** @type {string|null} Đường dẫn .nsf đã tìm được */
      this._nsfPath = null;
    }

    /**
     * Trích xuất đường dẫn .nsf từ DOM (nếu có).
     * @returns {string|null}
     */
    extractNsfPath() {
      const subjectSelector = this.selectors.SUBJECT_CELL || 'td.subject a';
      const inboxTableSelector = this.selectors.INBOX_TABLE || 'table#mailList_inbox';

      // 1. Ưu tiên lấy từ onclick hoặc data-orig-onclick của link tiêu đề bất kỳ trong Inbox
      const subjectLink =
        document.querySelector(`${inboxTableSelector} ${subjectSelector}`) ||
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

    /**
     * Tìm đường dẫn .nsf (cache lại sau lần tìm đầu tiên).
     * @param {HTMLElement} [row]
     * @returns {string|null}
     */
    getNsfPath(row) {
      if (this._nsfPath) return this._nsfPath;

      // 1. Lấy từ link tiêu đề hoặc onclick / data-orig-onclick trong hàng
      const subjectCell = this.selectors.SUBJECT_CELL || 'td.subject a';
      const subjectLink = row?.querySelector(subjectCell);
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

      // 2. Fallback: lấy an toàn từ location
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

      if (location.pathname && location.pathname.includes('.nsf')) {
        const m = location.pathname.match(/(\/[^?#&]*\.nsf)/i);
        if (m) {
          this._nsfPath = m[1];
          return this._nsfPath;
        }
      }

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
     * Lấy ID tài khoản người dùng hiện tại từ URL NSF.
     * Ví dụ: /363/mail4/202154.nsf -> "202154"
     * @returns {string|null}
     */
    getCurrentUserId() {
      const path = this._nsfPath || location.pathname || location.href;
      const m = path.match(/\/(\d+)\.nsf/i);
      return m ? m[1] : null;
    }

    /**
     * Lấy docId từ checkbox hoặc onclick / data-orig-onclick của hàng email.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    getDocId(row) {
      if (!row) return null;

      const isUnid = (str) => typeof str === 'string' && /^[0-9a-fA-F]{16,32}$/i.test(str.trim());

      // 1. Thử lấy từ checkbox
      const checkboxSel = this.selectors.INBOX_ROW_CHECKBOX || 'input[type="checkbox"][name]';
      const cb = row.querySelector(checkboxSel) || row.querySelector('input[type="checkbox"]');
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
      const subjectLink = row.querySelector(this.selectors.SUBJECT_CELL || 'td.subject a');
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
     * Trích xuất email người gửi trực tiếp từ các thuộc tính hoặc text của hàng Inbox nếu có.
     * @param {HTMLElement} row
     * @returns {string|null}
     */
    extractSenderFromRowDOM(row) {
      if (!row) return null;
      const senderSelector = this.selectors.SENDER_CELL || 'td.tLft span.td-name';
      const senderCell = row.querySelector(senderSelector) || row.querySelector('td.tLft');
      if (!senderCell) return null;

      const candidates = [
        senderCell.innerText,
        senderCell.textContent,
        senderCell.getAttribute('title'),
        senderCell.getAttribute('data-email'),
        senderCell.getAttribute('data-user'),
        senderCell.getAttribute('email'),
        ...Array.from(senderCell.querySelectorAll('*')).flatMap((el) => [
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
     * Trích xuất email từ chuỗi text (ví dụ: "Nguyen Ngoc Tram Anh <anh.nnt@posco.net>").
     * @param {string} text
     * @returns {string|null}
     */
    extractEmailFromText(text) {
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
    parseSenderFieldValue(val) {
      if (!val) return null;
      const email = this.extractEmailFromText(val);
      if (email) return email;

      // Nếu là định dạng nội bộ Notes: CN=Nguyen Ngoc Tram Anh/OU=.../O=POSCO hoặc /O=POSCO
      if (/(\/O=POSCO|\/POSCO|O=POSCO)/i.test(val)) {
        return 'internal@posco.net';
      }

      return null;
    }

    /**
     * Trích xuất email người gửi từ HTML response của fetch Domino (?OpenDocument).
     * @param {string} html
     * @param {string|null} currentUserId
     * @returns {string|null}
     */
    extractSenderEmailFromHTML(html, currentUserId = null) {
      if (!html) return null;

      const senderFieldNames = 'INetFrom|InternetFrom|SMTPOriginator|AltFrom|_InternetFrom|From|Sender|ReplyTo';

      // 1. Thẻ input ẩn chuẩn của Domino: name="..." value="..."
      const inputPatternA = new RegExp(
        `<input[^>]+name\\s*=\\s*["'](?:${senderFieldNames})["'][^>]+value\\s*=\\s*["']([^"']+)["']`,
        'i'
      );
      const matchA = html.match(inputPatternA);
      if (matchA && matchA[1]) {
        const parsed = this.parseSenderFieldValue(matchA[1]);
        if (parsed) return parsed;
      }

      // 1b. Thẻ input ẩn đảo ngược thuộc tính: value="..." name="..."
      const inputPatternB = new RegExp(
        `<input[^>]+value\\s*=\\s*["']([^"']+)["'][^>]+name\\s*=\\s*["'](?:${senderFieldNames})["']`,
        'i'
      );
      const matchB = html.match(inputPatternB);
      if (matchB && matchB[1]) {
        const parsed = this.parseSenderFieldValue(matchB[1]);
        if (parsed) return parsed;
      }

      // 2. Vùng container write_send_info / send_info
      const sendInfoMatch = html.match(/id\s*=\s*["'](?:write_send_info|send_info|fromArea|senderInfo)["'][^>]*>([\s\S]*?)<\/(?:div|td|span)>/i);
      if (sendInfoMatch) {
        const parsed = this.parseSenderFieldValue(sendInfoMatch[1]);
        if (parsed) return parsed;
      }

      // 3. Bảng / Label hiển thị: 보낸사람 / From / Sender / Người gửi
      const headerMatch = html.match(
        /(?:보낸사람|From|Sender|Người gửi)\s*[:：]?\s*<\/(?:th|td|span|div|b|strong)>\s*<(?:td|span|div)[^>]*>([\s\S]*?)<\/(?:td|span|div)>/i
      ) || html.match(
        /(?:보낸사람|From|Sender|Người gửi)\s*[:：]?\s*([\s\S]{1,200}?)(?:<\/td>|<\/div>|<br|\n)/i
      );
      if (headerMatch && headerMatch[1]) {
        const parsed = this.parseSenderFieldValue(headerMatch[1]);
        if (parsed) return parsed;
      }

      // 4. Biến JavaScript: sFrom, sINetFrom, senderEmail, fromEmail
      const jsVarMatch = html.match(/(?:sFrom|sINetFrom|senderEmail|fromEmail|c_sFrom)\s*=\s*["']([^"']+)["']/i);
      if (jsVarMatch && jsVarMatch[1]) {
        const parsed = this.parseSenderFieldValue(jsVarMatch[1]);
        if (parsed) return parsed;
      }

      // 5. Hàm getFromDisplayInfo
      const displayInfoMatch = html.match(/getFromDisplayInfo\s*\(\s*\)\s*[\s\S]*?["']([^"']*@[^"']+)["']/i);
      if (displayInfoMatch) return displayInfoMatch[1].toLowerCase().trim();

      // 6. Generic regex an toàn: Tìm tất cả email trong tài liệu nhưng LOẠI TRỪ người nhận
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
     * Trích xuất nội dung thân email từ HTML trả về của Domino NSF (?OpenDocument).
     * @param {string} html
     * @returns {string}
     */
    extractBodyFromDominoHTML(html) {
      if (!html || !html.trim()) return '';

      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Loại bỏ các thẻ script, style, noscript, input, button, select, link
        doc.querySelectorAll('script, style, noscript, input, button, select, link').forEach((el) => el.remove());

        // 2. Thử tìm container nội dung email cụ thể
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

        // 3. Loại bỏ các bảng header rồi lấy form/body
        doc.querySelectorAll('#write_send_info, .mail-header, .header-table, .mail_head').forEach((el) => el.remove());

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
        console.warn('[PoscoDominoFetcher] DOMParser error, using fallback:', e);
        let content = html;
        content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        content = content.replace(/<input[^>]*>/gi, '');
        return content.trim();
      }
    }

    /**
     * Trích xuất nội dung email trực tiếp từ các element hoặc iframe đang mở trên DOM.
     * @returns {string}
     */
    extractContentFromOpenDOM() {
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
     * Trích xuất HTML từ DOM của vùng hiển thị email.
     * @param {HTMLElement} contentArea
     * @returns {string}
     */
    extractContentAreaHTML(contentArea) {
      if (!contentArea) return '';
      const iframe = contentArea.tagName === 'IFRAME' ? contentArea : contentArea.querySelector('iframe');
      if (iframe) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body && doc.body.innerHTML.trim()) {
            return doc.body.innerHTML;
          }
        } catch (_) {}
      }
      const clone = contentArea.cloneNode(true);
      const shield = clone.querySelector('#mg-shield-overlay, .mg-shield-overlay');
      if (shield) shield.remove();
      return clone.innerHTML;
    }

    /**
     * Tạo dữ liệu fallback an toàn khi không thể fetch.
     * @param {HTMLElement} row
     * @param {string|null} docId
     * @param {string} subject
     * @param {string} senderName
     * @returns {object}
     */
    buildFallbackData(row, docId, subject = '', senderName = '') {
      const domEmail = this.extractSenderFromRowDOM(row);
      const senderEmail = domEmail || 'unverified@external.mail';

      const data = {
        id: docId || '',
        subject: subject || '',
        senderName: senderName || 'Không rõ',
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
     * Quét ngầm để lấy đầy đủ thông tin một dòng thư.
     * @param {HTMLElement} row
     * @param {string} subject
     * @param {string} senderCellText
     * @returns {Promise<{id:string, subject:string, senderName:string, senderEmail:string, snippet:string, rawHtml:string}>}
     */
    async extractRowData(row, subject = '', senderCellText = '') {
      const docId = this.getDocId(row);
      if (!docId) {
        return this.buildFallbackData(row, null, subject, senderCellText);
      }

      // Trả cache nếu đã có
      if (this._cache.has(docId)) {
        return this._cache.get(docId);
      }

      // 1. Kiểm tra nhanh nếu DOM của hàng đã có email đầy đủ
      const domEmail = this.extractSenderFromRowDOM(row);
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

      // 2. Background Fetch tới tài liệu Domino
      try {
        const nsfPath = this.getNsfPath(row);
        if (!nsfPath) {
          return this.buildFallbackData(row, docId, subject, senderCellText);
        }

        const url = `${location.origin}${nsfPath}/0/${docId}?OpenDocument`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          console.warn(`[PoscoDominoFetcher] Fetch thất bại cho docId=${docId}: HTTP ${response.status}`);
          return this.buildFallbackData(row, docId, subject, senderCellText);
        }

        const html = await response.text();
        const currentUserId = this.getCurrentUserId();

        // Trích xuất email người gửi chính xác
        const senderEmail = this.extractSenderEmailFromHTML(html, currentUserId) || 'unverified@external.mail';
        const senderName = senderCellText || senderEmail;

        // Trích xuất nội dung thư từ Domino HTML
        const rawHtml = this.extractBodyFromDominoHTML(html);
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
        console.error(`[PoscoDominoFetcher] Lỗi khi fetch dữ liệu cho docId=${docId}:`, err);
        return this.buildFallbackData(row, docId, subject, senderCellText);
      }
    }

    /**
     * Lấy nội dung HTML thô của email để đưa vào Sandbox Viewer.
     * @param {HTMLElement|string} row - Hàng email hoặc docId
     * @param {string} [fallbackSubject]
     * @param {string} [fallbackSender]
     * @returns {Promise<string>}
     */
    async fetchEmailHTML(row, fallbackSubject = '', fallbackSender = '') {
      const docId = typeof row === 'string'
        ? row
        : (this.getDocId(row) || row?.dataset?.id || row?.dataset?.docid);

      // 1. Kiểm tra cache
      if (docId && this._cache.has(docId)) {
        const cached = this._cache.get(docId);
        if (cached && cached.rawHtml && cached.rawHtml.trim()) {
          const textOnly = cached.rawHtml.replace(/<[^>]+>/g, '').trim();
          if (textOnly.length > 0) {
            return cached.rawHtml;
          }
        }
      }

      // 2. Nếu đang mở thư chi tiết trên DOM
      const openDOMHTML = this.extractContentFromOpenDOM();
      if (openDOMHTML && openDOMHTML.replace(/<[^>]+>/g, '').trim().length > 0) {
        if (docId && this._cache.has(docId)) {
          this._cache.get(docId).rawHtml = openDOMHTML;
        }
        return openDOMHTML;
      }

      // 3. Tải tài liệu Domino qua OpenDocument
      if (docId) {
        const nsfPath = this.getNsfPath(typeof row === 'object' ? row : null);
        if (nsfPath) {
          const urlCandidates = [
            `${location.origin}${nsfPath}/0/${docId}?OpenDocument`,
            `${location.origin}${nsfPath}/XML_Inbox/${docId}?OpenDocument`,
            `${location.origin}${nsfPath}/($Inbox)/${docId}?OpenDocument`
          ];

          for (const url of urlCandidates) {
            try {
              console.log('[PoscoDominoFetcher] Đang tải email từ:', url);
              const response = await fetch(url, { credentials: 'include' });
              if (response.ok) {
                const html = await response.text();
                if (html && html.trim().length > 0) {
                  const bodyHtml = this.extractBodyFromDominoHTML(html);
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
              console.warn('[PoscoDominoFetcher] Lỗi khi fetch từ ' + url + ':', e);
            }
          }
        }
      }

      // 4. Fallback: hiển thị thông tin email nếu không lấy được body
      return `<div style="padding: 16px; font-family: sans-serif;">
        <p><strong>Người gửi:</strong> ${fallbackSender || 'Không rõ'}</p>
        <p><strong>Tiêu đề:</strong> ${fallbackSubject || '(Không có tiêu đề)'}</p>
        <p style="color: #64748b; font-style: italic;">(Không thể tải nội dung chi tiết từ Domino server cho mã tài liệu: ${docId || 'N/A'})</p>
      </div>`;
    }

    /**
     * Xóa cache của một docId hoặc toàn bộ cache.
     * @param {string} [docId]
     */
    clearCache(docId) {
      if (docId) {
        this._cache.delete(docId);
      } else {
        this._cache.clear();
      }
    }
  }

  global.MailGuard.PoscoDominoFetcher = PoscoDominoFetcher;
  console.log('[MailGuard] PoscoDominoFetcher đã sẵn sàng.');
})(window);
