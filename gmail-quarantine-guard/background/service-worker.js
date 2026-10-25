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

// ============================================================
// NOTIFICATION THROTTLING & AGGREGATION
// ============================================================

let notificationQueue = [];
let notificationTimer = null;
const NOTIFICATION_DEBOUNCE_MS = 1500;

function flushNotifications() {
  if (notificationQueue.length === 0) return;

  if (notificationQueue.length === 1) {
    const item = notificationQueue[0];
    const notifId = `quarantine-guard-${Date.now()}`;
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: item.iconUrl || chrome.runtime.getURL('icons/icon48.png'),
      title: item.title || '[Quarantine Guard] Cảnh báo',
      message: item.message || 'Đã phát hiện email ngoài Whitelist.',
      priority: 2,
    });
  } else {
    const count = notificationQueue.length;
    const notifId = `quarantine-guard-summary-${Date.now()}`;

    // Lấy danh sách trích dẫn người gửi để tóm tắt
    const summaryLines = notificationQueue.slice(0, 3).map((item) => {
      const match = item.message ? item.message.match(/Từ:\s*([^\n]+)/) : null;
      return match ? `• ${match[1].trim()}` : `• ${item.title || 'Email ngoài danh sách'}`;
    });

    if (count > 3) {
      summaryLines.push(`• ...và ${count - 3} email khác`);
    }

    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: `⚠️ [Quarantine Guard] Phát hiện ${count} email ngoài Whitelist`,
      message: `Phát hiện ${count} email từ người gửi ngoài danh sách an toàn trong Inbox:\n${summaryLines.join('\n')}`,
      priority: 2,
    });
  }

  notificationQueue = [];
  notificationTimer = null;
}

/**
 * Lắng nghe và xử lý các message từ Content Script.
 * Các loại message được hỗ trợ:
 *   - GET_WHITELIST      : Trả về danh sách Whitelist hiện tại
 *   - ADD_DOMAIN         : Thêm một domain vào Whitelist
 *   - REMOVE_DOMAIN      : Xóa một domain khỏi Whitelist
 *   - SEND_NOTIFICATION  : Gửi Chrome System Notification (có throttle/aggregate)
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
          const { title, message: body, iconUrl } = message.payload || {};
          notificationQueue.push({
            title,
            message: body,
            iconUrl,
            timestamp: Date.now(),
          });

          if (notificationTimer) {
            clearTimeout(notificationTimer);
          }
          notificationTimer = setTimeout(flushNotifications, NOTIFICATION_DEBOUNCE_MS);

          return { success: true, queued: true };
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
