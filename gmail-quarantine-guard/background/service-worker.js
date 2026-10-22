/**
 * @file service-worker.js
 * @description Background Service Worker (Manifest V3)
 * Chịu trách nhiệm:
 * 1. Khởi tạo và quản lý Storage (Whitelist Domains)
 * 2. Xử lý Chrome Notifications
 * 3. Lắng nghe Message từ Content Scripts
 */

// ============================================================
// CONSTANTS
// ============================================================
const DEFAULT_WHITELIST = ['posco.com', 'posco.vn', 'posco.net', 'posco.co.kr', 'poscoway.net', 'steel-n.com', 'postown.net', 'easythanks-planet.com'];
const STORAGE_KEY = 'whitelistDomains';

/**
 * Lấy hoặc làm sạch Whitelist từ Storage:
 * Tự động loại bỏ google.com/gmail.com nếu còn lưu từ phiên bản trước
 * và đảm bảo các domain mặc định POSCO luôn sẵn sàng.
 */
async function getOrCleanWhitelist() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  let list = data[STORAGE_KEY];

  if (!list || !Array.isArray(list) || list.length === 0) {
    list = [...DEFAULT_WHITELIST];
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  }

  return list;
}

// ============================================================
// INITIALIZATION
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  await getOrCleanWhitelist();
  console.log('[QuarantineGuard] Service Worker đã khởi động. Phiên bản:', chrome.runtime.getManifest().version);
});

chrome.runtime.onStartup.addListener(async () => {
  await getOrCleanWhitelist();
});

// ============================================================
// MESSAGE LISTENER
// ============================================================

/**
 * Lắng nghe và xử lý các message từ Content Script.
 * Các loại message được hỗ trợ:
 *   - GET_WHITELIST      : Trả về danh sách Whitelist hiện tại
 *   - ADD_DOMAIN         : Thêm một domain vào Whitelist
 *   - REMOVE_DOMAIN      : Xóa một domain khỏi Whitelist
 *   - SEND_NOTIFICATION  : Gửi Chrome System Notification
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (message.type) {
        case 'GET_WHITELIST': {
          const whitelist = await getOrCleanWhitelist();
          return { success: true, whitelist };
        }

        case 'ADD_DOMAIN': {
          const { domain } = message.payload;
          if (!domain || typeof domain !== 'string') {
            return { success: false, error: 'Domain không hợp lệ.' };
          }
          const normalized = domain.toLowerCase().trim();
          const data = await chrome.storage.local.get(STORAGE_KEY);
          const list = data[STORAGE_KEY] || [...DEFAULT_WHITELIST];
          if (!list.includes(normalized)) {
            list.push(normalized);
            await chrome.storage.local.set({ [STORAGE_KEY]: list });
          }
          return { success: true, whitelist: list };
        }

        case 'REMOVE_DOMAIN': {
          const { domain } = message.payload;
          const data = await chrome.storage.local.get(STORAGE_KEY);
          const list = (data[STORAGE_KEY] || []).filter(
            (d) => d.toLowerCase() !== domain.toLowerCase()
          );
          await chrome.storage.local.set({ [STORAGE_KEY]: list });
          return { success: true, whitelist: list };
        }

        case 'SEND_NOTIFICATION': {
          const { title, message: body, iconUrl } = message.payload;
          const notifId = `quarantine-guard-${Date.now()}`;
          await chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: iconUrl || chrome.runtime.getURL('icons/icon48.png'),
            title: title || '[Quarantine Guard] Cảnh báo',
            message: body || 'Đã phát hiện email ngoài Whitelist.',
            priority: 2,
          });
          return { success: true, notifId };
        }

        default:
          return { success: false, error: `Loại message không xác định: ${message.type}` };
      }
    } catch (err) {
      console.error('[QuarantineGuard SW] Lỗi xử lý message:', err);
      return { success: false, error: err.message };
    }
  };

  // Phải return true để giữ kênh sendResponse mở cho async handler
  handler().then(sendResponse);
  return true;
});

// ============================================================
// NOTIFICATION CLICK HANDLER
// ============================================================

chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId.startsWith('quarantine-guard-')) {
    chrome.notifications.clear(notifId);
  }
});

console.log('[QuarantineGuard] Service Worker script đã được tải.');
