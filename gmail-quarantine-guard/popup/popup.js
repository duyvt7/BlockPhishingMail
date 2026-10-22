/**
 * @file popup.js
 * @description Logic của Popup UI — Quản lý Whitelist Domains.
 *
 * Chức năng:
 *   1. Tải và hiển thị danh sách domain từ chrome.storage.local
 *   2. Thêm domain mới với validation
 *   3. Xóa domain khỏi Whitelist
 *   4. Hiển thị phiên bản extension
 *
 * Giao tiếp với Service Worker qua chrome.runtime.sendMessage.
 * Mọi thay đổi được phản ánh tức thời cho Content Script qua chrome.storage.onChanged.
 */

'use strict';

// ============================================================
// DOM ELEMENTS
// ============================================================
const domainInput     = document.getElementById('domain-input');
const addForm         = document.getElementById('add-form');
const domainList      = document.getElementById('domain-list');
const errorMsg        = document.getElementById('error-msg');
const domainCountBadge = document.getElementById('domain-count-badge');
const statDomainCount  = document.getElementById('stat-domain-count');
const versionBadge     = document.getElementById('version-badge');
const popupToast       = document.getElementById('popup-toast');

// Domains mặc định — không cho phép xóa
const DEFAULT_DOMAINS = ['posco.com', 'posco.vn', 'posco.net', 'posco.co.kr', 'poscoway.net', 'steel-n.com', 'postown.net', 'easythanks-planet.com'];

// ============================================================
// TOAST
// ============================================================

let toastTimer = null;

/**
 * Hiển thị toast notification nhỏ trong popup.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  popupToast.textContent = message;
  popupToast.className = `popup-toast popup-toast-${type} show`;
  toastTimer = setTimeout(() => {
    popupToast.classList.remove('show');
  }, 2500);
}

// ============================================================
// ERROR DISPLAY
// ============================================================

/**
 * Hiển thị thông báo lỗi bên dưới input.
 * @param {string} msg
 */
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('visible');
  domainInput.classList.add('input-error');
}

/**
 * Xóa thông báo lỗi.
 */
function clearError() {
  errorMsg.textContent = '';
  errorMsg.classList.remove('visible');
  domainInput.classList.remove('input-error');
}

// ============================================================
// DOMAIN VALIDATION
// ============================================================

/**
 * Kiểm tra cú pháp domain hợp lệ.
 * Chấp nhận: domain.com, sub.domain.com, domain.co.uk
 * Không chấp nhận: URL đầy đủ (http://...), ký tự đặc biệt
 *
 * @param {string} domain
 * @returns {{ valid: boolean, normalized: string, error?: string }}
 */
function validateDomain(domain) {
  const normalized = domain.toLowerCase().trim();

  if (!normalized) {
    return { valid: false, normalized, error: 'Domain không được để trống.' };
  }

  // Loại bỏ http:// hoặc https:// nếu người dùng nhập URL đầy đủ
  let cleaned = normalized.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

  if (!cleaned) {
    return { valid: false, normalized: cleaned, error: 'Không thể trích xuất domain từ URL này.' };
  }

  // Kiểm tra định dạng domain hợp lệ
  // Regex: mỗi phần của domain gồm chữ cái, số, dấu gạch ngang
  const domainRegex = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63}(?<!-))+$/i;
  if (!domainRegex.test(cleaned)) {
    return {
      valid: false,
      normalized: cleaned,
      error: `"${cleaned}" không phải định dạng domain hợp lệ. Ví dụ: company.com`,
    };
  }

  // Giới hạn độ dài tổng
  if (cleaned.length > 253) {
    return { valid: false, normalized: cleaned, error: 'Domain quá dài (tối đa 253 ký tự).' };
  }

  return { valid: true, normalized: cleaned };
}

// ============================================================
// RENDER
// ============================================================

/**
 * Render danh sách domain vào DOM.
 * @param {string[]} domains
 */
