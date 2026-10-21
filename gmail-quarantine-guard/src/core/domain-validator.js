/**
 * @file domain-validator.js
 * @namespace window.MailGuard
 * @description [REUSABLE CORE] Kiểm tra xem một địa chỉ email có thuộc Whitelist hay không.
 * Module này hoàn toàn độc lập, không phụ thuộc vào bất kỳ module nào khác.
 *
 * Chiến lược kiểm tra:
 *   1. Trích xuất phần domain từ địa chỉ email (phần sau ký tự @)
 *   2. So sánh domain đó với danh sách Whitelist (kiểm tra chính xác và kiểm tra subdomain)
 *   3. Một email được coi là "nội bộ" (internal) nếu domain của nó khớp với
 *      một domain trong Whitelist hoặc là subdomain của domain đó.
 *      Ví dụ: nếu whitelist có 'google.com' thì 'mail.google.com' cũng được coi là nội bộ.
 */

(function (global) {
  'use strict';

  // Khởi tạo namespace MailGuard nếu chưa tồn tại
  global.MailGuard = global.MailGuard || {};

  /**
   * @class DomainValidator
   * @description Cung cấp chức năng kiểm tra domain email so với Whitelist.
   */
  class DomainValidator {
    constructor() {
      /** @type {string[]} Danh sách domain được phép (Whitelist) */
      this._whitelist = [];
      /** @type {boolean} Trạng thái đã được tải Whitelist hay chưa */
      this._loaded = false;
    }

    /**
     * Tải Whitelist từ Service Worker (chrome.storage.local).
     * Phải được gọi và await trước khi sử dụng các phương thức kiểm tra.
     * @returns {Promise<string[]>} Danh sách domain trong Whitelist
     */
    async loadWhitelist() {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST' });
        if (response && response.success) {
          this._whitelist = response.whitelist.map((d) => d.toLowerCase().trim());
          this._loaded = true;
          console.log('[DomainValidator] Đã tải Whitelist:', this._whitelist);
        } else {
          console.warn('[DomainValidator] Không thể tải Whitelist, dùng mặc định.');
          this._whitelist = ['google.com'];
          this._loaded = true;
        }
      } catch (err) {
        console.error('[DomainValidator] Lỗi khi tải Whitelist:', err);
        this._whitelist = ['google.com'];
        this._loaded = true;
      }
      return this._whitelist;
    }

    /**
     * Cập nhật Whitelist nội bộ (được gọi sau khi người dùng thêm/xóa domain).
     * @param {string[]} newList - Danh sách domain mới
     */
    updateWhitelist(newList) {
      this._whitelist = newList.map((d) => d.toLowerCase().trim());
    }

    /**
     * Trích xuất phần domain từ một địa chỉ email.
     * Xử lý các định dạng như:
     *   - "user@domain.com"
     *   - "Display Name <user@domain.com>"
     *   - "user@domain.com (Display Name)"
     *
     * @param {string} emailStr - Chuỗi địa chỉ email đầu vào
     * @returns {string|null} Domain đã được chuẩn hóa hoặc null nếu không hợp lệ
     */
    extractDomain(emailStr) {
      if (!emailStr || typeof emailStr !== 'string') return null;

      let email = emailStr.trim();

      // Xử lý định dạng "Display Name <user@domain.com>"
      const angleMatch = email.match(/<([^>]+)>/);
      if (angleMatch) {
        email = angleMatch[1].trim();
      }

      // Xử lý định dạng "user@domain.com (Comment)"
      const parenIndex = email.indexOf('(');
      if (parenIndex !== -1) {
        email = email.substring(0, parenIndex).trim();
      }

      const atIndex = email.lastIndexOf('@');
      if (atIndex === -1) return null;

      const domain = email.substring(atIndex + 1).toLowerCase().trim();
      return domain || null;
    }

    /**
     * Kiểm tra xem một domain có khớp với một domain trong Whitelist hay không.
     * Hỗ trợ kiểm tra subdomain: 'mail.google.com' khớp với 'google.com'.
     *
     * @param {string} domain - Domain cần kiểm tra (đã lowercase)
     * @param {string} whitelistedDomain - Domain trong Whitelist (đã lowercase)
     * @returns {boolean}
     */
    _domainMatches(domain, whitelistedDomain) {
      // Khớp chính xác
      if (domain === whitelistedDomain) return true;
      // Khớp subdomain: domain phải kết thúc bằng '.whitelistedDomain'
      if (domain.endsWith('.' + whitelistedDomain)) return true;
      return false;
    }

    /**
     * Kiểm tra xem một địa chỉ email có thuộc Whitelist (Internal) hay không.
     *
     * @param {string} emailStr - Địa chỉ email cần kiểm tra
     * @returns {{ isInternal: boolean, domain: string|null, matchedRule: string|null }}
     */
    isInternal(emailStr) {
      const domain = this.extractDomain(emailStr);

      if (!domain) {
        return { isInternal: false, domain: null, matchedRule: null };
      }

      for (const rule of this._whitelist) {
        if (this._domainMatches(domain, rule)) {
          return { isInternal: true, domain, matchedRule: rule };
        }
      }

      return { isInternal: false, domain, matchedRule: null };
    }

    /**
     * Kiểm tra xem một địa chỉ email có phải là External (ngoài Whitelist) hay không.
     * Đây là phương thức tiện ích đảo ngược của isInternal().
     *
     * @param {string} emailStr - Địa chỉ email cần kiểm tra
     * @returns {boolean} true nếu email là External
     */
    isExternal(emailStr) {
      return !this.isInternal(emailStr).isInternal;
    }

    /**
     * Lấy danh sách Whitelist hiện tại.
     * @returns {string[]}
     */
    getWhitelist() {
      return [...this._whitelist];
    }

    /**
     * Kiểm tra xem Whitelist đã được tải chưa.
     * @returns {boolean}
     */
    isLoaded() {
      return this._loaded;
    }
  }

  // Xuất ra namespace toàn cục MailGuard
  global.MailGuard.DomainValidator = DomainValidator;

  console.log('[MailGuard] DomainValidator đã sẵn sàng.');
})(window);
