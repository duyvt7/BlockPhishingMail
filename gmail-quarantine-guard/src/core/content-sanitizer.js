/**
 * @file content-sanitizer.js
 * @namespace window.MailGuard
 * @description [REUSABLE CORE] Bộ lọc khử độc HTML cho nội dung email nguy hiểm.
 *
 * Cung cấp 3 chế độ xử lý:
 *   1. **Sanitized HTML**: Loại bỏ script/link/ảnh/tệp đính kèm nhưng GIỮ bố cục (table, p, br...)
 *   2. **Plain Text**: Chuyển toàn bộ nội dung thành văn bản thuần túy (không có thẻ HTML)
 *   3. **Link Extractor**: Trích xuất danh sách tất cả các URL được nhúng trong nội dung
 *
 * Không sử dụng innerHTML để parse (để tránh XSS). Dùng DOMParser một cách an toàn.
 */

(function (global) {
  'use strict';

  global.MailGuard = global.MailGuard || {};

  // ============================================================
  // CONSTANTS - Tags & Attributes bị cấm
  // ============================================================

  /** Các thẻ HTML nguy hiểm cần loại bỏ hoàn toàn cùng nội dung của chúng */
  const DANGEROUS_TAGS_REMOVE_CONTENT = new Set([
    'script', 'style', 'noscript', 'template', 'iframe', 'frame',
    'frameset', 'object', 'embed', 'applet', 'form', 'input',
    'button', 'select', 'textarea', 'meta', 'link',
  ]);

  /** Các thẻ HTML chứa media/link cần loại bỏ thẻ nhưng GIỮ text content */
  const MEDIA_TAGS_KEEP_TEXT = new Set([
    'a', 'img', 'video', 'audio', 'source', 'picture', 'canvas', 'svg',
  ]);

  /** Các thẻ HTML được phép trong Sanitized HTML mode (whitelist) */
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'div', 'span', 'table', 'thead', 'tbody', 'tfoot',
    'tr', 'th', 'td', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's',
    'del', 'ins', 'mark', 'small', 'sub', 'sup', 'abbr', 'cite', 'q',
    'dl', 'dt', 'dd', 'figure', 'figcaption', 'header', 'footer',
    'main', 'section', 'article', 'aside', 'nav', 'address', 'time',
    'colgroup', 'col', 'caption',
  ]);

  /** Các attribute được phép (mọi attribute khác đều bị loại bỏ) */
  const ALLOWED_ATTRIBUTES = new Set([
    'colspan', 'rowspan', 'scope', 'headers', 'align', 'valign',
    'width', 'height', 'cellpadding', 'cellspacing', 'border',
    'dir', 'lang', 'class', 'id', 'title', 'role', 'aria-label',
  ]);

  // ============================================================
  // CLASS ContentSanitizer
  // ============================================================

  /**
   * @class ContentSanitizer
   * @description Khử độc và chuyển đổi nội dung HTML email.
   */
  class ContentSanitizer {
    constructor() {
      this._parser = new DOMParser();
    }

    /**
     * Parse chuỗi HTML thành document một cách an toàn bằng DOMParser.
     * @param {string} htmlString - Chuỗi HTML thô
     * @returns {Document}
     */
    _parseHTML(htmlString) {
      return this._parser.parseFromString(htmlString, 'text/html');
    }

    /**
     * Chế độ 1: Sanitized HTML
     * Loại bỏ tất cả scripts, links, ảnh, form nhưng giữ bố cục bảng biểu và văn bản.
     * Xóa toàn bộ event handlers (on*) và javascript: hrefs.
     *
     * @param {string} htmlString - HTML thô của email
     * @returns {string} HTML đã được khử độc (safe HTML string)
     */
    sanitizeHTML(htmlString) {
      if (!htmlString) return '';

      const doc = this._parseHTML(htmlString);
      this._cleanNode(doc.body);
      return doc.body.innerHTML;
    }

    /**
     * Đệ quy làm sạch một DOM node.
     * @param {Node} node
     */
    _cleanNode(node) {
      if (!node) return;

      const childrenToProcess = Array.from(node.childNodes);

      for (const child of childrenToProcess) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tagName = child.tagName.toLowerCase();

          // Loại bỏ hoàn toàn các thẻ nguy hiểm (kể cả nội dung bên trong)
          if (DANGEROUS_TAGS_REMOVE_CONTENT.has(tagName)) {
            node.removeChild(child);
            continue;
          }

          // Thay thế các thẻ media/link bằng nội dung text của chúng
          if (MEDIA_TAGS_KEEP_TEXT.has(tagName)) {
            // Đối với img, hiển thị [ẢNH ĐÃ BỊ ẨN]
            if (tagName === 'img') {
              const placeholder = document.createElement('span');
              placeholder.className = 'mg-hidden-image-placeholder';
              placeholder.textContent = `[🖼 ẢNH ĐÃ BỊ ẨN: ${child.getAttribute('alt') || 'Image'}]`;
              node.replaceChild(placeholder, child);
              continue;
            }

            // Đối với <a>, giữ lại text nhưng loại bỏ href nguy hiểm
            if (tagName === 'a') {
              const span = document.createElement('span');
              span.className = 'mg-removed-link';
              span.textContent = child.textContent;
              const hrefValue = child.getAttribute('href') || '#';
              span.setAttribute('data-original-href', hrefValue);
              span.title = `[LINK ĐÃ BỊ VÔ HIỆU HÓA: ${hrefValue}]`;
              node.replaceChild(span, child);
              continue;
            }

            // Các thẻ media khác (video, audio, ...) — xóa hoàn toàn
            node.removeChild(child);
            continue;
          }

          // Thẻ không nằm trong whitelist — thay bằng div hoặc span
          if (!ALLOWED_TAGS.has(tagName)) {
            const wrapper = document.createElement('span');
            while (child.firstChild) {
              wrapper.appendChild(child.firstChild);
            }
            node.replaceChild(wrapper, child);
            // Tiếp tục xử lý wrapper
            this._cleanNode(wrapper);
            continue;
          }

          // Làm sạch attributes của thẻ được phép
          this._cleanAttributes(child);

          // Đệ quy vào children
          this._cleanNode(child);
        }
        // Text nodes và comment nodes: giữ nguyên text, xóa comment
        else if (child.nodeType === Node.COMMENT_NODE) {
          node.removeChild(child);
        }
      }
    }

    /**
     * Xóa các attribute không được phép khỏi một element.
     * @param {Element} element
     */
    _cleanAttributes(element) {
      const attrsToRemove = [];

      for (const attr of element.attributes) {
        const name = attr.name.toLowerCase();

        // Xóa tất cả event handlers (onclick, onload, onmouseover, ...)
        if (name.startsWith('on')) {
          attrsToRemove.push(attr.name);
          continue;
        }

        // Xóa các attribute không nằm trong whitelist
        if (!ALLOWED_ATTRIBUTES.has(name)) {
          attrsToRemove.push(attr.name);
          continue;
        }

        // Kiểm tra giá trị attribute (tránh data: và javascript:)
        const value = attr.value.toLowerCase().trim().replace(/\s+/g, '');
        if (value.startsWith('javascript:') || value.startsWith('data:')) {
          attrsToRemove.push(attr.name);
        }
      }

      for (const name of attrsToRemove) {
        element.removeAttribute(name);
      }
    }

    /**
     * Chế độ 2: Plain Text
     * Chuyển đổi HTML email thành văn bản thuần túy, không có thẻ HTML.
     * Giữ lại xuống dòng cho <p>, <br>, <li>, và <tr>.
     *
     * @param {string} htmlString - HTML thô của email
     * @returns {string} Văn bản thuần túy
     */
    toPlainText(htmlString) {
      if (!htmlString) return '';

      const doc = this._parseHTML(htmlString);

      // Thêm newline trước các thẻ block để giữ cấu trúc
      const blockTags = ['p', 'br', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'pre', 'hr', 'td', 'th'];

      for (const tag of blockTags) {
        for (const el of doc.querySelectorAll(tag)) {
          if (tag === 'br' || tag === 'hr') {
            el.insertAdjacentText('afterend', '\n');
          } else if (tag === 'td' || tag === 'th') {
            el.insertAdjacentText('afterend', '\t');
          } else {
            el.insertAdjacentText('afterend', '\n');
          }
        }
      }

      // Xóa script và style trước khi lấy textContent
      for (const el of doc.querySelectorAll('script, style, noscript')) {
        el.remove();
      }

      let text = doc.body.textContent || '';
      // Chuẩn hóa whitespace: thay nhiều dòng trắng thành tối đa 2 dòng trắng
      text = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

      return text;
    }

    /**
     * Chế độ 3: Link Extractor
     * Trích xuất tất cả URL được nhúng trong nội dung HTML.
     *
     * @param {string} htmlString - HTML thô của email
     * @returns {Array<{text: string, href: string, type: string}>} Danh sách link
     */
    extractLinks(htmlString) {
      if (!htmlString) return [];

      const doc = this._parseHTML(htmlString);
      const links = [];
      const seen = new Set();

      // Lấy tất cả thẻ <a>
      for (const anchor of doc.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href') || '';
        const text = (anchor.textContent || href).trim();
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push({
            text: text.substring(0, 100),
            href,
            type: 'anchor',
            isSuspicious: this._isSuspiciousUrl(href),
          });
        }
      }

      // Tìm URL trong các attribute khác (src của img, ...)
      for (const el of doc.querySelectorAll('[src]')) {
        const src = el.getAttribute('src') || '';
        if (src && !seen.has(src) && !src.startsWith('cid:')) {
          seen.add(src);
          links.push({
            text: `[${el.tagName.toLowerCase()}] ${src.substring(0, 60)}`,
            href: src,
            type: 'media',
            isSuspicious: this._isSuspiciousUrl(src),
          });
        }
      }

      return links;
    }

    /**
     * Phân tích xem một URL có vẻ đáng ngờ hay không.
     * @param {string} url
     * @returns {boolean}
     */
    _isSuspiciousUrl(url) {
      if (!url) return false;
      const lower = url.toLowerCase();
      // javascript:, data:, vbscript:
      if (/^(javascript|data|vbscript):/.test(lower)) return true;
      // URL rút gọn phổ biến
      const shortenerDomains = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'short.io', 'rb.gy'];
      try {
        const urlObj = new URL(url);
        if (shortenerDomains.some((d) => urlObj.hostname.endsWith(d))) return true;
        // IP address thay vì domain
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(urlObj.hostname)) return true;
      } catch (_) { /* không phải URL hợp lệ */ }
      return false;
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.ContentSanitizer = ContentSanitizer;

  console.log('[MailGuard] ContentSanitizer đã sẵn sàng.');
})(window);
