// 連線層限額守衛（修補 CVE 稽核 C-2 / C-4 / C-6）
//
// L18  createConnectionGuard()  建立守衛，回傳 { acquire, activeClients, trackedIpCount }
// L30  acquire(ip)              全域 + per-IP 連線上限判定，回傳 handle 或拒絕原因
// L44  handle.registerAuthFailure()  單連線認證失敗計數，達上限回 exhausted
// L55  handle.acquireSession()   per-connection channel 上限
// L68  handle.release()          幂等釋放，自動清掉空的 per-IP 桶
//
// 設計刻意不做跨程序持久化：per-IP 計數只在程序生命週期內有效，
// 目的是阻斷單一來源的連線耗盡與 bcrypt CPU 放大，而非長期封鎖。

const ANY_IP = '<unknown>';

function positive(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function createConnectionGuard(options = {}) {
  const maxClients = positive(options.maxClients, 64);
  const maxClientsPerIp = positive(options.maxClientsPerIp, 8);
  const maxAuthFailures = positive(options.maxAuthFailures, 5);
  const maxSessionsPerClient = positive(options.maxSessionsPerClient, 8);

  let activeClients = 0;
  const perIp = new Map();

  return {
    get activeClients() {
      return activeClients;
    },

    get trackedIpCount() {
      return perIp.size;
    },

    acquire(ip) {
      const key = typeof ip === 'string' && ip ? ip : ANY_IP;

      if (activeClients >= maxClients) {
        return { allowed: false, reason: 'max-clients' };
      }

      const used = perIp.get(key) || 0;
      if (used >= maxClientsPerIp) {
        return { allowed: false, reason: 'max-clients-per-ip' };
      }

      activeClients += 1;
      perIp.set(key, used + 1);

      let released = false;
      let failures = 0;
      let sessions = 0;

      return {
        allowed: true,
        handle: {
          ip: key,

          registerAuthFailure() {
            failures += 1;
            return { failures, exhausted: failures >= maxAuthFailures };
          },

          acquireSession() {
            if (released || sessions >= maxSessionsPerClient) {
              return false;
            }
            sessions += 1;
            return true;
          },

          releaseSession() {
            sessions = Math.max(0, sessions - 1);
          },

          release() {
            if (released) {
              return;
            }
            released = true;
            activeClients = Math.max(0, activeClients - 1);
            const remaining = (perIp.get(key) || 1) - 1;
            if (remaining > 0) {
              perIp.set(key, remaining);
            } else {
              perIp.delete(key);
            }
          }
        }
      };
    }
  };
}