function renderDomainList(domains) {
  domainList.innerHTML = '';

  // Cập nhật counter
  domainCountBadge.textContent = `${domains.length} domain${domains.length !== 1 ? 's' : ''}`;
  statDomainCount.textContent = domains.length;

  if (domains.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'domain-list-empty';
    emptyEl.innerHTML = `
      <span class="empty-icon">📋</span>
      <span>Danh sách Whitelist trống.<br/>Thêm domain để bắt đầu.</span>
    `;
    domainList.appendChild(emptyEl);
    return;
  }

  for (const domain of domains) {
    const item = renderDomainItem(domain);
    domainList.appendChild(item);
  }
}

/**
 * Tạo một item trong danh sách domain.
 * @param {string} domain
 * @returns {HTMLElement}
 */
function renderDomainItem(domain) {
  const isDefault = DEFAULT_DOMAINS.includes(domain);

  const item = document.createElement('div');
  item.className = 'domain-item';
  item.setAttribute('role', 'listitem');
  item.dataset.domain = domain;

  const icon = document.createElement('span');
  icon.className = 'domain-icon';
  icon.textContent = isDefault ? '🏠' : '🌐';

  const nameEl = document.createElement('span');
  nameEl.className = 'domain-name';
  nameEl.textContent = domain;
  nameEl.title = domain;

  item.appendChild(icon);
  item.appendChild(nameEl);

  if (isDefault) {
    const badge = document.createElement('span');
    badge.className = 'domain-default-badge';
    badge.textContent = 'Mặc định';
    item.appendChild(badge);
  }

  // Nút xóa (không cho xóa domain mặc định)
  const removeBtn = document.createElement('button');
  removeBtn.className = 'domain-remove-btn';
  removeBtn.textContent = '×';
  removeBtn.title = isDefault ? 'Không thể xóa domain mặc định' : `Xóa ${domain} khỏi Whitelist`;
  removeBtn.setAttribute('aria-label', `Xóa domain ${domain}`);
  removeBtn.disabled = isDefault;

  if (!isDefault) {
    removeBtn.addEventListener('click', () => handleRemoveDomain(domain));
  }

  item.appendChild(removeBtn);
  return item;
}

// ============================================================
// HANDLERS
// ============================================================

/**
 * Xử lý thêm domain mới.
 * @param {Event} [event]
 */
async function handleAddDomain(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  clearError();

  let rawInput = (domainInput.value || '').trim();
  // Tự động loại bỏ http/https nếu người dùng nhập/dán URL
  if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
    try {
      const url = new URL(rawInput);
      rawInput = url.hostname;
      domainInput.value = rawInput;
    } catch (_) {}
  }

  const { valid, normalized, error } = validateDomain(rawInput);

  if (!valid) {
    showError(error);
    domainInput.focus();
    return;
  }

  // Gửi request đến Service Worker để thêm domain
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ADD_DOMAIN',
      payload: { domain: normalized },
    });

    if (response && response.success) {
      domainInput.value = '';
      renderDomainList(response.whitelist);
      showToast(`✅ Đã thêm "${normalized}" vào Whitelist!`, 'success');
      domainInput.focus();
    } else {
      showError(response?.error || 'Không thể thêm domain. Vui lòng thử lại.');
    }
  } catch (err) {
    console.error('[Popup] Lỗi khi thêm domain:', err);
    showError('Lỗi kết nối với Extension. Hãy reload trang Webmail.');
  }
}

/**
 * Thêm một domain trực tiếp (dùng cho nút gợi ý 1 chạm hoặc preset tags, không cần nhập/dán).
 * @param {string} domain
 */
async function handleAddDomainDirect(domain) {
  clearError();
  const { valid, normalized, error } = validateDomain(domain);
  if (!valid) {
    showError(error);
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ADD_DOMAIN',
      payload: { domain: normalized },
    });
    if (response && response.success) {
      if (domainInput) domainInput.value = '';
      renderDomainList(response.whitelist);
      showToast(`✅ Đã thêm "${normalized}" vào Whitelist!`, 'success');
      const suggestedBox = document.getElementById('suggested-box');
      if (suggestedBox) suggestedBox.style.display = 'none';
    } else {
      showError(response?.error || 'Không thể thêm domain.');
    }
  } catch (err) {
    console.error('[Popup] Lỗi khi thêm domain trực tiếp:', err);
    showError('Lỗi kết nối với Extension.');
  }
}

