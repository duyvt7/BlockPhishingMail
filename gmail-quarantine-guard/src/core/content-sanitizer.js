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

  /** Các thẻ HTML nguy hiểm cần loại bỏ hoàn toàn cùng nội dung của chúng (tránh XSS, mXSS, Iframe, Form injection) */
  const DANGEROUS_TAGS_REMOVE_CONTENT = new Set([
    'script', 'style', 'noscript', 'template', 'object', 'embed', 'applet',
    'meta', 'link', 'base', 'iframe', 'frame', 'frameset', 'math',
    'form', 'input', 'textarea', 'button', 'select', 'option',
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

  /** Các attribute được phép (đã loại bỏ 'id' và 'name' để chống DOM Clobbering) */
  const ALLOWED_ATTRIBUTES = new Set([
    'colspan', 'rowspan', 'scope', 'headers', 'align', 'valign',
    'width', 'height', 'cellpadding', 'cellspacing', 'border',
    'dir', 'lang', 'class', 'title', 'role', 'aria-label',
  ]);

  // ============================================================
  // UNICODE HOMOGRAPH & PUNYCODE SPOOFING DETECTION
  // ============================================================

  /** Bảng ánh xạ ký tự đồng hình (Homoglyphs) từ Cyrillic, Greek, Fullwidth sang Latin */
  const HOMOGLYPH_MAP = {
    // Cyrillic chữ thường
    '\u0430': 'a', '\u0441': 'c', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
    '\u0455': 's', '\u0456': 'i', '\u0458': 'j', '\u0443': 'y', '\u0445': 'x',
    '\u0432': 'b', '\u043C': 'm', '\u043D': 'n', '\u0442': 't', '\u0434': 'd',
    '\u043F': 'n', '\u0433': 'r', '\u0448': 'w', '\u049B': 'k', '\u04BA': 'h',
    // Cyrillic chữ hoa
    '\u0410': 'a', '\u0412': 'b', '\u0421': 'c', '\u0415': 'e', '\u041D': 'h',
    '\u0406': 'i', '\u0408': 'j', '\u041A': 'k', '\u041C': 'm', '\u041E': 'o',
    '\u0420': 'p', '\u0422': 't', '\u0425': 'x', '\u0423': 'y',
    // Greek chữ thường
    '\u03B1': 'a', '\u03BF': 'o', '\u03C1': 'p', '\u03BD': 'v', '\u03C4': 't',
    '\u03BA': 'k', '\u03B9': 'i', '\u03C5': 'u', '\u03C7': 'x', '\u03B2': 'b',
    '\u03B5': 'e', '\u03B7': 'n', '\u03BC': 'u', '\u03C9': 'w',
    // Greek chữ hoa
    '\u0391': 'a', '\u0392': 'b', '\u0395': 'e', '\u0397': 'h', '\u0399': 'i',
    '\u039A': 'k', '\u039C': 'm', '\u039D': 'n', '\u039F': 'o', '\u03A1': 'p',
    '\u03A4': 't', '\u03A7': 'x', '\u03A5': 'y', '\u0396': 'z',
  };

  /** Danh sách thương hiệu / từ khóa nội bộ được bảo vệ chống giả mạo */
  const PROTECTED_BRANDS = [
    'posco', 'steel', 'postown', 'easythanks',
    'google', 'gmail', 'microsoft', 'office', 'outlook', 'apple',
    'login', 'secure', 'verify', 'account'
  ];

  // Các tham số thuật toán Punycode (RFC 3492)
  const PUNY_BASE = 36;
  const PUNY_TMIN = 1;
  const PUNY_TMAX = 26;
  const PUNY_SKEW = 38;
  const PUNY_DAMP = 700;
  const PUNY_INITIAL_BIAS = 72;
  const PUNY_INITIAL_N = 128;
  const PUNY_DELIMITER = '-';

  function _punyBaseToDigit(code) {
    if (code - 48 < 10) return code - 22;
    if (code - 65 < 26) return code - 65;
    if (code - 97 < 26) return code - 97;
    return PUNY_BASE;
  }

  function _punyAdapt(delta, numPoints, firstTime) {
    let k = 0;
    delta = firstTime ? Math.floor(delta / PUNY_DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    for (; delta > ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) >> 1; k += PUNY_BASE) {
      delta = Math.floor(delta / (PUNY_BASE - PUNY_TMIN));
    }
    return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * delta) / (delta + PUNY_SKEW));
  }

  /**
   * Giải mã chuỗi Punycode (RFC 3492) thành chuỗi Unicode.
   * @param {string} input - Nhãn punycode (không có tiền tố "xn--")
   * @returns {string}
   */
  function _decodePunycode(input) {
    const output = [];
    let i = 0;
    let n = PUNY_INITIAL_N;
    let bias = PUNY_INITIAL_BIAS;

    let basic = input.lastIndexOf(PUNY_DELIMITER);
    if (basic > 0) {
      for (let j = 0; j < basic; ++j) {
        output.push(input.charAt(j));
      }
    } else {
      basic = 0;
    }

    for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
      const oldi = i;
      let w = 1;
      for (let k = PUNY_BASE;; k += PUNY_BASE) {
        if (index >= input.length) return input;
        const digit = _punyBaseToDigit(input.charCodeAt(index++));
        if (digit >= PUNY_BASE) return input;
        i += digit * w;
        const t = k <= bias ? PUNY_TMIN : (k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias);
        if (digit < t) break;
        w *= PUNY_BASE - t;
      }
      const out = output.length + 1;
      bias = _punyAdapt(i - oldi, out, oldi === 0);
      n += Math.floor(i / out);
      i %= out;
      output.splice(i++, 0, String.fromCodePoint(n));
    }
    return output.join('');
  }

  /**
   * Chuyển đổi tên miền (kể cả IDN Punycode) thành Unicode hostname hoàn chỉnh.
   * @param {string} hostname
   * @returns {string}
   */
  function _toUnicodeDomain(hostname) {
    if (!hostname) return '';
    return hostname
      .split('.')
      .map((label) => {
        if (label.toLowerCase().startsWith('xn--')) {
          try {
            return _decodePunycode(label.slice(4));
          } catch (_) {
            return label;
          }
        }
        return label;
      })
      .join('.');
  }

  /**
   * Chuẩn hóa các ký tự đồng hình (Cyrillic, Greek...) về ký tự Latin cơ bản.
   * @param {string} str
   * @returns {string}
   */
  function _normalizeHomoglyphs(str) {
    if (!str) return '';
    return str
      .split('')
      .map((ch) => HOMOGLYPH_MAP[ch] || ch)
      .join('')
      .toLowerCase();
  }

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

      // 1. Lấy tất cả thẻ <a> có href
      for (const anchor of doc.querySelectorAll('a[href]')) {
        const href = (anchor.getAttribute('href') || '').trim();
        const text = (anchor.textContent || href).trim();
        if (href && !seen.has(href)) {
          seen.add(href);
          const isSuspicious = this._isSuspiciousUrl(href);
          const isHomograph = this.isHomographAttack(href);
          links.push({
            text: text.substring(0, 100),
            href,
            type: 'anchor',
            isSuspicious,
            isHomograph,
          });
        }
      }

      // 2. Tìm URL trong các attribute khác (src của img, ...)
      for (const el of doc.querySelectorAll('[src]')) {
        const src = (el.getAttribute('src') || '').trim();
        if (src && !seen.has(src) && !src.startsWith('cid:')) {
          seen.add(src);
          const isSuspicious = this._isSuspiciousUrl(src);
          const isHomograph = this.isHomographAttack(src);
          links.push({
            text: `[${el.tagName.toLowerCase()}] ${src.substring(0, 60)}`,
            href: src,
            type: 'media',
            isSuspicious,
            isHomograph,
          });
        }
      }

      // 3. Quét tất cả URL dạng text thuần (ví dụ: https://vnexpress.net/ không có thẻ <a>)
      const textContent = doc.body ? (doc.body.textContent || '') : '';
      const urlRegex = /(?:https?:\/\/|www\.)[a-zA-Z0-9][-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_\+.~#?&//=]*/gi;
      let textMatch;
      while ((textMatch = urlRegex.exec(textContent)) !== null) {
        const rawUrl = textMatch[0].trim();
        const normalizedHref = rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;
        if (!seen.has(normalizedHref) && !seen.has(rawUrl)) {
          seen.add(normalizedHref);
          seen.add(rawUrl);
          const isSuspicious = this._isSuspiciousUrl(normalizedHref);
          const isHomograph = this.isHomographAttack(normalizedHref);
          links.push({
            text: rawUrl.substring(0, 100),
            href: normalizedHref,
            type: 'plain_url',
            isSuspicious,
            isHomograph,
          });
        }
      }

      return links;
    }

    /**
     * Phát hiện Unicode Homograph Attack (Punycode spoofing).
     * Kiểm tra:
     *   1. Ký tự ẩn / Zero-Width / RTL Override trong URL
     *   2. Tên miền chứa Punycode (tiền tố xn--)
     *   3. Mixed Script Confusable: Nhãn domain trộn lẫn ký tự Latin và ký tự Cyrillic/Greek
     *   4. Whole Script Confusable: Domain dùng ký tự non-Latin giả mạo thương hiệu được bảo vệ (posco, google, ...)
     *
     * @param {string} urlStr - URL hoặc tên miền cần kiểm tra
     * @returns {boolean} true nếu phát hiện hành vi giả mạo Unicode Homograph
     */
    isHomographAttack(urlStr) {
      if (!urlStr || typeof urlStr !== 'string') return false;

      // 1. Kiểm tra ký tự ẩn, Zero-Width, hoặc Right-to-Left Override
      if (/[\u200B-\u200D\uFEFF\u202A-\u202E]/.test(urlStr)) {
        return true;
      }

      let hostname = '';
      try {
        const u = new URL(urlStr.startsWith('http') || urlStr.startsWith('//') ? urlStr : 'http://' + urlStr);
        hostname = u.hostname || '';
      } catch (_) {
        hostname = urlStr.split('/')[0].split('?')[0].split('#')[0];
      }

      if (!hostname) return false;

      // Bỏ qua địa chỉ IP IPv4 thuần túy
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        return false;
      }

      const lowerHost = hostname.toLowerCase();
      const hasPunycode = lowerHost.includes('xn--');
      const unicodeHost = _toUnicodeDomain(lowerHost);
      const unicodeLabels = unicodeHost.split('.');

      // 2. Mixed Script Confusable: kiểm tra từng nhãn (giữa các dấu chấm)
      for (const label of unicodeLabels) {
        const hasLatin = /[a-zA-Z]/.test(label);
        const hasNonLatinHomoglyph = /[\u0400-\u04FF\u0370-\u03FF]/.test(label);
        if (hasLatin && hasNonLatinHomoglyph) {
          return true; // Trộn lẫn ký tự Latin và Cyrillic/Greek trong cùng 1 nhãn
        }
      }

      // 3. Whole-script Confusable hoặc giả mạo thương hiệu được bảo vệ
      const hasNonAscii = /[^\u0000-\u007F]/.test(unicodeHost) || hasPunycode;
      if (hasNonAscii) {
        const normalizedHost = _normalizeHomoglyphs(unicodeHost);
        for (const brand of PROTECTED_BRANDS) {
          if (normalizedHost.includes(brand)) {
            return true; // Chuẩn hóa ký tự tương đồng ra thương hiệu nội bộ nhưng gốc lại là non-ASCII/Punycode!
          }
        }

        // Bất kỳ link sử dụng Punycode (xn--) nào trong email doanh nghiệp đều tiềm ẩn rủi ro lừa đảo cao
        if (hasPunycode) {
          return true;
        }

        // Nếu domain kết thúc bằng TLD phổ biến nhưng nhãn lại chứa Cyrillic/Greek
        if (/\.(com|net|vn|co\.kr|org|info|biz|io)$/i.test(unicodeHost)) {
          for (const label of unicodeLabels) {
            if (/[\u0400-\u04FF\u0370-\u03FF]/.test(label)) {
              return true;
            }
          }
        }
      }

      return false;
    }

    /**
     * Phân tích xem một URL có vẻ đáng ngờ hay không.
     * @param {string} url
     * @returns {boolean}
     */
    _isSuspiciousUrl(url) {
      if (!url) return false;
      const lower = url.toLowerCase();

      // 1. Kiểm tra Unicode Homograph Attack (Punycode spoofing)
      if (this.isHomographAttack(url)) {
        console.warn('[ContentSanitizer] Phát hiện URL nghi ngờ Homograph/Punycode Attack:', url);
        return true;
      }

      // 2. javascript:, data:, vbscript:
      if (/^(javascript|data|vbscript):/.test(lower)) return true;

      // 3. Giao thức nội bộ POSCO (đánh dấu suspicious để cảnh báo người dùng)
      if (/^(fssoexcast|fastdown|fexdown|n3ae00-front|m8a-jnlp):/.test(lower)) return true;

      // 4. Cảnh báo link .pdf (do policy AlwaysOpenPdfExternally trên POSCO)
      if (/\.pdf(\?|#|$)/i.test(lower)) return true;

      // 5. URL rút gọn phổ biến
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