/**
 * Xử lý xóa domain.
 * @param {string} domain
 */
async function handleRemoveDomain(domain) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REMOVE_DOMAIN',
      payload: { domain },
    });

    if (response && response.success) {
      renderDomainList(response.whitelist);
      showToast(`🗑 Đã xóa "${domain}" khỏi Whitelist.`, 'info');
    } else {
      showToast('Không thể xóa domain. Thử lại sau.', 'error');
    }
  } catch (err) {
    console.error('[Popup] Lỗi khi xóa domain:', err);
    showToast('Lỗi kết nối với Extension.', 'error');
  }
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Khởi tạo Popup: tải whitelist và cài đặt event listeners.
 */
async function initPopup() {
  // Hiển thị phiên bản
  try {
    const manifest = chrome.runtime.getManifest();
    versionBadge.textContent = `v${manifest.version}`;
  } catch (_) { /* ignore */ }

  // Tải Whitelist từ Service Worker
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST' });
    if (response && response.success) {
      renderDomainList(response.whitelist);
    } else {
      renderDomainList([]);
      showToast('Không tải được Whitelist.', 'error');
    }
  } catch (err) {
    console.error('[Popup] Lỗi khi tải Whitelist:', err);
    renderDomainList([]);
    showToast('Lỗi kết nối Service Worker.', 'error');
  }

  // Event listener cho nút Thêm và phím Enter (không dùng form submit để tránh chặn từ Secure Web)
  const addBtn = document.getElementById('add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => handleAddDomain());
  }

  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddDomain();
    }
  });

  // Xóa lỗi khi người dùng bắt đầu gõ hoặc đổi nội dung
  domainInput.addEventListener('input', clearError);
  domainInput.addEventListener('change', () => {
    let val = domainInput.value.trim();
    if (val.startsWith('http://') || val.startsWith('https://')) {
      try {
        const url = new URL(val);
        domainInput.value = url.hostname;
        clearError();
      } catch (_) {}
    }
  });

  // Lắng nghe thay đổi storage (nếu popup mở khi content script thay đổi whitelist)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.whitelistDomains) {
      renderDomainList(changes.whitelistDomains.newValue || []);
    }
  });

  // Kiểm tra gợi ý domain từ email vừa phát hiện
  try {
    const storageData = await chrome.storage.local.get(['lastExternalDomain', 'whitelistDomains']);
    const extDom = storageData.lastExternalDomain;
    const currentList = storageData.whitelistDomains || DEFAULT_DOMAINS;
    if (extDom && !currentList.includes(extDom.toLowerCase().trim())) {
      const suggestedBox = document.getElementById('suggested-box');
      const suggestedName = document.getElementById('suggested-domain-name');
      const suggestedBtn = document.getElementById('suggested-add-btn');
      if (suggestedBox && suggestedName && suggestedBtn) {
        suggestedName.textContent = extDom;
        suggestedBox.style.display = 'flex';
        suggestedBtn.onclick = () => {
          handleAddDomainDirect(extDom);
        };
      }
    }
  } catch (_) {}

  // Event listener cho các nút mẫu nhanh (tag-btn)
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.domain;
      if (d) handleAddDomainDirect(d);
    });
  });

  // Hỗ trợ dán an toàn qua event clipboardData (ngăn lỗi từ hook Secure Web)
  domainInput.addEventListener('paste', (e) => {
    try {
      const text = (e.clipboardData || window.clipboardData)?.getData('text');
      if (text) {
        e.preventDefault();
        domainInput.value = text.trim();
        clearError();
      }
    } catch (_) {}
  });
}

// Chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', initPopup);
